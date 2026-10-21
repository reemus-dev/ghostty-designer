import {
  type ComponentProps,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {cn} from "cn";
import {MinusIcon, PlusIcon} from "lucide-react";
import {Input} from "@/components/ui/input";
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";

type CommitInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "onFocus" | "onBlur" | "onKeyDown" | "step"
> & {
  value: string;
  /**
   * Receives an edited value. Returning false marks the text invalid and keeps
   * it.
   */
  onCommit: (text: string) => boolean | void;
  /**
   * Typed text to commit once typing pauses, before Enter or blur. Text it
   * passes but `onCommit` rejects waits, unmarked, for more typing.
   */
  live?: (text: string) => boolean;
  /**
   * The text `by` steps up or down. With it, − / + buttons flank the field and
   * the arrow keys step, ten at a time with Shift. Each step commits.
   */
  step?: (text: string, by: number) => string;
  /**
   * What the field takes, shown while its text is invalid and the field is
   * focused or hovered.
   */
  reason?: string;
};

/**
 * Text being edited, the value it started from, and whether any of it was
 * committed.
 */
type Edit = {text: string; start: string; committed: boolean};

/**
 * How long typing rests before a live commit, so values on the way, such as 1
 * on the way to 16, never reach Ghostty.
 */
const TYPING_PAUSE_MS = 250;
/**
 * How long a held step button waits before it repeats, and how often it then
 * steps.
 */
const HOLD_MS = 400;
const REPEAT_MS = 60;

/**
 * A monospace text field that commits on Enter or blur, and while typing when
 * `live`. Escape returns to the value from before the edit, committing it again
 * if the edit committed anything; with nothing edited it falls through to the
 * global keys.
 */
export function CommitInput(props: CommitInputProps) {
  const {value, onCommit, live, step, reason, className, ...rest} = props;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- React 19's useRef requires its initial value
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const text = edit?.text ?? value;

  const commitTyped = (next: string) => {
    if (onCommit(next) === false) return;
    setInvalid(false);
    setEdit((current) => current && {...current, committed: true});
  };
  const type = (next: string) => {
    clearTimeout(typing.current);
    setEdit({
      text: next,
      start: edit?.start ?? value,
      committed: !!edit?.committed,
    });
    if (live?.(next)) {
      typing.current = setTimeout(() => commitTyped(next), TYPING_PAUSE_MS);
    }
  };
  const stepBy = (by: number) => {
    if (!step) return;
    clearTimeout(typing.current);
    const next = step(text, by);
    const committed = onCommit(next) !== false;
    if (committed) setInvalid(false);
    setEdit({
      text: next,
      start: edit?.start ?? value,
      committed: committed || !!edit?.committed,
    });
  };
  // The step a held button repeats, 0 when no button is held.
  const [held, setHeld] = useState(0);
  const repeat = useEffectEvent(() => stepBy(held));
  useEffect(() => {
    if (held === 0) return;
    let timer = setTimeout(function tick() {
      repeat();
      timer = setTimeout(tick, REPEAT_MS);
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [held]);

  const finish = () => {
    clearTimeout(typing.current);
    if (edit === null || edit.text === value) {
      setEdit(null);
      return;
    }
    const ok = onCommit(edit.text) !== false;
    setInvalid(!ok);
    if (ok) setEdit(null);
  };
  const revert = () => {
    clearTimeout(typing.current);
    if (edit?.committed) onCommit(edit.start);
    setEdit(null);
    setInvalid(false);
  };

  const Field = step ? InputGroupInput : Input;
  const input = (
    <Field
      data-edits
      ref={ref}
      spellCheck={false}
      {...rest}
      aria-invalid={invalid || undefined}
      value={text}
      className={cn("font-mono text-sm", className)}
      onChange={(event) => type(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        finish();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish();
        if (step && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          const by = event.key === "ArrowUp" ? 1 : -1;
          stepBy(event.shiftKey ? by * 10 : by);
        }
        if (edit === null || event.key !== "Escape") return;
        event.preventDefault();
        revert();
      }}
    />
  );
  const field =
    reason === undefined ? (
      input
    ) : (
      <Tooltip
        open={invalid && (focused || hovered)}
        onOpenChange={(open) => setHovered(open)}>
        <TooltipTrigger render={input} />
        <TooltipContent side="bottom">{reason}</TooltipContent>
      </Tooltip>
    );
  if (!step) return field;

  // A step button leaves focus in the field, or puts it there, so a quick run
  // of steps reads the field's own text rather than a value still in flight.
  // It steps on press and repeats while held. A click without a pointer, such
  // as from a screen reader, steps once.
  const button = (by: 1 | -1) => (
    <InputGroupButton
      size="icon-xs"
      tabIndex={-1}
      aria-label={by > 0 ? "Step up" : "Step down"}
      className="mx-px size-5 text-fg-3 hover:text-fg"
      onPointerUp={() => setHeld(0)}
      onPointerLeave={() => setHeld(0)}
      onPointerCancel={() => setHeld(0)}
      onPointerDown={(event) => {
        event.preventDefault();
        if (event.button !== 0) return;
        const steps = event.shiftKey ? by * 10 : by;
        ref.current?.focus();
        stepBy(steps);
        setHeld(steps);
      }}
      onClick={(event) => {
        if (event.detail !== 0) return;
        ref.current?.focus();
        stepBy(event.shiftKey ? by * 10 : by);
      }}>
      {by > 0 ? <PlusIcon /> : <MinusIcon />}
    </InputGroupButton>
  );
  return (
    <InputGroup className="h-[26px] w-fit">
      {button(-1)}
      {field}
      {button(1)}
    </InputGroup>
  );
}

/**
 * The number a step changes; what follows it, such as a unit or a second side,
 * stays.
 */
const LEADING_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/;

const decimals = (text: string) => text.split(".", 2)[1]?.length ?? 0;

/**
 * A number field that commits as it is typed, clamped to `min`..`max`, between
 * − / + steps of `step`. Text that is not a number, or not whole when `whole`,
 * goes to `onCommitText` when given, such as a value in another unit, and
 * otherwise stays marked invalid. Commits arrive while typing, so send them
 * with `sendLive`.
 */
export function NumberField(
  props: Omit<
    CommitInputProps,
    "onCommit" | "inputMode" | "live" | "step" | "min" | "max"
  > & {
    min?: number;
    max?: number;
    step?: number;
    whole?: boolean;
    onCommit: (value: number) => void;
    onCommitText?: (text: string) => boolean | void;
  },
) {
  const {
    min = -Infinity,
    max = Infinity,
    step = 1,
    whole,
    onCommit,
    onCommitText,
    className,
    ...rest
  } = props;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <CommitInput
      reason={whole ? "Whole numbers only" : "Numbers only"}
      {...rest}
      inputMode={whole ? "numeric" : "decimal"}
      className={cn("w-10 px-0 text-center", className)}
      live={(text) => text.trim() !== ""}
      step={(text, by) => {
        const trimmed = text.trim();
        const lead = LEADING_NUMBER.exec(trimmed)?.[0] ?? "";
        const from = lead ? Number(lead) : clamp(0);
        const places = Math.max(decimals(String(step)), decimals(lead));
        const next = clamp(Number((from + by * step).toFixed(places)));
        return String(next) + (lead ? trimmed.slice(lead.length) : "");
      }}
      onCommit={(text) => {
        const typed = Number(text);
        const number =
          text.trim() !== "" &&
          (whole ? Number.isSafeInteger(typed) : Number.isFinite(typed));
        if (number) onCommit(clamp(typed));
        else return onCommitText ? onCommitText(text) : false;
      }}
    />
  );
}
