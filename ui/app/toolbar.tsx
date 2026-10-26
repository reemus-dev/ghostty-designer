import {type ReactNode, useEffect, useState} from "react";
import {cn} from "cn";
import {
  ChevronDownIcon,
  Columns2Icon,
  EllipsisIcon,
  EraserIcon,
  FileCogIcon,
  Redo2Icon,
  RotateCcwIcon,
  SearchIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {Menu} from "@base-ui/react/menu";
import {Truncate} from "@/components/truncate";
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
import {Kbd} from "@/components/ui/kbd";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {errorText} from "@/core/errors";
import {isLive} from "@/core/preview";
import {type DraftChange, draftChanges, undoChange} from "@/lib/changes";
import {MOD, SHIFT_MOD} from "@/lib/keys";
import {tildePath} from "@/lib/paths";
import {
  notify,
  revertAll,
  send,
  session,
  setConfigOpen,
  setPaletteOpen,
  setPeek,
  setSaveOpen,
  stepHistory,
  useSnapshot,
} from "@/lib/store";
import {useAppName} from "@/lib/views";
import {ChangeValues} from "./change-values";
import {LiveStatus} from "./live-status";

/**
 * What you edit and where it shows on the left: search, the edited file and the
 * live status. The draft on the right: its changes, undo, redo and save. The
 * change count grows into the gap between them, so nothing moves as the draft
 * changes. On macOS it starts after the traffic lights. In a narrow window,
 * search shows only its icon, and the live status and the change count drop
 * their words.
 */
export function Toolbar() {
  const platform = useSnapshot((snapshot) => snapshot.ghostty.platform);
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const {history} = state;

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "col-span-2 flex min-w-0 items-center gap-1 pr-3 select-none lg:gap-1.5",
        platform === "macos" ? "pl-[92px]" : "pl-14",
      )}>
      <SearchButton />
      <EditedFile />
      <LiveStatus />
      <div className="ml-auto flex min-w-0 items-center gap-1 lg:gap-1.5 lg:pl-3">
        <ChangeList
          changes={draftChanges(state, options, colorDefaults)}
          count={state.changes}
          compare={isLive(state)}
        />
        <HistoryButton
          shortcut={`${MOD}Z`}
          disabled={history.undo.length === 0}
          label={
            history.undo.at(-1)
              ? `Undo ${history.undo.at(-1)!.label}`
              : "Nothing to undo"
          }
          onClick={() => stepHistory("undo")}>
          <Undo2Icon />
        </HistoryButton>
        <HistoryButton
          shortcut={`${SHIFT_MOD}Z`}
          disabled={history.redo.length === 0}
          label={
            history.redo.at(-1)
              ? `Redo ${history.redo.at(-1)!.label}`
              : "Nothing to redo"
          }
          onClick={() => stepHistory("redo")}>
          <Redo2Icon />
        </HistoryButton>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled={state.changes === 0}
                onClick={() => setSaveOpen(true)}
              />
            }>
            Save
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Review and save to your config <Kbd>{MOD}S</Kbd>
          </TooltipContent>
        </Tooltip>
        <OverflowMenu />
      </div>
    </header>
  );
}

/**
 * Names the file edited when it is not Ghostty's config, and opens the config
 * switcher.
 */
function EditedFile() {
  const edited = useSnapshot((snapshot) => snapshot.ghostty.edited);
  const configPath = useSnapshot((snapshot) => snapshot.ghostty.configPath);
  if (edited.type === "ghostty") return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className="min-w-0 inset-ring inset-ring-input"
            onClick={() => setConfigOpen(true)}
          />
        }>
        <span className="truncate">
          {edited.app ?? configPath.slice(configPath.lastIndexOf("/") + 1)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Editing{" "}
        <span className="font-mono wrap-anywhere">{tildePath(configPath)}</span>
        {edited.ghosttyBase ? ", on top of Ghostty's config" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

/** Opens the palette, which does the search. */
function SearchButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className="text-muted-foreground max-lg:w-[30px] max-lg:px-0!"
            onClick={() => setPaletteOpen(true)}
          />
        }>
        <SearchIcon />
        <span className="max-lg:sr-only">Search</span>
        <Kbd className="max-lg:hidden">{MOD}K</Kbd>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Search settings, themes, fonts <Kbd>{MOD}K</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function HistoryButton(props: {
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
            size="icon"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }>
        {props.children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {props.label} <Kbd>{props.shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Ghostty shows the saved config while the button is held, like holding `\`. */
function CompareButton() {
  const app = useAppName();
  // The popover can close while the button is held, which unmounts it before
  // the pointer comes up.
  useEffect(() => () => setPeek(false), []);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="select-none"
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
        Hold to compare
        <Kbd>\</Kbd>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Shows your saved config in {app} while held
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "3 unsaved changes ⌄": opens the full list, each with its own undo, then
 * compare and discard.
 */
function ChangeList(props: {
  changes: DraftChange[];
  count: number;
  compare: boolean;
}) {
  const {changes, count, compare} = props;
  const [open, setOpen] = useState(false);
  // The last change can go with the list open, by its own undo or a shortcut.
  if (open && count === 0) setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={count === 0}
        className="flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 whitespace-nowrap enabled:font-semibold enabled:hover:bg-accent disabled:text-sm disabled:text-muted-foreground disabled:max-lg:hidden">
        {count === 0 ? (
          "No unsaved changes"
        ) : (
          <>
            <span
              aria-hidden
              className="size-[7px] rounded-full bg-changed ring-3 ring-changed/16"
            />
            <span>
              {count}
              <span className="max-lg:sr-only">
                {` unsaved ${count === 1 ? "change" : "changes"}`}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 text-muted-foreground max-lg:hidden"
            />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="max-h-[60vh] w-[min(420px,calc(100vw-1.5rem))] gap-0 p-1.5">
        <div className="min-h-0 overflow-y-auto">
          {changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1 border-t pt-1.5">
          {compare && <CompareButton />}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={revertAll}>
            <EraserIcon />
            Discard all
            <Kbd>esc esc</Kbd>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChangeRow(props: {change: DraftChange}) {
  const {change} = props;
  // `palette:N` changes share the `palette` key.
  const rejected = useSnapshot(
    (snapshot) =>
      snapshot.state.apply.rejected?.includes(change.key.replace(/:.*/, "")) ??
      false,
  );
  return (
    <div className="flex min-h-9 items-center gap-3 rounded-sm pr-1 pl-2.5 hover:bg-accent">
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <Truncate className="font-medium">{change.label}</Truncate>
        {rejected && (
          <small className="shrink-0 text-sm text-warn">Not accepted</small>
        )}
      </span>
      <ChangeValues change={change} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Undo change to ${change.label}`}
        title={`Undo change to ${change.label}`}
        onClick={() => void send(undoChange(change))}>
        <XIcon />
      </Button>
    </div>
  );
}

function OverflowMenu() {
  const configPath = useSnapshot((snapshot) => snapshot.ghostty.configPath);
  const canRestore = useSnapshot(
    (snapshot) => snapshot.state.canRestoreOriginal,
  );
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button variant="ghost" size="icon" aria-label="More actions" />
          }>
          <EllipsisIcon className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} className="z-50">
            <Menu.Popup className="flex w-[340px] origin-(--transform-origin) popup-motion flex-col rounded-xl bg-popover p-1.5 popup outline-none">
              <MenuItem
                icon={<RotateCcwIcon />}
                label="Restore original config…"
                disabled={!canRestore}
                hint={
                  canRestore
                    ? "Your config before Ghostty Designer changed it"
                    : "Nothing to restore yet"
                }
                onClick={() => setConfirm(true)}
              />
              <MenuItem
                icon={<FileCogIcon />}
                label="Switch config…"
                hint={
                  <span className="font-mono wrap-anywhere">
                    {tildePath(configPath)}
                  </span>
                }
                onClick={() => setConfigOpen(true)}
              />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore your original config?</AlertDialogTitle>
            <AlertDialogDescription>
              Returns{" "}
              <code className="text-foreground">{tildePath(configPath)}</code>{" "}
              and the files it includes to how they were before Ghostty Designer
              first changed them. You lose every save since then, and any
              unsaved changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                void session()
                  .restoreOriginal()
                  .then(() => notify("Restored your original config"))
                  .catch((error: unknown) => notify(errorText(error), "error"));
              }}>
              Restore original
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MenuItem(props: {
  icon: ReactNode;
  label: string;
  hint: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      disabled={props.disabled}
      className="flex cursor-default items-start gap-2.5 rounded-sm px-2.5 py-[7px] outline-none select-none data-disabled:opacity-64 data-highlighted:bg-accent [&_svg]:mt-1 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      onClick={props.onClick}>
      {props.icon}
      <span className="flex min-w-0 flex-col gap-px">
        {props.label}
        <small className="text-xs text-muted-foreground">{props.hint}</small>
      </span>
    </Menu.Item>
  );
}
