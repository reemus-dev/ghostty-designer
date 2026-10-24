import type {ReactNode} from "react";
import {cn} from "cn";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import type {OptionMeta, SessionState} from "@/core/types";
import {setSetupLater, useSnapshot} from "@/lib/store";
import {NOT_SHOWING_TEXT, revealOption} from "@/lib/views";

type Status = {
  label: string;
  dot: string;
  warn?: boolean;
  detail: string;
  /** What a click does: makes the status a button. */
  action?: () => void;
};

const DOT = {
  live: "bg-live ring-3 ring-live/16",
  off: "bg-muted-foreground",
  warn: "bg-warn ring-3 ring-warn/12",
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
      detail:
        "Ghostty isn't running. Your changes show once a window opens. Nothing is written to your config until you save.",
    };
  }
  return {
    label: "Live in Ghostty",
    dot: DOT.live,
    detail:
      "Every change shows in your Ghostty windows right away. Nothing is written to your config until you save.",
  };
}

function useLiveStatus() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  return liveStatus(state, options);
}

/** Whether Ghostty shows the changes now, as a dot. Its words show on hover. */
export function LiveDot() {
  const status = useLiveStatus();
  return (
    <StatusTrigger
      status={status}
      side="right"
      aria-label={status.label}
      tip={
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{status.label}</span>
          <span className="text-muted-foreground">{status.detail}</span>
        </span>
      }
      className="size-8 justify-center rounded-lg">
      <Dot status={status} />
    </StatusTrigger>
  );
}

/**
 * The status in words while it needs the user: Ghostty didn't accept a value,
 * another file overrides the preview, or live preview is off.
 */
export function LiveAlert() {
  const status = useLiveStatus();
  if (!status.warn && !status.action) return null;
  return (
    <StatusTrigger
      status={status}
      side="bottom"
      tip={status.detail}
      className="h-7 min-w-0 shrink gap-2 rounded-full px-2 text-sm">
      <Dot status={status} />
      <span className="truncate">{status.label}</span>
    </StatusTrigger>
  );
}

function StatusTrigger(props: {
  status: Status;
  side: "right" | "bottom";
  tip: ReactNode;
  className: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const {status, side, tip, className, children} = props;
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
        aria-label={props["aria-label"]}
        className={cn(
          "flex shrink-0 items-center whitespace-nowrap text-muted-foreground",
          status.warn && "text-warn",
          action && "hover:bg-accent",
          className,
        )}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-sm whitespace-pre-wrap">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

function Dot(props: {status: Status}) {
  return (
    <span
      aria-hidden
      className={cn("size-[7px] shrink-0 rounded-full", props.status.dot)}
    />
  );
}
