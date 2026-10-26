import {type Ref, type RefObject, useEffect, useRef, useState} from "react";
import {cn} from "cn";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  LayersIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {errorText} from "@/core/errors";
import type {ConfigOverride, SavePlan, SaveResult} from "@/core/types";
import {draftChanges} from "@/lib/changes";
import {tildePath} from "@/lib/paths";
import {session, setSaveOpen, useSnapshot, useStore} from "@/lib/store";
import {appName} from "@/lib/views";
import {ChangeValues} from "./change-values";

type Phase =
  | {type: "loading"}
  /** `failure`: why the save before this plan failed. */
  | {type: "plan"; plan: SavePlan; failure?: string}
  | {type: "saving"; plan: SavePlan}
  | {type: "saved"; result: SaveResult}
  | {type: "error"; message: string};

function alertOf(phase: Phase) {
  if (phase.type === "error") return phase.message;
  if (phase.type === "plan") return phase.failure;
}

/** ⌘S: what saving writes, in plain words, then a calm confirmation. */
export function SaveSheet() {
  const open = useStore((store) => store.saveOpen);
  const cancel = useRef<HTMLButtonElement>(null);
  /** A save in flight: the sheet stays open for its confirmation or error. */
  const savingRef = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!savingRef.current) setSaveOpen(next);
      }}>
      {/* Centred clear of the toolbar row, where macOS draws the traffic lights. */}
      <DialogContent
        initialFocus={cancel}
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-6rem)] flex-col gap-5 sm:max-w-[520px]">
        <SaveFlow ref={cancel} savingRef={savingRef} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounts with the open sheet, so each opening plans afresh. `ref` gets Cancel,
 * which takes the initial focus; `savingRef` follows the save in flight.
 */
function SaveFlow(props: {
  ref: Ref<HTMLButtonElement>;
  savingRef: RefObject<boolean>;
}) {
  const {ref, savingRef} = props;
  const [phase, setPhase] = useState<Phase>({type: "loading"});
  const [backup, setBackup] = useState(true);
  const [showDiff, setShowDiff] = useState(false);

  /** Numbers plans, so only the latest shows; unmounting drops them all. */
  const plans = useRef(0);
  /** Plans the save; after a failed one, shows why above the new plan. */
  const plan = (failure?: string) => {
    const id = ++plans.current;
    session()
      .planSave()
      .then((next) => {
        if (id !== plans.current) return;
        setPhase({type: "plan", plan: next, failure});
        // Lines commented out, or edits across files, are worth seeing before saving.
        setShowDiff(next.conflicts.length > 0 || next.files.length > 1);
      })
      .catch((error: unknown) => {
        if (id !== plans.current) return;
        setPhase({type: "error", message: failure ?? errorText(error)});
      });
  };

  useEffect(() => {
    plan();
    const counter = plans;
    return () => {
      counter.current++;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- plans once, when the sheet opens
  }, []);

  if (phase.type === "saved") return <Saved result={phase.result} />;

  const shown =
    phase.type === "plan" || phase.type === "saving" ? phase.plan : null;
  const alert = alertOf(phase);
  const save = () => {
    if (!shown) return;
    setPhase({type: "saving", plan: shown});
    savingRef.current = true;
    session()
      .save(shown.id, shown.replacesColors && backup)
      .then((result) => setPhase({type: "saved", result}))
      .catch((error: unknown) => plan(errorText(error)))
      .finally(() => {
        savingRef.current = false;
      });
  };

  return (
    <>
      <PlanHeader />
      <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6">
        {phase.type === "loading" && (
          <p className="text-sm text-muted-foreground">
            Checking what will change…
          </p>
        )}
        {alert !== undefined && (
          <p
            role="alert"
            className="flex gap-2 rounded-xl bg-warn/12 p-3 text-sm text-foreground inset-ring inset-ring-warn/28">
            <TriangleAlertIcon
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-warn"
            />
            {alert}
          </p>
        )}
        <ChangeTable />
        {shown && <Notes plan={shown} backup={backup} onBackup={setBackup} />}
        {shown && showDiff && <Diffs plan={shown} />}
      </div>
      <DialogFooter>
        {shown && shown.files.length > 0 && (
          <button
            type="button"
            aria-expanded={showDiff}
            className="group/diff flex h-7 items-center gap-1.5 rounded-md font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowDiff(!showDiff)}>
            <ChevronRightIcon
              aria-hidden
              className="size-3 text-muted-foreground transition-transform group-aria-expanded/diff:rotate-90"
            />
            Show exact changes
          </button>
        )}
        <span className="flex-1" />
        <Button
          ref={ref}
          variant="outline"
          disabled={phase.type === "saving"}
          onClick={() => setSaveOpen(false)}>
          Cancel
        </Button>
        <Button disabled={phase.type !== "plan"} onClick={save}>
          {phase.type === "saving" ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PlanHeader() {
  const count = useSnapshot((snapshot) => snapshot.state.changes);
  const configPath = useSnapshot((snapshot) => snapshot.ghostty.configPath);
  return (
    <DialogHeader className="gap-3">
      <DialogTitle className="leading-snug">
        Save {count} {count === 1 ? "change" : "changes"} to{" "}
        <span className="mt-1 block font-mono text-sm font-normal break-all text-muted-foreground">
          {tildePath(configPath)}?
        </span>
      </DialogTitle>
      <DialogDescription className="leading-normal">
        Edits only the lines that changed and backs up each file first. You can
        return to your original config from the ··· menu.
      </DialogDescription>
    </DialogHeader>
  );
}

function ChangeTable() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const changes = draftChanges(state, options, colorDefaults);
  return (
    <ul className="flex flex-col rounded-xl inset-ring inset-ring-input">
      {changes.map((change) => (
        <li
          key={change.key}
          className="flex min-h-10 items-center gap-3 px-4 py-2 not-first:border-t">
          <b className="flex-1 font-medium whitespace-nowrap">{change.label}</b>
          <ChangeValues change={change} className="justify-end" />
        </li>
      ))}
    </ul>
  );
}

function Notes(props: {
  plan: SavePlan;
  backup: boolean;
  onBackup: (backup: boolean) => void;
}) {
  const {plan, backup, onBackup} = props;
  const lines = plan.conflicts.length;
  const settings = plan.themeSettings.length;
  const overrides = plan.overrides.length;
  if (
    lines === 0 &&
    settings === 0 &&
    overrides === 0 &&
    !plan.replacesColors
  ) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4 text-sm leading-normal text-muted-foreground">
      {(lines > 0 || plan.replacesColors) && (
        <div className="flex gap-3">
          <PaletteIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex flex-col gap-3">
            {lines > 0 && (
              <p>
                Your config sets colours that would hide the theme. Saving
                comments out{" "}
                {lines === 1 ? "that line" : `those ${lines} lines`} without
                deleting {lines === 1 ? "it" : "them"}.
              </p>
            )}
            {plan.replacesColors && (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={backup}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  onChange={(event) => onBackup(event.target.checked)}
                />
                <span className="flex flex-col gap-0.5">
                  <b className="text-base font-medium text-foreground">
                    Keep my previous colours as a theme
                  </b>
                  <small className="text-sm text-muted-foreground">
                    Find it in My themes to switch back.
                  </small>
                </span>
              </label>
            )}
          </div>
        </div>
      )}
      {settings > 0 && (
        <div className="flex gap-3">
          <SlidersHorizontalIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <p>
              Saving also applies{" "}
              {settings === 1 ? "this setting" : "these settings"} from the
              theme, which the preview didn't show:
            </p>
            <ul className="flex flex-col gap-1">
              {plan.themeSettings.map(({key, value}, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- the plan's settings never reorder
                <li key={i}>
                  <code className="rounded bg-muted px-1.5 py-px text-xs break-all text-foreground">
                    {key} = {value}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {plan.overrides.map((override) => (
        <OverrideNote key={override.by} override={override} />
      ))}
    </div>
  );
}

const LIST = new Intl.ListFormat("en", {type: "conjunction"});

/**
 * Changes a file the save does not write decides: another app's own config over
 * Ghostty's, or Ghostty's config under another app's.
 */
function OverrideNote(props: {override: ConfigOverride}) {
  const {by, paths, keys} = props.override;
  const edited = useSnapshot((snapshot) => snapshot.ghostty.edited);
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const labels = draftChanges(state, options, colorDefaults)
    .filter((change) => keys.includes(change.key))
    .map((change) => change.label);
  // Apps' own configs override Ghostty's, and Ghostty's lies under another's.
  const [source, shownIn] =
    edited.type === "ghostty"
      ? [`${by}'s own config`, by]
      : [`${by}'s config`, appName(edited)];
  return (
    <div className="flex gap-3">
      <LayersIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p>
          {source} overrides {LIST.format(labels)}, so {shownIn} won't show{" "}
          {labels.length === 1 ? "that change" : "those changes"}.
        </p>
        {paths.map((path) => (
          <span key={path} className="font-mono text-xs break-all">
            {tildePath(path)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Show exact changes": each file's diff. */
function Diffs(props: {plan: SavePlan}) {
  return (
    <div className="flex flex-col gap-3">
      {props.plan.files.map((file) => (
        <section key={file.path} className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs text-muted-foreground">
            <Truncate className="block">{tildePath(file.path)}</Truncate>
          </h3>
          <DiffView diff={file.diff} />
        </section>
      ))}
    </div>
  );
}

const DIFF_LINE: Record<string, string> = {
  "+": "bg-live/10 text-added",
  "-": "bg-destructive/10 text-removed",
  "@": "text-muted-foreground",
};

/** A unified diff: file headers dropped, added and removed lines tinted. */
function DiffView(props: {diff: string}) {
  const lines = props.diff
    .split("\n")
    .filter((line) => !line.startsWith("---") && !line.startsWith("+++"));
  return (
    <pre className="overflow-x-auto rounded-xl bg-background py-2 font-mono text-xs leading-[18px] inset-ring inset-ring-border">
      {lines.map((line, i) => (
        <div
          // oxlint-disable-next-line react/no-array-index-key -- diff lines never reorder
          key={i}
          className={cn(
            "px-3",
            DIFF_LINE[line[0] ?? ""] ?? "text-muted-foreground",
          )}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function Saved(props: {result: SaveResult}) {
  const {backupDir, backupTheme} = props.result;
  return (
    <>
      <DialogHeader className="gap-3">
        <DialogTitle className="flex items-center gap-2.5">
          <CircleCheckIcon aria-hidden className="size-5 text-live" />
          Saved to your config
        </DialogTitle>
        <DialogDescription className="flex flex-col gap-2 leading-normal">
          <span>
            Backups of the changed files stay in{" "}
            <code className="text-sm break-all text-foreground">
              {tildePath(backupDir)}
            </code>{" "}
            until your next save.
          </span>
          {backupTheme && (
            <span>
              Your previous colours are in My themes as{" "}
              <b className="font-medium text-foreground">{backupTheme}</b>.
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button autoFocus onClick={() => setSaveOpen(false)}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
