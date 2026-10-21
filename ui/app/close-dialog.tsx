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
import {errorText} from "@/core/errors";
import {closeWindow} from "@/lib/host";
import {notify, setCloseRequested, useSnapshot, useStore} from "@/lib/store";

/** Asks before the window closes with unsaved changes. */
export function CloseDialog() {
  const changes = useSnapshot((snapshot) => snapshot.state.changes);
  const open = useStore((store) => store.closeRequested);

  return (
    <AlertDialog open={open} onOpenChange={setCloseRequested}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Close with {changes} unsaved {changes === 1 ? "change" : "changes"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Closing stops Ghostty Designer and discards them. Ghostty shows your
            saved config again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              void closeWindow().catch((error: unknown) =>
                notify(errorText(error), "error"),
              )
            }>
            Discard and close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
