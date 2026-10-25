import {type KeyboardEvent, useEffect, useMemo} from "react";
import {cn} from "cn";
import {LayoutGridIcon, PinIcon, XIcon} from "lucide-react";
import {PageSection} from "@/components/page";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {slotColors} from "@/core/theme";
import type {ThemeSummary} from "@/core/types";
import {SWATCH_ORDER} from "@/lib/customise";
import {type Direction, isEditable, neighbour} from "@/lib/keys";
import {
  describeSlot,
  type SlotId,
  TERMINAL_SLOTS,
  warningSlot,
} from "@/lib/slots";
import {
  getStore,
  openSaveTheme,
  send,
  setColor,
  useSnapshot,
  useStore,
} from "@/lib/store";
import {showView} from "@/lib/views";
import {ColorEditor} from "./color-editor";
import {ColorOptions} from "./options";
import {useSlotDrag} from "./slot-drag";
import {ColorSummary, SwatchHint} from "./summary";
import {SwatchTile} from "./swatch-tile";

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** The basics as columns of a colour and the text on it, under row names. */
const BASICS: {name: string; background?: SlotId; text: SlotId}[] = [
  {name: "Default", background: "background", text: "foreground"},
  {name: "Cursor", background: "cursor-color", text: "cursor-text"},
  {
    name: "Selection",
    background: "selection-background",
    text: "selection-foreground",
  },
  {name: "Bold", text: "bold-color"},
];

/** The slot before or after one in the list, which [ and ] step through. */
function stepSlot(id: SlotId, delta: number) {
  const index = SWATCH_ORDER.indexOf(id) + delta;
  return SWATCH_ORDER[Math.min(SWATCH_ORDER.length - 1, Math.max(0, index))]!;
}

/** [ and ] step through the colours from anywhere on Customise. */
function useBracketKeys() {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditable(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.key !== "[" && event.key !== "]")
      )
        return;
      event.preventDefault();
      setColor(stepSlot(getStore().color, event.key === "[" ? -1 : 1));
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * What the colours are in plain words, every colour as a swatch, the editor for
 * the selected one, then the contrast and 256-colour options. The swatches and
 * the editor share a card until the window is wide enough to put the editor in
 * a column of its own.
 */
export function ColorsSection() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const selected = useStore((store) => store.color);

  const reference = useSnapshot((snapshot) =>
    snapshot.themes.find((theme) => theme.name === snapshot.state.reference),
  );
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const colors = useMemo(
    () => slotColors(state.effective, colorDefaults),
    [state.effective, colorDefaults],
  );
  const warned = new Set(state.warnings.map(warningSlot));

  useBracketKeys();

  const onArrow = (event: KeyboardEvent<HTMLElement>) => {
    const direction = ARROWS[event.key];
    if (!direction) return;
    event.preventDefault();
    const swatches = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-color]"),
    ];
    const from = swatches.find((swatch) => swatch.dataset.color === selected);
    const next = from && neighbour(swatches, from, direction);
    if (!next) return;
    setColor(next.dataset.color!);
    next.focus();
  };

  const {over, dragProps} = useSlotDrag((id) => colors[id]!.hex);
  const tile = (id: SlotId, half?: "top" | "bottom") => (
    <SwatchTile
      key={id}
      id={id}
      half={half}
      hex={colors[id]!.hex}
      selected={id === selected}
      changed={state.provenance[id] === "draft"}
      warning={warned.has(id)}
      dropTarget={over === id}
      reference={reference}
      dragProps={dragProps(id)}
    />
  );
  // A column of two joined colours over their name. A pinned theme's strip
  // under each colour parts the pair. Without a top colour, the bottom one
  // keeps its row.
  const column = (name: string, top: SlotId | undefined, bottom: SlotId) => (
    <div
      key={bottom}
      className={cn("flex min-w-0 flex-col", reference && "gap-1.5")}>
      {top ? (
        tile(top, reference ? undefined : "top")
      ) : (
        <span className="flex-1" />
      )}
      {tile(bottom, reference || !top ? undefined : "bottom")}
      <span className="mt-1.5 flex justify-center text-2xs whitespace-nowrap text-muted-foreground">
        {name}
      </span>
    </div>
  );

  return (
    <PageSection
      id="colors"
      summary={<ColorSummary state={state} />}
      actions={
        <>
          <Button variant="ghost" onClick={() => openSaveTheme("shown")}>
            Save as theme…
          </Button>
          <ReferencePicker reference={reference} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Browse themes"
                  onClick={() => showView("themes")}
                />
              }>
              <LayoutGridIcon />
            </TooltipTrigger>
            <TooltipContent>Browse themes</TooltipContent>
          </Tooltip>
        </>
      }>
      <div className="grid grid-cols-1 items-start gap-5 split:editor-columns split:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-5 card p-4 sm:p-6 split:contents">
          <div className="flex flex-col gap-5 split:card split:p-6">
            <SwatchHint warnings={state.warnings} />
            <div
              role="group"
              aria-label="Colours"
              className="flex flex-col gap-5"
              onKeyDown={onArrow}>
              <div className="flex flex-col gap-3">
                <h3 className="text-sm text-muted-foreground">Basics</h3>
                <div className="grid grid-cols-8 gap-x-2">
                  <div
                    className={cn(
                      "col-span-2 flex flex-col text-2xs text-muted-foreground",
                      reference && "gap-1.5",
                    )}>
                    <span className="flex flex-1 items-center">Background</span>
                    <span className="flex flex-1 items-center">Text</span>
                    <span aria-hidden className="mt-1.5 h-lh" />
                  </div>
                  {BASICS.map((basic) =>
                    column(basic.name, basic.background, basic.text),
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="text-sm text-muted-foreground">
                    Terminal colours
                  </h3>
                  <span className="text-2xs text-muted-foreground">
                    top normal · bottom bright
                  </span>
                </div>
                <div className="grid grid-cols-8 gap-x-2">
                  {TERMINAL_SLOTS.slice(0, 8).map((id, i) =>
                    column(describeSlot(id).title, id, TERMINAL_SLOTS[i + 8]!),
                  )}
                </div>
              </div>
            </div>
          </div>
          <ColorEditor
            slot={selected}
            reference={reference}
            className="border-t pt-5 split:sticky split:top-6 split:col-start-2 split:row-span-2 split:row-start-1 split:card split:border-t-0 split:p-6"
          />
        </div>
        <ColorOptions colors={colors} provenance={state.provenance} />
      </div>
    </PageSection>
  );
}

/**
 * A pin until a theme is pinned, then its name to change it and × to unpin. The
 * theme the config names leads the list.
 */
function ReferencePicker(props: {reference: ThemeSummary | undefined}) {
  const {reference} = props;
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const named = useSnapshot((snapshot) =>
    snapshot.state.draft.theme === null
      ? snapshot.state.themePair?.[snapshot.state.appearance]
      : undefined,
  );
  const names = useMemo(() => {
    const all = themes.map((theme) => theme.name);
    return named !== undefined && all.includes(named)
      ? [named, ...all.filter((name) => name !== named)]
      : all;
  }, [themes, named]);
  return (
    <div className="flex items-center gap-0.5">
      <Combobox
        autoHighlight
        items={names}
        value={reference?.name ?? null}
        onValueChange={(next: string | null) => {
          if (next) void send({type: "reference", theme: next});
        }}>
        <Tooltip>
          <TooltipTrigger
            render={
              <ComboboxTrigger
                render={
                  <Button
                    variant="ghost"
                    size={reference ? "default" : "icon"}
                    aria-label={reference ? undefined : "Pin a theme"}
                    className="[&>svg:last-child]:hidden"
                  />
                }
              />
            }>
            <PinIcon aria-hidden />
            {reference && (
              <span className="max-w-36 truncate">{reference.name}</span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {reference
              ? `Change the pinned theme, ${reference.name}`
              : "Pin a theme for reference"}
          </TooltipContent>
        </Tooltip>
        <ComboboxContent align="end" className="w-64">
          <ComboboxInput
            showTrigger={false}
            aria-label="Theme to pin"
            placeholder="Search themes"
          />
          <ComboboxEmpty>No theme matches.</ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name}>
                <Truncate>{name}</Truncate>
                {name === named && (
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                    In your config
                  </span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {reference && (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Unpin reference"
          title="Unpin"
          onClick={() => void send({type: "reference", theme: null})}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}
