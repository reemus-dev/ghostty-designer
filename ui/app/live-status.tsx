import {useRef, useState} from "react";
import {cn} from "cn";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Switch} from "@/components/ui/switch";
import {isLive} from "@/core/preview";
import type {OptionMeta, SessionState} from "@/core/types";
import {send, useSnapshot} from "@/lib/store";
import {NOT_SHOWING_TEXT, revealOption} from "@/lib/views";

type Status = {
  label: string;
  dot: string;
  warn?: boolean;
  detail: string;
  /** A button in the popover. `run` returns the element to focus. */
  action?: {label: string; run: () => HTMLElement | null};
};

const DOT = {
  live: "bg-live ring-3 ring-live/16",
  off: "bg-muted-foreground",
  warn: "bg-warn ring-3 ring-warn/12",
};

function liveStatus(state: SessionState, options: OptionMeta[]): Status {
  if (!isLive(state)) {
    return {
      label: "Live preview off",
      dot: DOT.off,
      detail: "Ghostty updates only when you save.",
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
      detail: `${error}\nYour other changes show in Ghostty.`,
      action: {label: `Go to ${label}`, run: () => revealOption(key)},
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

/**
 * Whether Ghostty shows the changes now: a dot, with its words in a wide
 * window. A click opens the details, the status's action and the live preview
 * switch. Turning it on shows the setup card when the include is missing.
 */
export function LiveStatus() {
  const status = useLiveStatus();
  const livePreview = useSnapshot((snapshot) => snapshot.state.livePreview);
  const [open, setOpen] = useState(false);
  /** The action's focus target, or null when the popover closed without one. */
  const chosen = useRef<HTMLElement | null>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-7 min-w-0 shrink items-center gap-2 rounded-full px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent",
          status.warn && "text-warn",
        )}>
        <Dot status={status} />
        <span className="truncate max-lg:sr-only">{status.label}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80"
        finalFocus={() => {
          const target = chosen.current;
          chosen.current = null;
          return target ?? true;
        }}>
        <div className="flex flex-col gap-1 px-1">
          <span
            className={cn(
              "flex items-center gap-2 font-medium",
              status.warn && "text-warn",
            )}>
            <Dot status={status} />
            {status.label}
          </span>
          <p className="whitespace-pre-wrap text-muted-foreground">
            {status.detail}
          </p>
        </div>
        {status.action && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              chosen.current = status.action!.run();
              setOpen(false);
            }}>
            {status.action.label}
          </Button>
        )}
        <label className="flex items-center justify-between gap-3 border-t px-1 pt-2.5 font-medium">
          Live preview
          <Switch
            checked={livePreview}
            onCheckedChange={(on) => void send({type: "live-preview", on})}
          />
        </label>
      </PopoverContent>
    </Popover>
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
