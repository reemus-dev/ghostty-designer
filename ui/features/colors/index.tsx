import {type KeyboardEvent, useEffect, useMemo} from "react";
import {ArrowRightIcon, PinIcon, XIcon} from "lucide-react";
import {PageSection} from "@/components/page";
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
import {slotColors} from "@/core/theme";
import type {ThemeSummary} from "@/core/types";
import {SWATCH_ORDER} from "@/lib/customise";
import {ALT, isEditable, verticalNeighbour} from "@/lib/keys";
import {
  BASE_SLOTS,
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
import {ColorSummary, Warnings} from "./summary";
import {SwatchTile} from "./swatch-tile";

const NAMES = TERMINAL_SLOTS.slice(0, 8).map((id) => describeSlot(id).title);

/** The slot a key moves to through the list: ← → on the grid, [ and ] anywhere. */
function stepSlot(id: SlotId, key: string): SlotId | undefined {
  const delta = {ArrowLeft: -1, ArrowRight: 1, "[": -1, "]": 1}[key];
  if (delta === undefined) return undefined;
  const index = SWATCH_ORDER.indexOf(id) + delta;
  return SWATCH_ORDER[Math.min(SWATCH_ORDER.length - 1, Math.max(0, index))];
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
      const {color} = getStore();
      setColor(stepSlot(color, event.key) ?? color);
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * What the colours are in plain words, every colour as a named swatch with its
 * hex, the editor for the selected one, then the contrast and 256-colour
 * options.
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
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const swatches = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-color]"),
    ];
    const from = swatches.find((swatch) => swatch.dataset.color === selected);
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const next = vertical
      ? from && verticalNeighbour(swatches, from, event.key === "ArrowDown")
      : swatches.find(
          (swatch) => swatch.dataset.color === stepSlot(selected, event.key),
        );
    if (!next) return;
    setColor(next.dataset.color!);
    next.focus();
  };

  const {over, dragProps} = useSlotDrag((id) => colors[id]!.hex);
  const tile = (id: SlotId, named: boolean) => (
    <SwatchTile
      key={id}
      id={id}
      named={named}
      hex={colors[id]!.hex}
      selected={id === selected}
      changed={state.provenance[id] === "draft"}
      warning={warned.has(id)}
      dropTarget={over === id}
      reference={reference}
      dragProps={dragProps(id)}
    />
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
          <Button variant="ghost" onClick={() => showView("themes")}>
            Browse themes <ArrowRightIcon />
          </Button>
        </>
      }>
      <div className="grid grid-cols-[minmax(0,1fr)_clamp(300px,30vw,392px)] grid-rows-[auto_1fr] items-start gap-5">
        <div className="@container flex flex-col gap-5 card p-6">
          <Warnings warnings={state.warnings} />
          <div className="-my-1 flex items-center gap-4">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {reference
                ? `Under each colour is ${reference.name}'s. Click one to use it.`
                : `Click a colour to edit it. Drag to swap, ${ALT}-drag to copy.`}
            </p>
            <ReferencePicker reference={reference} />
          </div>
          <div
            role="group"
            aria-label="Colours"
            className="flex flex-col gap-6"
            onKeyDown={onArrow}>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm text-muted-foreground">Basics</h3>
              <div className="grid grid-cols-2 gap-4 @min-[34rem]:grid-cols-3 @min-[44rem]:grid-cols-4">
                {BASE_SLOTS.map((slot) => tile(slot.key, true))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm text-muted-foreground">
                Terminal colours
              </h3>
              <div className="grid grid-cols-[auto_repeat(8,minmax(0,1fr))] items-start gap-2 [&_code]:hidden @min-[30rem]:[&_code]:block">
                <span />
                {NAMES.map((name) => (
                  <span
                    key={name}
                    className="truncate text-center text-xs text-muted-foreground">
                    {name}
                  </span>
                ))}
                {["Normal", "Bright"].map((row, r) => [
                  <span
                    key={row}
                    className="flex h-7 items-center pr-2 text-sm text-muted-foreground">
                    {row}
                  </span>,
                  ...TERMINAL_SLOTS.slice(r * 8, r * 8 + 8).map((id) =>
                    tile(id, false),
                  ),
                ])}
              </div>
            </div>
          </div>
        </div>
        <ColorEditor
          slot={selected}
          reference={reference}
          className="sticky top-6 col-start-2 row-span-2 row-start-1 card p-6"
        />
        <ColorOptions colors={colors} provenance={state.provenance} />
      </div>
    </PageSection>
  );
}

/**
 * "Pin a theme for reference" until one is pinned, then its name to change it
 * and × to unpin.
 */
function ReferencePicker(props: {reference: ThemeSummary | undefined}) {
  const {reference} = props;
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const names = useMemo(() => themes.map((theme) => theme.name), [themes]);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Combobox
        autoHighlight
        items={names}
        value={reference?.name ?? null}
        onValueChange={(next: string | null) => {
          if (next) void send({type: "reference", theme: next});
        }}>
        <ComboboxTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground [&>svg:last-child]:hidden"
            />
          }>
          <PinIcon
            aria-hidden
            className={reference && "text-muted-foreground"}
          />
          {reference ? (
            <span className="text-muted-foreground">{reference.name}</span>
          ) : (
            "Pin a theme for reference"
          )}
        </ComboboxTrigger>
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
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {reference && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Unpin reference"
          title="Unpin"
          className="text-muted-foreground"
          onClick={() => void send({type: "reference", theme: null})}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}
