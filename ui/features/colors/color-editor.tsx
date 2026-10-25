import {useMemo, useState} from "react";
import {cn} from "cn";
import {ArrowRightIcon, PinIcon} from "lucide-react";
import {ColorPicker} from "@/components/color-picker";
import {HexChip} from "@/components/swatch";
import {Button} from "@/components/ui/button";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {
  type ColorModel,
  contrastRatio,
  fixLightness,
  toOklch,
} from "@/core/color";
import {slotColors} from "@/core/theme";
import type {ThemeSummary} from "@/core/types";
import {useGhosttyFont} from "@/lib/fonts";
import {
  describeSlot,
  formatRatio,
  setSlot,
  type SlotId,
  slotIndex,
  themeSlot,
  warningSlot,
} from "@/lib/slots";
import {send, useSnapshot} from "@/lib/store";

const TARGETS = [3, 4.5, 7];
const SAMPLE = "~/code ❯ git status  # 0Oo 1lI";

/**
 * Edits one slot's colour in the picker, with the pinned theme's colour for it
 * and how readable it is against the colour it is read with.
 */
export function ColorEditor(props: {
  slot: SlotId;
  /** A pinned theme whose colour for the slot can be used in one click. */
  reference: ThemeSummary | undefined;
  className?: string;
}) {
  const {slot: id, reference, className} = props;
  const state = useSnapshot((snapshot) => snapshot.state);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const colors = useMemo(
    () => slotColors(state.effective, colorDefaults),
    [state.effective, colorDefaults],
  );
  const saved = useMemo(
    () => slotColors(state.saved, colorDefaults),
    [state.saved, colorDefaults],
  );
  const [model, setModel] = useState<ColorModel>("oklch");

  const slot = describeSlot(id);
  const hex = colors[id]!.hex;
  const referenceHex = reference && themeSlot(reference.colors, id);

  return (
    <section
      aria-label={`Edit ${slot.title}`}
      className={cn("flex flex-col gap-4", className)}>
      <ColorPicker
        id={id}
        title={slot.title}
        hex={hex}
        saved={saved[id]!.hex}
        model={model}
        onModelChange={setModel}>
        {reference && referenceHex && (
          <ReferenceColor
            id={id}
            theme={reference.name}
            hex={referenceHex}
            current={hex}
          />
        )}
      </ColorPicker>
      <Readability
        key={`${id}:readability`}
        id={id}
        hex={hex}
        against={colors[slot.against]!.hex}
        againstName={describeSlot(slot.against).title.toLowerCase()}
        surface={slot.surface === true}
      />
    </section>
  );
}

/** The pinned theme's colour for the slot, with Use to copy it as one undo step. */
function ReferenceColor(props: {
  id: SlotId;
  theme: string;
  hex: string;
  /** The slot's colour now: "Same" replaces Use when they match. */
  current: string;
}) {
  const {id, theme, hex, current} = props;
  const title = describeSlot(id).title;
  return (
    <p className="-mt-1 flex h-6 items-center gap-2 text-sm text-muted-foreground">
      <PinIcon aria-label="Your pinned reference" className="size-3 shrink-0" />
      <span className="truncate">{theme}</span>
      <HexChip color={hex} />
      <span className="flex-1" />
      {hex === current ? (
        "Same"
      ) : (
        <Button
          size="xs"
          variant="outline"
          aria-label={`Use ${theme}'s ${title.toLowerCase()}`}
          onClick={() => void send(setSlot(id, hex, `${title} from ${theme}`))}>
          Use
        </Button>
      )}
    </p>
  );
}

// ─── Readability ───

type ReadabilityProps = {
  id: SlotId;
  hex: string;
  against: string;
  againstName: string;
  /** Text sits on this colour, so samples swap text and background. */
  surface: boolean;
};

/**
 * The colour's contrast with its partner against a chosen target, and Make
 * readable, which changes lightness only.
 */
function Readability(props: ReadabilityProps) {
  const {id, hex, against, againstName, surface} = props;
  const warning = useSnapshot((snapshot) =>
    snapshot.state.warnings.find((item) => warningSlot(item) === id),
  );
  const font = useGhosttyFont();
  const [target, setTarget] = useState(
    warning?.target ?? (slotIndex(id) === null ? 4.5 : 3),
  );

  const ratio = contrastRatio(hex, against);
  const meets = ratio >= target;
  const fixed = meets ? null : fixLightness(hex, against, target);
  const sample = (color: string) =>
    surface
      ? {background: color, color: against}
      : {background: against, color};

  return (
    <section
      aria-label="Readability"
      className="flex flex-col gap-3 border-t pt-4">
      <header className="flex items-baseline gap-2">
        <h3 className="flex-1 text-sm text-muted-foreground">
          {surface ? "With" : "On"} {againstName}
        </h3>
        <span
          className={cn(
            "text-sm font-medium tabular-nums",
            !meets && "text-warn",
          )}>
          {formatRatio(ratio)}
          <span className="font-normal text-muted-foreground">:1</span>
        </span>
      </header>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Target</span>
        <ToggleGroup
          aria-label="Target contrast"
          value={[String(target)]}
          onValueChange={(next) => next[0] && setTarget(Number(next[0]))}>
          {TARGETS.map((value) => (
            <ToggleGroupItem key={value} value={String(value)}>
              {value}:1
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div
        className="overflow-hidden rounded-lg text-[13px] leading-[20px] ring-1 ring-border"
        style={{fontFamily: font}}>
        <SampleLine style={sample(hex)} tag="now" />
        {fixed && <SampleLine style={sample(fixed)} tag="after" />}
      </div>
      <ReadabilityNote
        hex={hex}
        fixed={fixed}
        meets={meets}
        target={target}
        against={against}
        againstName={againstName}
      />
      {fixed && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() =>
            void send(
              setSlot(id, fixed, `Make ${describeSlot(id).title} readable`),
            )
          }>
          Make readable
        </Button>
      )}
    </section>
  );
}

function ReadabilityNote(props: {
  hex: string;
  fixed: string | null;
  meets: boolean;
  target: number;
  against: string;
  againstName: string;
}) {
  const {hex, fixed, meets, target, against, againstName} = props;
  if (meets) {
    return (
      <p className="text-sm text-muted-foreground">
        Readable: meets {target}:1 on {againstName}.
      </p>
    );
  }
  if (!fixed) {
    return (
      <p className="text-sm text-muted-foreground">
        No lightness reaches {target}:1 on {againstName} with this hue.
      </p>
    );
  }
  const [from, to] = [toOklch(hex).l, toOklch(fixed).l];
  return (
    <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      <p>
        Below {target}:1. Make readable {to > from ? "raises" : "lowers"}{" "}
        lightness {from.toFixed(2)} → {to.toFixed(2)} and keeps the hue.
      </p>
      <p className="flex flex-wrap items-center gap-1.5">
        <HexChip color={hex} />
        <ArrowRightIcon aria-hidden className="size-3 opacity-70" />
        <HexChip color={fixed} />
        <span>· {formatRatio(contrastRatio(fixed, against))}:1</span>
      </p>
    </div>
  );
}

function SampleLine(props: {
  style: {background: string; color: string};
  tag: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-1 first:pt-2 last:pb-2"
      style={{background: props.style.background}}>
      <span className="truncate" style={{color: props.style.color}}>
        {SAMPLE}
      </span>
      <span className="shrink-0 rounded-sm bg-muted px-1.5 font-sans text-2xs text-muted-foreground">
        {props.tag}
      </span>
    </div>
  );
}
