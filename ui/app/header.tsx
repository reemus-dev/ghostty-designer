import {type ReactNode, useState} from "react";
import {cn} from "cn";
import {CopyIcon, EllipsisIcon, RotateCcwIcon, SearchIcon} from "lucide-react";
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
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {errorText} from "@/core/errors";
import type {OptionMeta, SessionState} from "@/core/types";
import {ALT, MOD} from "@/lib/keys";
import {tildePath} from "@/lib/paths";
import {
  notify,
  session,
  setPaletteOpen,
  setSetupLater,
  showsSetup,
  useSnapshot,
  useStore,
} from "@/lib/store";
import {
  NOT_SHOWING_TEXT,
  revealOption,
  showView,
  VIEW_LABEL,
  VIEWS,
} from "@/lib/views";

/**
 * App name, the view switch (Alt 1, Alt 2), search, the live status and the
 * overflow menu.
 */
export function Header() {
  const setup = useStore(showsSetup);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
      <div className="flex items-center gap-2.5 font-semibold tracking-[-0.005em]">
        <Logo />
        <span className="max-[960px]:sr-only">Ghostty Designer</span>
      </div>
      {!setup && <ViewSwitch />}
      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                aria-label="Search settings, themes, fonts and actions"
                className="gap-2 pr-1.5 pl-2.5 text-fg-2"
                onClick={() => setPaletteOpen(true)}
              />
            }>
            <SearchIcon />
            <Kbd>{MOD}K</Kbd>
          </TooltipTrigger>
          <TooltipContent>
            Search settings, themes, fonts and actions
          </TooltipContent>
        </Tooltip>
        <LiveStatus />
        <OverflowMenu />
      </div>
    </header>
  );
}

/** Customise · Themes as a segmented control. */
function ViewSwitch() {
  const view = useStore((store) => store.view);
  return (
    <nav
      aria-label="Views"
      className="ml-4 flex rounded-lg bg-raised p-0.5 shadow-[inset_0_0_0_1px_var(--color-line-2)]">
      {VIEWS.map((name, i) => (
        <Tooltip key={name}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-current={name === view ? "page" : undefined}
                onClick={() => showView(name)}
              />
            }
            className={cn(
              "flex h-[26px] items-center rounded-md px-3.5 font-medium whitespace-nowrap text-fg-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
              name === view &&
                "bg-selected text-fg shadow-[0_1px_2px_rgb(0_0_0/35%),inset_0_1px_0_rgb(255_255_255/5%)]",
            )}>
            {VIEW_LABEL[name]}
          </TooltipTrigger>
          <TooltipContent>
            {VIEW_LABEL[name]} <Kbd>{`${ALT}${i + 1}`}</Kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

type Status = {
  label: string;
  dot: string;
  warn?: boolean;
  detail: string;
  /** What a click does: makes the status a button. */
  action?: () => void;
};

const DOT = {
  live: "bg-live shadow-live",
  off: "bg-fg-3",
  warn: "bg-warn shadow-[0_0_0_3px_var(--color-warn-soft)]",
};

function liveStatus(state: SessionState, options: OptionMeta[]): Status {
  if (!state.previewInstalled) {
    return {
      label: "Live preview off",
      dot: DOT.off,
      detail:
        "Ghostty updates only when you save. Click to turn on live preview.",
      action: () => setSetupLater(false),
    };
  }
  if (state.apply.state === "paused") {
    return {
      label: "Preview paused",
      dot: DOT.off,
      detail: "Ghostty shows your saved config while you compare.",
    };
  }
  if (state.apply.state === "error") {
    const {error = "Ghostty did not reload the preview.", rejected = []} =
      state.apply;
    const key = rejected[0];
    if (key === undefined) {
      return {
        label: "Ghostty didn't accept that value",
        dot: DOT.warn,
        warn: true,
        detail: `${error}\nGhostty keeps showing the last changes it accepted.`,
      };
    }
    const label = options.find((option) => option.key === key)?.label ?? key;
    return {
      label: `Ghostty didn't accept ${label}`,
      dot: DOT.warn,
      warn: true,
      detail: `${error}\nYour other changes show in Ghostty. Click to go to the setting.`,
      action: () => revealOption(key)?.focus({preventScroll: true}),
    };
  }
  if (state.previewShadowed) {
    return {
      label: NOT_SHOWING_TEXT.shadowed,
      dot: DOT.warn,
      warn: true,
      detail:
        "A config file that loads after the preview sets some of the same settings, so Ghostty shows those instead.",
    };
  }
  if (state.instances === 0) {
    return {
      label: "Live · no open windows",
      dot: DOT.live,
      detail: "Ghostty isn't running. Your changes show once a window opens.",
    };
  }
  return {
    label: "Live in Ghostty",
    dot: DOT.live,
    detail: "Every change shows in your Ghostty windows right away.",
  };
}

/** Whether Ghostty shows the changes now, in plain words. */
function LiveStatus() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const status = liveStatus(state, options);
  const {action} = status;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          action ? (
            <button type="button" onClick={action} />
          ) : (
            <span role="status" tabIndex={0} />
          )
        }
        className={cn(
          "flex h-7 items-center gap-2 rounded-full px-2 text-sm whitespace-nowrap text-fg-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          status.warn && "text-warn",
          action && "hover:bg-white/5",
        )}>
        <span
          aria-hidden
          className={cn("size-[7px] shrink-0 rounded-full", status.dot)}
        />
        <span className="max-w-60 truncate">{status.label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-wrap">
        {status.detail}
      </TooltipContent>
    </Tooltip>
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
          <Menu.Positioner align="end" sideOffset={6} className="z-50">
            <Menu.Popup className="flex w-[300px] flex-col rounded-xl bg-raised p-1.5 shadow-[inset_0_0_0_1px_var(--color-line-2),0_16px_40px_rgb(0_0_0/50%)] outline-none">
              <MenuItem
                icon={<RotateCcwIcon />}
                label="Restore original config…"
                disabled={!canRestore}
                hint={
                  canRestore
                    ? "Puts back the file from before your first save"
                    : "Available after your first save"
                }
                onClick={() => setConfirm(true)}
              />
              <MenuItem
                icon={<CopyIcon />}
                label="Copy the config file path"
                hint={configPath}
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
              Puts back <code className="text-fg">{tildePath(configPath)}</code>{" "}
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
                  .then(() => notify("Restored your original config."))
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
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      disabled={props.disabled}
      className="flex cursor-default items-start gap-2.5 rounded-md px-2.5 py-[7px] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-hover [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-2"
      onClick={props.onClick}>
      {props.icon}
      <span className="flex min-w-0 flex-col gap-px">
        {props.label}
        <small className="text-sm break-all text-fg-3">{props.hint}</small>
      </span>
    </Menu.Item>
  );
}

function Logo() {
  return (
    <svg aria-hidden viewBox="0 0 22 22" className="size-[22px] shrink-0">
      <rect width="22" height="22" rx="5.5" className="fill-primary" />
      <path
        d="M6 17.5V10a5 5 0 0 1 10 0v7.5l-1.7-1.3-1.6 1.3-1.7-1.3-1.7 1.3-1.6-1.3z"
        fill="#fff"
      />
      <circle cx="9.2" cy="10.3" r="1.1" className="fill-primary" />
      <circle cx="12.8" cy="10.3" r="1.1" className="fill-primary" />
    </svg>
  );
}
