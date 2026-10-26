import {type ReactNode, useEffect, useId, useState} from "react";
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
  const switching = useStore((store) => store.switching);
  const switchError = useStore((store) => store.switchError);
  const edited = useSnapshot((snapshot) => snapshot.edited);
  const configPath = useSnapshot((snapshot) => snapshot.configPath);
  const [choices, setChoices] = useState<ConfigChoice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const error = switchError ?? loadError;

  useEffect(() => {
    if (!open) return;
    let current = true;
    configChoices()
      .then((found) => current && setChoices(found))
      .catch((reason: unknown) => current && setLoadError(errorText(reason)));
    return () => {
      current = false;
    };
  }, [open]);

  const isEdited = (choice: ConfigChoice) =>
    choice.type === "ghostty"
      ? edited.type === "ghostty"
      : edited.type === "file" && choice.path === configPath;
  // The file edited shows even when it fell off the recent files.
  const rows: ConfigChoice[] =
    edited.type === "file" && !choices.some(isEdited)
      ? [...choices, {type: "recent", path: configPath}]
      : choices;
  const forget = (path: string) =>
    void forgetConfig(path)
      .then(configChoices)
      .then(setChoices)
      .catch((reason: unknown) => setLoadError(errorText(reason)));

  const row = (choice: ConfigChoice) => (
    <ChoiceRow
      key={choice.path}
      choice={choice}
      current={isEdited(choice)}
      disabled={switching}
      onChoose={() =>
        chooseConfig({path: choice.type === "ghostty" ? null : choice.path})
      }
      onForget={() => forget(choice.path)}
    />
  );
  const ofType = (type: ConfigChoice["type"]) =>
    rows.filter((choice) => choice.type === type).map(row);

  return (
    <Dialog open={open} onOpenChange={setConfigOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch config</DialogTitle>
          <DialogDescription>
            Apps built on libghostty can have their own config file. Choose
            which one to edit.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex min-w-0 flex-col rounded-lg p-1 inset-ring inset-ring-border [&+section]:border-t-0 [&+section]:pt-0">
          {ofType("ghostty")}
        </ul>
        <ChoiceSection title="Other apps">{ofType("app")}</ChoiceSection>
        <ChoiceSection title="Recent">{ofType("recent")}</ChoiceSection>
        <GhosttyBase disabled={switching} />
        <OtherFile disabled={switching} />
        {switching && (
          <p role="status" className="text-sm text-muted-foreground">
            Switching…
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={switching} />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
      <DiscardDialog />
    </Dialog>
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
      <ul className="flex min-w-0 flex-col p-1">{props.children}</ul>
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
  disabled: boolean;
  onChoose: () => void;
  onForget: () => void;
}) {
  const {choice, current} = props;
  return (
    <li className="flex items-center gap-1 rounded-lg pr-1 has-[button:enabled:first-child:hover]:bg-accent">
      <button
        type="button"
        disabled={current || props.disabled}
        aria-current={current || undefined}
        className="flex min-w-0 flex-1 cursor-default flex-col items-start gap-px rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onChoose}>
        <span className="flex items-center gap-1.5 font-medium">
          {choiceName(choice)}
          {current && <CheckIcon aria-label="Editing" className="size-3.5" />}
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

/** Whether the file edited loads over Ghostty's config. Changing it reloads. */
function GhosttyBase(props: {disabled: boolean}) {
  const edited = useSnapshot((snapshot) => snapshot.edited);
  const configPath = useSnapshot((snapshot) => snapshot.configPath);
  if (edited.type === "ghostty") return null;
  const app = edited.app ?? "this app";
  return (
    <label className="flex items-start gap-3 border-t pt-4 text-sm">
      <Switch
        className="mt-0.5"
        checked={edited.ghosttyBase}
        disabled={props.disabled}
        onCheckedChange={(ghosttyBase) =>
          chooseConfig({path: configPath, ghosttyBase})
        }
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

/** Any config file, by path. */
function OtherFile(props: {disabled: boolean}) {
  const [file, setFile] = useState("");
  return (
    <form
      className="flex flex-col gap-2.5 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        chooseConfig({path: file.trim()});
      }}>
      <label
        htmlFor="config-file"
        className="text-sm font-medium text-muted-foreground">
        Another file
      </label>
      <div className="flex gap-2">
        <Input
          id="config-file"
          className="font-mono"
          placeholder="~/path/to/config"
          spellCheck={false}
          value={file}
          disabled={props.disabled}
          onChange={(event) => setFile(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!file.trim() || props.disabled}>
          Edit
        </Button>
      </div>
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
