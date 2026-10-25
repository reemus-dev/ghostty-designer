import {type ReactNode, useId, useState} from "react";
import {cn} from "cn";
import {AppleIcon, InfoIcon, RotateCcwIcon} from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {Slider} from "@/components/ui/slider";
import {Switch} from "@/components/ui/switch";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {FULL_HEX, parseHex} from "@/core/color";
import type {OptionMeta, Reload} from "@/core/types";
import {parseMetric} from "@/core/values";
import {PLATFORM_LABEL} from "@/lib/customise";
import {send, sendLive, useEffective, useSnapshot} from "@/lib/store";
import {CommitInput, NumberField} from "./commit-input";
import {IconButton} from "./icon-button";
import {Swatch} from "./swatch";

const RELOAD_NOTE: Record<Reload, string | null> = {
  live: null,
  "new-surface": "New tabs and splits only",
  "new-window": "New windows only",
  special: null,
};

/** Enums this short render as a segmented control, longer ones as a select. */
const SEGMENTED_MAX = 3;

type ControlProps = {
  option: OptionMeta;
  value: string;
  /**
   * Commits a new first value. Repeatable keys keep their other values; an
   * empty value drops the first, or unsets a font family altogether.
   */
  commit: (value: string, live?: boolean) => void;
};

/**
 * One catalog option, rendered from its control kind: label with the Ghostty
 * doc in a tooltip, when it applies, the unsaved-change marker that resets it,
 * and a control that sends `set` intents (throttled while dragging). Repeatable
 * keys edit their first value and keep the rest. The control wraps under the
 * label when the row is too narrow for both. Rows stack with hairlines between
 * them.
 */
export function OptionControl(props: {option: OptionMeta; className?: string}) {
  const {option, className} = props;
  const values = useEffective(option.key) ?? option.defaults;

  const commit = (value: string, live = false) => {
    let next = [value];
    if (option.repeatable) {
      if (value) next = [value, ...values.slice(1)];
      // A fallback family must not become the primary one.
      else next = option.control.kind === "font-family" ? [] : values.slice(1);
    }
    const intent = {type: "set", key: option.key, values: next} as const;
    if (live) sendLive(intent);
    else void send(intent);
  };

  return (
    <OptionRow option={option} className={className}>
      <OptionInput option={option} value={values[0] ?? ""} commit={commit} />
    </OptionRow>
  );
}

/**
 * An option's row around any control: its label and notes on the left, the
 * control on the right.
 */
export function OptionRow(props: {
  option: OptionMeta;
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  const {option, note, className, children} = props;
  return (
    <div
      data-option={option.key}
      className={cn(
        "group/option flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 not-first:border-t",
        className,
      )}>
      <OptionLabel
        option={option}
        note={note}
        className="max-w-full min-w-28 flex-1"
      />
      <div data-option-control className="ml-auto shrink-0">
        {children}
      </div>
    </div>
  );
}

/**
 * The option's name and an icon that open its doc tooltip, the changed marker
 * and when it applies. A setting only this platform has shows the platform's
 * icon in place of the info icon.
 */
function OptionLabel(props: {
  option: OptionMeta;
  note: string | undefined;
  className?: string;
}) {
  const {option, note, className} = props;
  const changed = useSnapshot(
    (snapshot) => snapshot.state.provenance[option.key] === "draft",
  );
  const rejected = useSnapshot(
    (snapshot) => snapshot.state.apply.rejected?.includes(option.key) ?? false,
  );
  // The other platform's options sit in a card titled for it.
  const onlyHere = useSnapshot((snapshot) =>
    option.platforms.length === 1 &&
    option.platforms[0] === snapshot.ghostty.platform
      ? snapshot.ghostty.platform
      : null,
  );
  const notes = [note, RELOAD_NOTE[option.reload]].filter(Boolean);
  const [first = "", next] = option.doc.split("\n\n", 2);
  // A summary that ends "Valid values:" needs the list that follows it.
  const summary = first.endsWith(":") && next ? `${first}\n${next}` : first;
  const doc = summary || "No documentation.";
  // Ghostty's docs mark code with backticks.
  const docParts = doc.split("`").map((part, index) =>
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts never reorder
      <code key={index} className="text-sm">
        {part}
      </code>
    ) : (
      part
    ),
  );
  const platformNote = onlyHere && `${PLATFORM_LABEL[onlyHere]} only`;
  const docNotes = [option.reloadNote, platformNote].filter(Boolean);
  const Icon = onlyHere ? PLATFORM_ICON[onlyHere] : InfoIcon;
  const helpId = `${useId()}-help`;
  // A click opens the doc at once, without waiting out the hover delay.
  const [docOpen, setDocOpen] = useState(false);
  return (
    <div className={cn("flex min-w-0 flex-col gap-px", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <Tooltip open={docOpen} onOpenChange={setDocOpen}>
          <TooltipTrigger
            render={<span />}
            tabIndex={0}
            closeOnClick={false}
            onClick={() => setDocOpen(true)}
            aria-describedby={helpId}
            className="group/doc flex min-w-0 items-center gap-1.5 rounded-sm">
            <span className="truncate font-medium text-foreground">
              {option.label}
            </span>
            <Icon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/doc:text-foreground group-focus-visible/doc:text-foreground",
                onlyHere && "fill-current",
              )}
            />
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            className="max-w-md flex-col items-start gap-2.5 px-3.5 py-3 text-base whitespace-pre-line">
            <code className="rounded-md bg-selected px-2 py-0.5 text-base font-medium">
              {option.key}
            </code>
            <span>{docParts}</span>
            {docNotes.length > 0 && (
              <span className="flex flex-col gap-1 self-stretch border-t border-border pt-2.5">
                {docNotes.map((docNote) => (
                  <span key={docNote}>{docNote}</span>
                ))}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
        {/* The tooltip only exists while open; this is what assistive tech reads. */}
        <span id={helpId} className="sr-only">
          {[option.key, doc.replaceAll("`", ""), ...docNotes].join(". ")}
        </span>
        {changed && <OptionReset option={option} />}
      </span>
      {notes.length > 0 && (
        <small className="text-sm text-muted-foreground">
          {notes.join(" · ")}
        </small>
      )}
      {rejected && (
        <small className="text-sm text-warn">
          Ghostty didn't accept this value
        </small>
      )}
    </div>
  );
}

/** Lucide has no Linux icon, so this draws Tux. */
function TuxIcon(props: {className?: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={props.className}>
      <path
        fillRule="evenodd"
        d="M12 1.5c-2.4 0-3.9 1.9-3.9 4.4v2.4c0 1.4-1.2 2.6-2.4 4.4-1 1.6-1.6 3.4-1.2 5.3h15c.4-1.9-.2-3.7-1.2-5.3-1.2-1.8-2.4-3-2.4-4.4V5.9c0-2.5-1.5-4.4-3.9-4.4Zm-1.3 3.4a.9 1.1 0 1 0 0 2.2.9 1.1 0 0 0 0-2.2Zm2.6 0a.9 1.1 0 1 0 0 2.2.9 1.1 0 0 0 0-2.2ZM12 10.2c-1.8 0-3.2 2.3-3.2 5s1.4 3.6 3.2 3.6 3.2-.9 3.2-3.6-1.4-5-3.2-5Z"
      />
      <path d="M3.5 21.2c0-1.6 1.6-2.7 3.6-2.7s3.4 1.1 3.4 2.7c0 .7-.6 1.3-1.3 1.3H4.8c-.7 0-1.3-.6-1.3-1.3Zm17 0c0-1.6-1.6-2.7-3.6-2.7s-3.4 1.1-3.4 2.7c0 .7.6 1.3 1.3 1.3h4.4c.7 0 1.3-.6 1.3-1.3Z" />
    </svg>
  );
}

const PLATFORM_ICON = {macos: AppleIcon, linux: TuxIcon};

/**
 * The unsaved-change marker beside a setting's name. It turns into a reset that
 * discards the draft while the row is hovered or the marker has focus.
 */
function OptionReset(props: {option: OptionMeta}) {
  const {option} = props;
  return (
    <IconButton
      label={`Reset ${option.label}`}
      className="-m-1"
      onClick={() => void send({type: "reset", key: option.key})}>
      <span className="size-1.5 rounded-full bg-changed group-hover/option:hidden group-focus-visible/button:hidden" />
      <RotateCcwIcon className="hidden group-hover/option:block group-focus-visible/button:block" />
    </IconButton>
  );
}

function OptionInput(props: ControlProps) {
  switch (props.option.control.kind) {
    case "bool": {
      return (
        <Switch
          aria-label={props.option.label}
          checked={props.value === "true"}
          onCheckedChange={(checked) => props.commit(String(checked))}
        />
      );
    }
    case "enum": {
      return <EnumInput {...props} />;
    }
    case "number": {
      return <NumberInput {...props} />;
    }
    case "metric": {
      return <MetricInput {...props} />;
    }
    // The views give their flags options switches; Ghostty's flag syntax is the fallback.
    case "text":
    case "flags": {
      return <TextInput {...props} />;
    }
    case "color": {
      return <ColorInput {...props} />;
    }
    case "font-family": {
      return <FontFamilyInput {...props} />;
    }
  }
}

function EnumInput(props: ControlProps) {
  const {option, value, commit} = props;
  if (option.control.kind !== "enum") return null;
  const {values} = option.control;

  if (values.length <= SEGMENTED_MAX) {
    return (
      <ToggleGroup
        aria-label={option.label}
        value={[value]}
        onValueChange={(next) => next[0] !== undefined && commit(next[0])}>
        {values.map((item) => (
          <ToggleGroupItem key={item} value={item}>
            {item}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && commit(next)}>
      <SelectTrigger aria-label={option.label} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberInput(props: ControlProps) {
  const {option, value, commit} = props;
  if (option.control.kind !== "number") return null;
  const {min, max, step = 1, unit} = option.control;
  const decimals = String(step).split(".", 2)[1]?.length ?? 0;
  const field = (
    <NumberField
      aria-label={`${option.label} value`}
      value={value}
      min={min}
      max={max}
      step={step}
      whole={Number.isSafeInteger(step)}
      onCommit={(next) => commit(String(next), true)}
    />
  );
  if (min === undefined || max === undefined) {
    return (
      <span className="flex items-center gap-1.5">
        {field}
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    );
  }
  return (
    <SliderField
      label={option.label}
      min={min}
      max={max}
      step={step}
      value={Number(value)}
      unit={unit}
      onSlide={(next) => commit(next.toFixed(decimals), true)}>
      {field}
    </SliderField>
  );
}

/**
 * A slider with its value as a typed field (`children`), which also takes
 * values the slider does not reach, such as 15.5. Text the field rejects stays
 * marked invalid.
 */
export function SliderField(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onSlide: (value: number) => void;
  children: ReactNode;
}) {
  const {label, min, max, value, unit} = props;
  return (
    <div className="flex items-center gap-3">
      <Slider
        data-edits
        aria-label={label}
        className="w-[clamp(5rem,8vw,8rem)]!"
        min={min}
        max={max}
        step={props.step}
        value={
          Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
        }
        onValueChange={(next) =>
          typeof next === "number" && props.onSlide(next)
        }
      />
      <span className="flex items-center gap-1">
        {props.children}
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

/** An adjust-* metric: whole pixels, or a percentage. */
function MetricInput(props: ControlProps) {
  const {option, value, commit} = props;
  return (
    <NumberField
      whole
      aria-label={option.label}
      placeholder="0"
      reason="Whole pixels, or a percentage such as 12.5%"
      value={value}
      className="w-12"
      onCommit={(next) => commit(String(next), true)}
      onCommitText={(text) => {
        const next = parseMetric(text, "px");
        if (next === null) return false;
        commit(next, true);
      }}
    />
  );
}

function TextInput(
  props: ControlProps & {
    className?: string;
    placeholder?: string;
    live?: (text: string) => boolean;
  },
) {
  const {option, value, commit, live} = props;
  return (
    <CommitInput
      aria-label={option.label}
      placeholder={props.placeholder}
      value={value}
      live={live}
      className={cn("w-40", props.className)}
      onCommit={(text) => commit(text, live !== undefined)}
    />
  );
}

/** A swatch that opens the system colour picker, plus a hex or keyword field. */
function ColorInput(props: ControlProps) {
  const {option, value, commit} = props;
  const hex = parseHex(value) ? value : null;
  const keywords =
    option.control.kind === "color" ? (option.control.keywords ?? []) : [];
  return (
    <div className="flex items-center gap-2">
      <label className="relative size-[30px] cursor-pointer rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2">
        <Swatch color={hex ?? "transparent"} className="size-[30px]" />
        <input
          type="color"
          aria-label={`Pick ${option.label}`}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={hex ?? "#000000"}
          onChange={(event) => commit(event.target.value, true)}
        />
      </label>
      <TextInput
        {...props}
        className="w-28"
        placeholder={keywords.length > 0 ? keywords.join(" · ") : "#rrggbb"}
        live={(text) =>
          FULL_HEX.test(text.trim()) || keywords.includes(text.trim())
        }
      />
    </div>
  );
}

function FontFamilyInput(props: ControlProps) {
  const {option, value, commit} = props;
  const fonts = useSnapshot((snapshot) => snapshot.fonts);
  const defaultLabel =
    option.group === "fonts" ? "Same as font" : "Ghostty default";
  // "" leaves the key unset.
  const families = ["", ...(fonts?.map((font) => font.family) ?? [])];
  const label = (family: string) => family || defaultLabel;
  return (
    <Combobox
      items={families}
      value={value}
      itemToStringLabel={label}
      onValueChange={(next: string | null) => next !== null && commit(next)}>
      <ComboboxInput
        aria-label={option.label}
        className="w-52"
        placeholder={fonts ? "Search fonts" : "Scanning fonts…"}
      />
      <ComboboxContent>
        <ComboboxEmpty>No installed family matches.</ComboboxEmpty>
        <ComboboxList>
          {(family: string) => (
            <ComboboxItem key={family} value={family}>
              {label(family)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
