import {useState} from "react";
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
import {errorText} from "@/core/errors";
import {closeSaveTheme, notify, session, useStore} from "@/lib/store";

/**
 * "Save as theme": saves colours as a theme under My themes. Opened with
 * openSaveTheme.
 */
export function SaveThemeDialog() {
  const opened = useStore((store) => store.saveTheme);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Each opening starts from the suggested name. Closing keeps the form as it
  // was, so the closing animation shows it unchanged.
  const [form, setForm] = useState(opened);
  if (opened !== null && opened !== form) {
    setForm(opened);
    setName(opened.name);
    setError(null);
  }
  const source = form?.source;

  const submit = () => {
    if (source === undefined) return;
    const theme = name.trim();
    session()
      .saveTheme(theme, source)
      .then(() => {
        closeSaveTheme();
        notify(`Saved “${theme}” to My themes`);
      })
      .catch((reason: unknown) => setError(errorText(reason)));
  };

  return (
    <Dialog
      open={opened !== null}
      onOpenChange={(open) => !open && closeSaveTheme()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}>
          <DialogHeader>
            <DialogTitle>Save as theme</DialogTitle>
            <DialogDescription>
              {typeof source === "object"
                ? `Saves a copy of ${source.theme}'s colours under My themes.`
                : "Saves the colours chosen here, unsaved changes included, under My themes."}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Theme name"
            aria-invalid={error !== null || undefined}
            value={name}
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
            <Button type="submit" disabled={!name.trim()}>
              Save theme
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
