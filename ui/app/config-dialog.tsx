import {type ReactNode, useEffect, useId, useState} from "react";
import {cn} from "cn";
import {CheckIcon, CopyIcon, XIcon} from "lucide-react";
import {IconButton} from "@/components/icon-button";
import {TruncatedPath} from "@/components/path";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {Button} from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Switch} from "@/components/ui/switch";
import type {ConfigChoice} from "@/core/bindings";
import {errorText} from "@/core/errors";
import {configChoices, forgetConfig} from "@/lib/host";
import {
  chooseConfig,
  clearSwitchError,
  confirmSwitch,
  notify,
  setConfigOpen,
  useSnapshot,
  useStore,
} from "@/lib/store";
import {useAppName} from "@/lib/views";

/**
 * Switches the config the designer edits: Ghostty's, a known app's, a recent
 * file or any file, also when a later launch asks. Unsaved changes are lost, so
 * it asks first. The page loads again for the new config.
 */
export function ConfigDialog() {
  const open = useStore((store) => store.configOpen);
  return (
    <Dialog open={open} onOpenChange={setConfigOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-6rem)] flex-col sm:max-w-md">
        <ConfigPicker />
      </DialogContent>
      <DiscardDialog />
    </Dialog>
  );
}

/** A config to switch to: a listed one, or a file typed by path. */
type Target = ConfigChoice | {type: "file"; path: string; ghosttyBase: boolean};

/**
 * The dialog's content, mounted while it is open. A row or a typed path selects
 * a config, and Switch goes to it, with Ghostty's config as its base as the
 * switch says.
 */
function ConfigPicker() {
  const switching = useStore((store) => store.switching);
  const switchError = useStore((store) => store.switchError);
  const edited = useSnapshot((snapshot) => snapshot.edited);
  const configPath = useSnapshot((snapshot) => snapshot.configPath);
  const [choices, setChoices] = useState<ConfigChoice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Target | null>(null);
  const error = switchError ?? loadError;
  const select = (next: Target) => {
    setPicked(next);
    clearSwitchError();
  };

  useEffect(() => {
    let current = true;
    configChoices()
      .then((found) => current && setChoices(found))
      .catch((reason: unknown) => current && setLoadError(errorText(reason)));
    return () => {
      current = false;
    };
  }, []);

  const isEdited = (choice: ConfigChoice) =>
    choice.type === "ghostty"
      ? edited.type === "ghostty"
      : edited.type === "file" && choice.path === configPath;
  // The file edited shows even when it fell off the recent files.
  const rows: ConfigChoice[] =
    edited.type === "file" && !choices.some(isEdited)
      ? [
          ...choices,
          {type: "recent", path: configPath, ghosttyBase: edited.ghosttyBase},
        ]
      : choices;
  // Whether Switch does anything: another config, or another base.
  const changes = (next: Target) => {
    switch (next.type) {
      case "ghostty":
        return edited.type !== "ghostty";
      case "file":
        return next.path !== "";
      case "app":
      case "recent":
        return (
          edited.type === "ghostty" ||
          next.path !== configPath ||
          next.ghosttyBase !== edited.ghosttyBase
        );
    }
  };
  const target = picked ?? rows.find(isEdited);
  const changed = target !== undefined && changes(target);
  const reload =
    target !== undefined && target.type !== "file" && isEdited(target);
  const confirm = () => {
    if (changed) switchTo(target);
  };

  const forget = (path: string) => {
    if (picked?.path === path) setPicked(null);
    void forgetConfig(path)
      .then(configChoices)
      .then(setChoices)
      .catch((reason: unknown) => setLoadError(errorText(reason)));
  };

  const row = (choice: ConfigChoice) => (
    <ChoiceRow
      key={choice.path}
      choice={choice}
      current={isEdited(choice)}
      selected={target?.type !== "file" && choice.path === target?.path}
      disabled={switching}
      onSelect={() => select(choice)}
      onForget={() => forget(choice.path)}
    />
  );
  const ofType = (type: ConfigChoice["type"]) =>
    rows.filter((choice) => choice.type === type).map(row);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Switch config</DialogTitle>
        <DialogDescription>
          Apps built on libghostty can have their own config file. Choose which
          one to edit.
        </DialogDescription>
      </DialogHeader>
      <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
        <ul className="flex min-w-0 flex-col rounded-lg p-1 inset-ring inset-ring-border [&+section]:border-t-0 [&+section]:pt-0">
          {ofType("ghostty")}
        </ul>
        <ChoiceSection title="Other apps">{ofType("app")}</ChoiceSection>
        <ChoiceSection title="Recent">{ofType("recent")}</ChoiceSection>
        {(target?.type === "app" || target?.type === "recent") && (
          <GhosttyBase
            className="border-t pt-4"
            choice={target}
            disabled={switching}
            onChange={(ghosttyBase) => setPicked({...target, ghosttyBase})}
          />
        )}
        <OtherFile
          rows={rows}
          selected={target?.type === "file"}
          disabled={switching}
          onSelect={select}
          onSubmit={confirm}
        />
      </div>
      {switching && (
        <p role="status" className="text-sm text-muted-foreground">
          Switching…
        </p>
      )}
      {error !== null && (
        <p
          role="alert"
          className="line-clamp-2 text-sm wrap-anywhere text-warn">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" disabled={switching} />}>
          Close
        </DialogClose>
        <Button disabled={!changed || switching} onClick={confirm}>
          {reload ? "Reload" : "Switch"}
        </Button>
      </DialogFooter>
    </>
  );
}

function switchTo(target: Target) {
  chooseConfig(
    target.type === "ghostty"
      ? {path: null}
      : {path: target.path, ghosttyBase: target.ghosttyBase},
  );
}

/** A titled group of rows, left out when it has none. */
function ChoiceSection(props: {title: string; children: ReactNode[]}) {
  const id = useId();
  if (props.children.length === 0) return null;
  return (
    <section aria-labelledby={id} className="min-w-0 border-t pt-4">
      <h3 id={id} className="text-sm font-medium text-muted-foreground">
        {props.title}
      </h3>
      <ul className="flex min-w-0 flex-col gap-1 p-1">{props.children}</ul>
    </section>
  );
}

function choiceName(choice: ConfigChoice) {
  switch (choice.type) {
    case "ghostty":
      return "Ghostty";
    case "app":
      return choice.app;
    case "recent":
      return choice.path.slice(choice.path.lastIndexOf("/") + 1);
  }
}

function ChoiceRow(props: {
  choice: ConfigChoice;
  current: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onForget: () => void;
}) {
  const {choice, current} = props;
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-lg pr-1",
        props.selected
          ? "bg-selected"
          : "has-[button:enabled:first-child:hover]:bg-accent",
      )}>
      <button
        type="button"
        disabled={props.disabled}
        aria-pressed={props.selected}
        aria-current={current || undefined}
        className="flex min-w-0 flex-1 cursor-default flex-col items-start gap-px rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onSelect}>
        <span className="flex items-center gap-1.5 font-medium">
          {choiceName(choice)}
          {props.selected && <CheckIcon aria-hidden className="size-3.5" />}
        </span>
        <TruncatedPath
          path={choice.path}
          className="max-w-full font-mono text-xs text-muted-foreground"
        />
      </button>
      <IconButton
        label="Copy path"
        onClick={() =>
          void navigator.clipboard
            .writeText(choice.path)
            .then(() => notify(`Copied ${choice.path}`))
            .catch(() => notify("Could not copy to the clipboard", "error"))
        }>
        <CopyIcon />
      </IconButton>
      {choice.type === "recent" && !current && (
        <IconButton
          label="Remove from recent files"
          disabled={props.disabled}
          onClick={props.onForget}>
          <XIcon />
        </IconButton>
      )}
    </li>
  );
}

/** Whether the selected file loads over Ghostty's config. */
function GhosttyBase(props: {
  choice: Exclude<Target, {type: "ghostty"}>;
  disabled: boolean;
  onChange: (ghosttyBase: boolean) => void;
  className?: string;
}) {
  const app = props.choice.type === "app" ? props.choice.app : "this app";
  return (
    <label className={cn("flex items-start gap-3 text-sm", props.className)}>
      <Switch
        className="mt-0.5"
        checked={props.choice.ghosttyBase}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">
          Does {app} use Ghostty's config as a base?
        </span>
        <span className="text-muted-foreground">
          Change this if colours or fonts here don't match what {app} shows.
        </span>
      </span>
    </label>
  );
}

/**
 * Any config file, by path. Typing or focusing the path selects it, with
 * whether it has Ghostty's config as its base below: a listed file's choice,
 * else on, as the host has it.
 */
function OtherFile(props: {
  rows: ConfigChoice[];
  selected: boolean;
  disabled: boolean;
  onSelect: (target: Extract<Target, {type: "file"}>) => void;
  onSubmit: () => void;
}) {
  const [file, setFile] = useState("");
  const [ghosttyBase, setGhosttyBase] = useState(true);
  const path = file.trim();
  // The host remembers a choice only for the files it lists.
  const listedBase = (next: string) => {
    const row = props.rows.find((choice) => choice.path === next);
    return row && "ghosttyBase" in row ? row.ghosttyBase : true;
  };
  return (
    <form
      className="flex flex-col gap-2.5 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}>
      <label
        htmlFor="config-file"
        className="text-sm font-medium text-muted-foreground">
        Another file
      </label>
      <Input
        id="config-file"
        className={cn("font-mono", props.selected && "border-ring")}
        placeholder="~/path/to/config"
        spellCheck={false}
        value={file}
        disabled={props.disabled}
        onFocus={() => {
          if (path) props.onSelect({type: "file", path, ghosttyBase});
        }}
        onChange={(event) => {
          const next = event.target.value.trim();
          const base = next === path ? ghosttyBase : listedBase(next);
          setFile(event.target.value);
          setGhosttyBase(base);
          props.onSelect({type: "file", path: next, ghosttyBase: base});
        }}
      />
      {props.selected && path !== "" && (
        <GhosttyBase
          className="pt-1.5"
          choice={{type: "file", path, ghosttyBase}}
          disabled={props.disabled}
          onChange={(next) => {
            setGhosttyBase(next);
            props.onSelect({type: "file", path, ghosttyBase: next});
          }}
        />
      )}
    </form>
  );
}

/** Asks before a switch, or a reload of the same file, loses unsaved changes. */
function DiscardDialog() {
  const target = useStore((store) => store.switchConfirm);
  const configPath = useSnapshot((snapshot) => snapshot.configPath);
  const changes = useSnapshot((snapshot) => snapshot.state.changes);
  const app = useAppName();
  const verb = target?.path === configPath ? "reload" : "switch";
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(next) => !next && confirmSwitch(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {`${verb === "reload" ? "Reload" : "Switch"} with ${changes} unsaved ${changes === 1 ? "change" : "changes"}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your changes are lost, and {app} goes back to your saved config.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => confirmSwitch(true)}>
            Discard and {verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
