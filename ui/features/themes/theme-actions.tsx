import {useState} from "react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {errorText} from "@/core/errors";
import type {ThemeSummary} from "@/core/types";
import {
  notify,
  openSaveTheme,
  session,
  setTheme,
  useSnapshot,
} from "@/lib/store";

/**
 * Duplicates the theme, and renames or deletes one of the user's. A theme the
 * saved config names stays as it is, so Ghostty never looks for a theme that is
 * gone.
 */
export function ThemeActions(props: {theme: ThemeSummary}) {
  const {name: theme, source} = props.theme;
  const used = useSnapshot((snapshot) =>
    snapshot.state.savedThemes.includes(theme),
  );
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = () =>
    void session()
      .intent({type: "delete-theme", theme})
      .then(() => {
        setTheme(null);
        notify(`Deleted “${theme}”`);
      })
      .catch((error: unknown) => notify(errorText(error), "error"));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 [&>button]:flex-1">
        <Button variant="outline" onClick={() => openSaveTheme({theme})}>
          Duplicate
        </Button>
        {source === "user" && (
          <>
            <Button
              variant="outline"
              disabled={used}
              onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button
              variant="destructive"
              disabled={used}
              onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </>
        )}
      </div>
      {source === "bundled" && (
        <p className="text-sm text-muted-foreground">
          Duplicate to edit. Built&#8209;in themes never change.
        </p>
      )}
      {source === "user" && used && (
        <p className="text-sm text-muted-foreground">
          Your saved config uses this theme. Save another theme to rename or
          delete it.
        </p>
      )}
      <RenameDialog theme={theme} open={renaming} onOpenChange={setRenaming} />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{theme}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the theme file from your themes folder. You can&apos;t
              undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete theme
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RenameDialog(props: {
  theme: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {theme, open, onOpenChange} = props;
  const [name, setName] = useState(theme);
  const [error, setError] = useState<string | null>(null);
  // Each opening starts from the theme's name. Closing keeps the form as it
  // was, so the closing animation shows it unchanged.
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setName(theme);
      setError(null);
    }
  }
  const to = name.trim();

  const submit = () => {
    session()
      .intent({type: "rename-theme", theme, to})
      .then(() => {
        onOpenChange(false);
        setTheme(to);
        notify(`Renamed to “${to}”`);
      })
      .catch((reason: unknown) => setError(errorText(reason)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}>
          <DialogHeader>
            <DialogTitle>Rename theme</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Theme name"
            aria-invalid={error !== null || undefined}
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
          />
          {error !== null && (
            <p role="alert" className="-mt-2 text-sm text-warn">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={to === "" || to === theme}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
