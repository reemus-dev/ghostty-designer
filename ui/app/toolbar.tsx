import {type ReactNode, useEffect, useState} from "react";
import {cn} from "cn";
import {
  ChevronDownIcon,
  Columns2Icon,
  CopyIcon,
  EllipsisIcon,
  EraserIcon,
  Redo2Icon,
  RotateCcwIcon,
  SearchIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {Menu} from "@base-ui/react/menu";
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
  setPaletteOpen,
  setPeek,
  setSaveOpen,
  stepHistory,
  useSnapshot,
} from "@/lib/store";
import {ChangeValues} from "./change-values";
import {LiveStatus} from "./live-status";

/** Shrinks a labelled button to its icon in a narrow window. */
const NARROW_ICON = "max-lg:w-[30px] max-lg:px-0!";

/**
 * Search, the live status, the unsaved changes and the ways out: compare with
 * saved, discard, undo, redo and save. On macOS it starts after the traffic
 * lights. In a narrow window, buttons show only their icons, and the live
 * status and the change count drop their words.
 */
export function Toolbar() {
  const platform = useSnapshot((snapshot) => snapshot.ghostty.platform);
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const {history} = state;
  const dirty = state.changes > 0;

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "col-span-2 flex min-w-0 items-center gap-1 pr-3 select-none lg:gap-1.5",
        platform === "macos" ? "pl-[92px]" : "pl-14",
      )}>
      <SearchButton />
      <div className="ml-auto flex min-w-0 items-center gap-1 lg:gap-1.5 lg:pl-3">
        <LiveStatus />
        {dirty ? (
          <ChangeList
            changes={draftChanges(state, options, colorDefaults)}
            count={state.changes}
          />
        ) : (
          <span className="px-1 text-sm whitespace-nowrap text-muted-foreground max-lg:hidden">
            No unsaved changes
          </span>
        )}
        {dirty && (
          <>
            {isLive(state) && <CompareButton />}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    className={NARROW_ICON}
                    onClick={revertAll}
                  />
                }>
                <EraserIcon />
                <span className="max-lg:sr-only">Discard</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Discard all changes <Kbd>esc esc</Kbd>
              </TooltipContent>
            </Tooltip>
          </>
        )}
        <div aria-hidden className="mx-1 h-4 w-px bg-border max-lg:hidden" />
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
        <div aria-hidden className="mx-1 h-4 w-px bg-border max-lg:hidden" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button disabled={!dirty} onClick={() => setSaveOpen(true)} />
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

/** Opens the palette, which does the search. */
function SearchButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className={cn("text-muted-foreground", NARROW_ICON)}
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
  // The last change can go while the button is held, which unmounts it
  // before the pointer comes up.
  useEffect(() => () => setPeek(false), []);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className={cn("select-none", NARROW_ICON)}
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
        <span className="max-lg:sr-only">Compare</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Press and hold to see your saved config in Ghostty, or hold <Kbd>\</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** "3 unsaved changes ⌄": opens the full list, each with its own undo. */
function ChangeList(props: {changes: DraftChange[]; count: number}) {
  const {changes, count} = props;
  return (
    <Popover>
      <PopoverTrigger className="flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 font-semibold whitespace-nowrap hover:bg-accent">
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
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="max-h-[60vh] w-[min(420px,calc(100vw-1.5rem))] gap-0 overflow-y-auto p-1.5">
        {changes.map((change) => (
          <ChangeRow key={change.key} change={change} />
        ))}
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
        <span className="truncate font-medium">{change.label}</span>
        {rejected && (
          <small className="shrink-0 text-sm text-warn">Not applied</small>
        )}
      </span>
      <ChangeValues change={change} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Undo the ${change.label} change`}
        title={`Undo the ${change.label} change`}
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
                    ? "Your config from before your first save"
                    : "Available after your first save"
                }
                onClick={() => setConfirm(true)}
              />
              <MenuItem
                icon={<CopyIcon />}
                label="Copy the config file path"
                hint={
                  <span className="font-mono wrap-anywhere">
                    {tildePath(configPath)}
                  </span>
                }
                onClick={() =>
                  void navigator.clipboard
                    .writeText(configPath)
                    .then(() => notify(`Copied ${configPath}`))
                }
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
              Puts back{" "}
              <code className="text-foreground">{tildePath(configPath)}</code>{" "}
              and its included files as they were before Ghostty Designer first
              saved them. Later saves and unsaved changes are discarded.
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
        <small className="text-xs text-muted-foreground">
          {props.hint}
        </small>
      </span>
    </Menu.Item>
  );
}
