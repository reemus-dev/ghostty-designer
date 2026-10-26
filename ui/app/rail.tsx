import {useEffect, useState} from "react";
import {cn} from "cn";
import {
  AppWindowIcon,
  LayoutGridIcon,
  type LucideIcon,
  PaletteIcon,
  PinIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from "lucide-react";
import {Kbd} from "@/components/ui/kbd";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {SECTION_TITLE, type SectionId} from "@/lib/customise";
import {ALT} from "@/lib/keys";
import {type Pin, togglePin, useStore} from "@/lib/store";
import {
  revealSection,
  showView,
  type View,
  VIEW_LABEL,
  VIEWS,
} from "@/lib/views";

const VIEW_ICON: Record<View, LucideIcon> = {
  customise: SlidersHorizontalIcon,
  themes: LayoutGridIcon,
};

/** Each view's main scroll: Customise's page and Themes' cards. */
const VIEW_SCROLLER: Record<View, string> = {
  customise: "[data-customise]",
  themes: "[data-themes]",
};

/** Customise's sections in page order. */
const SECTIONS = [
  {id: "colors", icon: PaletteIcon},
  {id: "font", icon: TypeIcon},
  {id: "window", icon: AppWindowIcon},
] as const satisfies readonly {id: SectionId; icon: LucideIcon}[];

/**
 * The views (Alt 1, Alt 2), Customise's sections with the one in view marked,
 * and the pin. Each shows its name on hover. The wheel over the rail scrolls
 * the view, a lane past nested scrolls such as the font list. Modal overlays
 * cover the rail, so it scrolls only when the view would.
 */
export function Rail() {
  const view = useStore((store) => store.view);
  return (
    <div
      data-tauri-drag-region="deep"
      className="flex min-h-0 flex-col items-center gap-3 pb-3 select-none"
      onWheel={(event) =>
        document
          .querySelector(VIEW_SCROLLER[view])
          ?.scrollBy({top: event.deltaY})
      }>
      <ViewSwitch view={view} />
      {view === "customise" && <Sections />}
      <div className="mt-auto">
        <PinToggle />
      </div>
    </div>
  );
}

function ViewSwitch(props: {view: View}) {
  return (
    <nav
      aria-label="Views"
      className="flex flex-col gap-0.5 rounded-lg bg-muted p-0.5 inset-ring inset-ring-input">
      {VIEWS.map((name, i) => {
        const Icon = VIEW_ICON[name];
        return (
          <Tooltip key={name}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={VIEW_LABEL[name]}
                  aria-current={name === props.view ? "page" : undefined}
                  onClick={() => showView(name)}
                />
              }
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
                name === props.view &&
                  "bg-selected text-foreground shadow-raised inset-shadow-highlight",
              )}>
              <Icon aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {VIEW_LABEL[name]} <Kbd>{`${ALT}${i + 1}`}</Kbd>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function Sections() {
  const current = useSectionInView();
  return (
    <nav
      aria-label="Sections"
      className="flex flex-col gap-1 border-t border-border pt-3">
      {SECTIONS.map(({id, icon: Icon}) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={SECTION_TITLE[id]}
                aria-current={id === current ? "location" : undefined}
                onClick={() => revealSection(id)?.focus({preventScroll: true})}
              />
            }
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
              id === current && "bg-selected text-foreground",
            )}>
            <Icon aria-hidden className="size-[18px]" />
          </TooltipTrigger>
          <TooltipContent side="right">{SECTION_TITLE[id]}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

const PIN_DETAIL: Record<Pin, string | null> = {
  off: null,
  on: "On",
  unsupported: "Not supported on Wayland",
};

/** Keeps the window above Ghostty while you switch between them. */
function PinToggle() {
  const pin = useStore((store) => store.pin);
  const detail = PIN_DETAIL[pin];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Keep window on top"
            aria-pressed={pin === "on"}
            aria-disabled={pin === "unsupported"}
            onClick={togglePin}
          />
        }
        className={cn(
          "flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
          pin === "on" && "bg-selected text-foreground",
          pin === "unsupported" &&
            "opacity-64 hover:bg-transparent hover:text-muted-foreground",
        )}>
        <PinIcon
          aria-hidden
          className={cn("size-4", pin === "on" && "fill-current")}
        />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-none whitespace-nowrap">
        Keep window on top
        {detail !== null && (
          <span className="text-muted-foreground">{detail}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The section at the top third of Customise's scroll, or the last one once the
 * scroll reaches the end.
 */
function useSectionInView() {
  const [current, setCurrent] = useState<SectionId>(SECTIONS[0].id);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-customise]");
    if (!scroller) return;
    const update = () => {
      const {top} = scroller.getBoundingClientRect();
      const line = top + scroller.clientHeight / 3;
      const atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      const reached = SECTIONS.filter(
        ({id}) =>
          (scroller.querySelector(`#${id}`)?.getBoundingClientRect().top ??
            Infinity) <= line,
      );
      setCurrent(
        (atEnd ? SECTIONS.at(-1) : reached.at(-1))?.id ?? SECTIONS[0].id,
      );
    };
    update();
    scroller.addEventListener("scroll", update, {passive: true});
    return () => scroller.removeEventListener("scroll", update);
  }, []);
  return current;
}
