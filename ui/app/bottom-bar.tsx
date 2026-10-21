import {type ReactNode, useEffect, useLayoutEffect, useRef} from "react";
import {cn} from "cn";
import {
  ChevronUpIcon,
  Columns2Icon,
  Redo2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {ColorSquare} from "@/components/swatch";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {type DraftChange, draftChanges, undoChange} from "@/lib/changes";
import {MOD, SHIFT_MOD} from "@/lib/keys";
import {
  revertAll,
  send,
  setPeek,
  setSaveOpen,
  stepHistory,
  useSnapshot,
} from "@/lib/store";
import {ChangeValues} from "./change-values";

const INLINE_CHIPS = 3;

/**
 * The unsaved changes as chips of their new values (× undoes one), and the ways
 * out: undo, redo, compare with saved, discard and save. Chips that don't fit
 * stay in the list behind the count.
 */
export function BottomBar() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const changes = draftChanges(state, options, colorDefaults);
  const {history} = state;
  const dirty = state.changes > 0;

  return (
    <footer className="flex min-h-16 shrink-0 items-center gap-2 border-t bg-panel px-6 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className={cn("flex min-w-0 flex-col", dirty && "shrink-0")}>
          {dirty ? (
            <ChangeList changes={changes} count={state.changes} />
          ) : (
            <>
              <span className="font-semibold text-fg-2">
                No unsaved changes
              </span>
              <small className="truncate text-sm text-fg-3">
                {state.previewInstalled
                  ? "Changes show in Ghostty as you make them. Nothing is written until you save."
                  : "Ghostty updates when you save."}
              </small>
            </>
          )}
        </div>
        <Chips changes={changes.slice(0, INLINE_CHIPS)} />
      </div>
      <BarButton
        shortcut={`${MOD}Z`}
        disabled={history.undo.length === 0}
        label={
          history.undo.at(-1)
            ? `Undo ${history.undo.at(-1)!.label}`
            : "Nothing to undo"
        }
        onClick={() => stepHistory("undo")}>
        <Undo2Icon />
        Undo
      </BarButton>
      <BarButton
        shortcut={`${SHIFT_MOD}Z`}
        disabled={history.redo.length === 0}
        label={
          history.redo.at(-1)
            ? `Redo ${history.redo.at(-1)!.label}`
            : "Nothing to redo"
        }
        onClick={() => stepHistory("redo")}>
        <Redo2Icon />
        Redo
      </BarButton>
      {dirty && (
        <>
          <CompareButton />
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="outline" onClick={revertAll} />}>
              Discard
            </TooltipTrigger>
            <TooltipContent>
              Discard all changes <Kbd>esc esc</Kbd>
            </TooltipContent>
          </Tooltip>
        </>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              disabled={!dirty}
              className="ml-1"
              onClick={() => setSaveOpen(true)}
            />
          }>
          Save to config…
        </TooltipTrigger>
        <TooltipContent>
          Review and save to your config <Kbd>{MOD}S</Kbd>
        </TooltipContent>
      </Tooltip>
    </footer>
  );
}

function BarButton(props: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled}
            className="px-2"
            onClick={props.onClick}
          />
        }>
        {props.children}
      </TooltipTrigger>
      <TooltipContent>
        {props.label} <Kbd>{props.shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Ghostty shows the saved config while the button is held, like holding `\`. */
function CompareButton() {
  // The last change can go while the button is held, which unmounts it
  // before the pointer comes up.
  useEffect(() => () => setPeek(false), []);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className="px-2 select-none"
            onPointerDown={() => setPeek(true)}
            onPointerUp={() => setPeek(false)}
            onPointerLeave={() => setPeek(false)}
            onPointerCancel={() => setPeek(false)}
            onKeyUp={() => setPeek(false)}
            onBlur={() => setPeek(false)}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") setPeek(true);
            }}
          />
        }>
        <Columns2Icon />
        Compare with saved
      </TooltipTrigger>
      <TooltipContent>
        Press and hold to see your saved config in Ghostty, or hold <Kbd>\</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** "3 unsaved changes ⌃": opens the full list, each with its own undo. */
function ChangeList(props: {changes: DraftChange[]; count: number}) {
  const {changes, count} = props;
  return (
    <Popover>
      <PopoverTrigger className="-ml-1 flex h-7 items-center gap-2 rounded-md px-1 font-semibold whitespace-nowrap outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring">
        <span
          aria-hidden
          className="size-[7px] rounded-full bg-primary-text shadow-[0_0_0_3px_var(--color-primary-soft)]"
        />
        <span>
          {count} unsaved {count === 1 ? "change" : "changes"}
        </span>
        <ChevronUpIcon aria-hidden className="size-3.5 text-fg-3" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[60vh] w-[min(420px,calc(100vw-1.5rem))] gap-0 overflow-y-auto p-1.5">
        {changes.map((change) => (
          <ChangeRow key={change.key} change={change} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ghostty didn't accept the change's value. `palette:N` changes share the
 * `palette` key.
 */
const useRejected = (change: DraftChange) =>
  useSnapshot(
    (snapshot) =>
      snapshot.state.apply.rejected?.includes(change.key.replace(/:.*/, "")) ??
      false,
  );

function ChangeRow(props: {change: DraftChange}) {
  const {change} = props;
  const rejected = useRejected(change);
  return (
    <div className="flex min-h-9 items-center gap-3 rounded-md pr-1 pl-2.5 hover:bg-white/4">
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-medium">{change.label}</span>
        {rejected && (
          <small className="shrink-0 text-sm text-warn">Not applied</small>
        )}
      </span>
      <ChangeValues change={change} />
      <UndoChangeButton change={change} />
    </div>
  );
}

/**
 * From 1280px. Chips that don't fit wrap onto a second line, which the fixed
 * height hides, so those leave the Tab order; the count before them opens the
 * full list.
 */
function Chips(props: {changes: DraftChange[]}) {
  const ref = useRef<HTMLDivElement>(null);
  // What the chips' widths follow: the row is measured again when it changes.
  const shown = JSON.stringify(
    props.changes.map((change) => [change.key, change.after]),
  );
  useLayoutEffect(() => {
    const row = ref.current!;
    const markClipped = () => {
      const bottom = row.getBoundingClientRect().bottom;
      for (const chip of row.children) {
        (chip as HTMLElement).inert =
          chip.getBoundingClientRect().top >= bottom;
      }
    };
    markClipped();
    const observer = new ResizeObserver(markClipped);
    observer.observe(row);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the observer misses chip changes that keep the row's size, so `shown` re-measures
  }, [shown]);
  return (
    <div
      ref={ref}
      className="hidden h-7 min-w-0 flex-wrap items-center gap-1.5 overflow-hidden xl:flex">
      {props.changes.map((change) => (
        <ChangeChip key={change.key} change={change} />
      ))}
    </div>
  );
}

function ChangeChip(props: {change: DraftChange}) {
  const {change} = props;
  const rejected = useRejected(change);
  return (
    <span
      title={`${change.label}: ${change.before} → ${change.after}${rejected ? ". Ghostty didn't accept this value." : ""}`}
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 rounded-lg bg-white/4 pr-0.5 pl-2.5 text-sm hairline",
        rejected &&
          "bg-warn-soft shadow-[inset_0_0_0_1px_var(--color-warn-line)]",
      )}>
      <span className={cn("shrink-0 text-fg-2", rejected && "text-warn")}>
        {change.label}
      </span>
      {change.color ? (
        <ColorSquare color={change.after} />
      ) : (
        <span className="truncate text-fg">{change.after}</span>
      )}
      {rejected && (
        <span className="sr-only">Ghostty didn't accept this value.</span>
      )}
      <UndoChangeButton change={change} />
    </span>
  );
}

function UndoChangeButton(props: {change: DraftChange}) {
  const {change} = props;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Undo the ${change.label} change`}
      title={`Undo the ${change.label} change`}
      onClick={() => void send(undoChange(change))}>
      <XIcon />
    </Button>
  );
}
