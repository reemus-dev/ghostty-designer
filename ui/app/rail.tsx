import {useEffect, useState} from "react";
import {cn} from "cn";
import {
  AppWindowIcon,
  LayoutGridIcon,
  type LucideIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from "lucide-react";
import {Kbd} from "@/components/ui/kbd";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {SECTION_TITLE, type SectionId} from "@/lib/customise";
import {ALT} from "@/lib/keys";
import {showsSetup, useStore} from "@/lib/store";
import {
  revealSection,
  showView,
  type View,
  VIEW_LABEL,
  VIEWS,
} from "@/lib/views";
import {LiveDot} from "./live-status";

const VIEW_ICON: Record<View, LucideIcon> = {
  customise: SlidersHorizontalIcon,
  themes: LayoutGridIcon,
};

/** Customise's sections in page order. */
const SECTIONS = [
  {id: "colors", icon: PaletteIcon},
  {id: "font", icon: TypeIcon},
  {id: "window", icon: AppWindowIcon},
] as const satisfies readonly {id: SectionId; icon: LucideIcon}[];

/**
 * The views (Alt 1, Alt 2), Customise's sections with the one in view marked,
 * and the live status. Each shows its name on hover.
 */
export function Rail() {
  const setup = useStore(showsSetup);
  const view = useStore((store) => store.view);
  return (
    <div
      data-tauri-drag-region="deep"
      className="flex min-h-0 flex-col items-center gap-3 pb-3 select-none">
      {!setup && <ViewSwitch view={view} />}
      {!setup && view === "customise" && <Sections />}
      <div className="mt-auto">
        <LiveDot />
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
