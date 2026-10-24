import {type CSSProperties, useMemo, useState} from "react";
import {cn} from "cn";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  type LucideIcon,
  PaletteIcon,
  PinIcon,
} from "lucide-react";
import {CommitInput, NumberField} from "@/components/commit-input";
import {HexChip} from "@/components/swatch";
import {Button} from "@/components/ui/button";
import {Slider} from "@/components/ui/slider";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {
  clampChroma,
  contrastRatio,
  fixLightness,
  formatOklch,
  fromOklch,
  FULL_HEX,
  inSrgbGamut,
  normalizeHex,
  type Oklch,
  parseOklch,
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
import {send, sendLive, useSnapshot} from "@/lib/store";

const C_MAX = 0.37;
const COPIED_MS = 1200;
const TARGETS = [3, 4.5, 7];
const SAMPLE = "~/code ❯ git status  # 0Oo 1lI";

/**
 * Edits one colour: where it comes from, OKLCH sliders that preview while
 * dragging (chroma hatched past sRGB), hex and oklch() fields, copy, reset, and
 * how readable it is against the colour it is read with.
 */
export function ColorEditor(props: {
  slot: SlotId;
  /** A pinned theme whose colour for the slot can be used in one click. */
  reference: ThemeSummary | undefined;
  className?: string;
}) {
  const {slot: id, reference, className} = props;
  const state = useSnapshot((snapshot) => snapshot.state);
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const colors = useMemo(
    () => slotColors(state.effective, colorDefaults),
    [state.effective, colorDefaults],
  );
  const saved = useMemo(
    () => slotColors(state.saved, colorDefaults),
    [state.saved, colorDefaults],
  );
  const themeName = state.themePair?.[state.appearance];
  const theme = themes.find((summary) => summary.name === themeName);
  const themeHex = theme && themeSlot(theme.colors, id);

  const slot = describeSlot(id);
  const hex = colors[id]!.hex;
  const provenance = state.provenance[id] ?? "default";
  const changed = provenance === "draft";
  const referenceHex = reference && themeSlot(reference.colors, id);

  return (
    <section
      aria-label={`Edit ${slot.title}`}
      className={cn("flex flex-col gap-4", className)}>
      <header className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)]">
          {changed && (
            <span className="flex-1" style={{background: saved[id]!.hex}} />
          )}
          <span className="flex-1" style={{background: hex}} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate font-semibold">{slot.title}</h2>
          <p className="truncate text-sm text-fg-3">
            {changed && (
              <>
                Changed · was <code>{saved[id]!.hex}</code>
              </>
            )}
            {provenance === "config" && "From your config"}
            {provenance === "theme" && `From theme ${themeName ?? ""}`}
            {provenance === "default" && "Ghostty's default"}
          </p>
        </div>
        {changed && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void send({type: "reset", key: id})}>
            Reset
          </Button>
        )}
      </header>
      <div className="-mt-1 flex flex-col gap-1 empty:hidden">
        {provenance === "config" &&
          themeName &&
          themeHex !== undefined &&
          themeHex !== hex &&
          themeName !== reference?.name && (
            <ThemeColor
              id={id}
              icon={PaletteIcon}
              theme={themeName}
              hex={themeHex}
              current={hex}
              note="The theme your config names"
            />
          )}
        {reference && referenceHex && (
          <ThemeColor
            id={id}
            icon={PinIcon}
            theme={reference.name}
            hex={referenceHex}
            current={hex}
            note="Your pinned reference"
          />
        )}
      </div>
      <OklchFields key={id} id={id} hex={hex} label={slot.title} />
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

/** Another theme's colour for the slot, with Use to copy it as one undo step. */
function ThemeColor(props: {
  id: SlotId;
  icon: LucideIcon;
  theme: string;
  hex: string;
  /** The slot's colour now: "Same" replaces Use when they match. */
  current: string;
  note: string;
}) {
  const {id, icon: Icon, theme, hex, current, note} = props;
  const title = describeSlot(id).title;
  return (
    <p className="flex items-center gap-2 text-sm text-fg-3">
      <Icon aria-label={note} className="size-3 shrink-0" />
      <span className="truncate" title={note}>
        {theme}
      </span>
      <HexChip color={hex} />
      <span className="flex-1" />
      {hex === current ? (
        "Same"
      ) : (
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Use ${theme}'s ${title.toLowerCase()}`}
          onClick={() => void send(setSlot(id, hex, `${title} from ${theme}`))}>
          Use
        </Button>
      )}
    </p>
  );
}

// ─── OKLCH ───

function OklchFields(props: {id: SlotId; hex: string; label: string}) {
  const {id, hex, label} = props;

  // The OKLCH a drag asked for: greys lose their hue and clamped colours their
  // chroma in hex, so the sliders keep the request until Ghostty shows it.
  const [request, setRequest] = useState<{
    lch: Oklch;
    hex: string;
    pending: boolean;
  }>();
  if (request?.pending && request.hex === hex) {
    setRequest({...request, pending: false});
  }
  const lch =
    request && (request.pending || request.hex === hex)
      ? request.lch
      : toOklch(hex);

  /**
   * Sliders and number fields send throttled while they move; the oklch() field
   * sends once.
   */
  const commit = (next: Oklch, live: boolean) => {
    const nextHex = fromOklch(next);
    setRequest({lch: next, hex: nextHex, pending: true});
    const intent = setSlot(id, nextHex, label);
    if (live) sendLive(intent);
    else void send(intent);
  };
  const commitHex = (text: string) => {
    const next = normalizeHex(text);
    if (!next) return false;
    setRequest(undefined);
    sendLive(setSlot(id, next, label));
    return true;
  };
  const commitOklch = (text: string) => {
    const next = parseOklch(text);
    if (!next) return false;
    commit(next, false);
    return true;
  };

  const edge = clampChroma({...lch, c: C_MAX}).c;
  const edgePct = (Math.min(edge, C_MAX) / C_MAX) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <ChannelSlider
          label="L"
          name="Lightness"
          value={lch.l}
          max={1}
          step={0.001}
          fieldStep={0.01}
          decimals={3}
          track={`linear-gradient(90deg, oklch(0 ${lch.c} ${lch.h}), oklch(0.5 ${lch.c} ${lch.h}), oklch(1 ${lch.c} ${lch.h}))`}
          onChange={(l) => commit({...lch, l}, true)}
        />
        <ChannelSlider
          label="C"
          name="Chroma"
          value={lch.c}
          max={C_MAX}
          step={0.001}
          fieldStep={0.01}
          decimals={3}
          track={[
            edgePct < 100 &&
              `repeating-linear-gradient(-45deg, transparent 0 3px, rgb(255 255 255 / 55%) 3px 4.5px) right / ${100 - edgePct}% 100% no-repeat`,
            `linear-gradient(90deg, oklch(${lch.l} 0 ${lch.h}), oklch(${lch.l} ${edge} ${lch.h}) ${edgePct}%, oklch(${lch.l} ${edge} ${lch.h}))`,
          ]
            .filter(Boolean)
            .join(", ")}
          onChange={(c) => commit({...lch, c}, true)}
        />
        <ChannelSlider
          label="H"
          name="Hue"
          value={lch.h}
          max={360}
          step={0.1}
          fieldStep={1}
          decimals={1}
          track={`linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `oklch(0.72 0.12 ${h})`).join(", ")})`}
          onChange={(h) => commit({...lch, h}, true)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CommitInput
          data-hex-field
          aria-label="Hex"
          reason="A hex colour such as #1e1e2e"
          value={hex}
          live={(text) => FULL_HEX.test(text.trim())}
          className="min-w-[92px] flex-1"
          onCommit={commitHex}
        />
        <CopyButton hex={hex} />
        <CommitInput
          aria-label="OKLCH"
          reason="Such as oklch(0.72 0.12 250)"
          value={formatOklch(lch)}
          className="min-w-46 flex-[3]"
          onCommit={commitOklch}
        />
      </div>
      {!inSrgbGamut(lch) && (
        <p className="-mt-1 text-sm text-fg-3">
          Past the hatched edge, Ghostty gets the nearest colour it can show.
        </p>
      )}
    </div>
  );
}

type ChannelSliderProps = {
  label: string;
  name: string;
  value: number;
  max: number;
  step: number;
  /** What the field's − / + and arrow keys add. */
  fieldStep: number;
  decimals: number;
  /** CSS background of the track. */
  track: string;
  onChange: (value: number) => void;
};

function ChannelSlider(props: ChannelSliderProps) {
  const {label, name, value, max, step, track} = props;
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-3">
      <span aria-hidden className="text-sm font-semibold text-fg-3">
        {label}
      </span>
      <Slider
        data-edits
        aria-label={name}
        min={0}
        max={max}
        step={step}
        largeStep={max / 10}
        value={Math.min(value, max)}
        className="**:data-[slot=slider-track]:h-2! **:data-[slot=slider-track]:[background:var(--track)]!"
        style={
          {"--track": track, "--slider-range": "transparent"} as CSSProperties
        }
        onValueChange={(next) =>
          typeof next === "number" && props.onChange(next)
        }
      />
      <NumberField
        aria-label={`${name} value`}
        value={value.toFixed(props.decimals)}
        min={0}
        max={max}
        step={props.fieldStep}
        className="w-12"
        onCommit={props.onChange}
      />
    </div>
  );
}

function CopyButton(props: {hex: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy hex"
            onClick={() => {
              void navigator.clipboard.writeText(props.hex).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), COPIED_MS);
              });
            }}
          />
        }>
        {copied ? <CheckIcon className="text-live" /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : `Copy ${props.hex}`}</TooltipContent>
    </Tooltip>
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
        <h3 className="flex-1 text-sm text-fg-2">
          {surface ? "With" : "On"} {againstName}
        </h3>
        <span
          className={cn(
            "font-mono text-lg tracking-[-0.02em]",
            !meets && "text-warn",
          )}>
          {formatRatio(ratio)}
          <span className="text-sm text-fg-3">:1</span>
        </span>
      </header>
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg-3">Target</span>
        <ToggleGroup
          variant="segmented"
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
        className="overflow-hidden rounded-lg text-[13px] leading-[20px] shadow-[0_0_0_1px_rgb(255_255_255/6%)]"
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
      <p className="text-sm text-fg-3">
        Readable: meets {target}:1 on {againstName}.
      </p>
    );
  }
  if (!fixed) {
    return (
      <p className="text-sm text-fg-3">
        No lightness reaches {target}:1 on {againstName} with this hue.
      </p>
    );
  }
  const [from, to] = [toOklch(hex).l, toOklch(fixed).l];
  return (
    <div className="flex flex-col gap-1.5 text-sm text-fg-3">
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
      <span className="shrink-0 rounded-sm bg-raised px-1.5 font-sans text-2xs text-fg-2">
        {props.tag}
      </span>
    </div>
  );
}
