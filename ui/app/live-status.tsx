import {useRef, useState} from "react";
import {cn} from "cn";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Switch} from "@/components/ui/switch";
import type {EditedConfig} from "@/core/bindings";
import {isLive} from "@/core/preview";
import type {OptionMeta, SessionState} from "@/core/types";
import {send, useSnapshot} from "@/lib/store";
import {appName, NOT_SHOWING_TEXT, revealOption} from "@/lib/views";

type Status = {
  label: string;
  /** The label in a narrow window, so the dot's colour never stands alone. */
  short: string;
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
  /** Written, but nothing reports whether the app reloads it. */
  unsure: "ring-[1.5px] ring-live ring-inset",
};

function liveStatus(
  state: SessionState,
  options: OptionMeta[],
  edited: EditedConfig,
): Status {
  const app = appName(edited);
  if (!isLive(state)) {
    return {
      label: "Live preview off",
      short: "Off",
      dot: DOT.off,
      detail: `${appName(edited, true)} updates only when you save.`,
    };
  }
  if (state.apply.state === "paused") {
    return {
      label: "Preview paused",
      short: "Paused",
      dot: DOT.off,
      detail: `${appName(edited, true)} shows your saved config while you compare.`,
    };
  }
  if (state.apply.state === "error") {
    const {error = "Ghostty did not reload the preview.", rejected = []} =
      state.apply;
    const key = rejected[0];
    if (key === undefined) {
      return {
        label: "Couldn't update the preview",
        short: "Error",
        dot: DOT.warn,
        warn: true,
        detail: `${error}\nGhostty keeps showing the last changes it accepted.`,
      };
    }
    const label = options.find((option) => option.key === key)?.label ?? key;
    return {
      label: `Ghostty didn't accept ${label}`,
      short: "Error",
      dot: DOT.warn,
      warn: true,
      detail: `${error}\nYour other changes show in ${app}.`,
      action: {label: `Go to ${label}`, run: () => revealOption(key)},
    };
  }
  if (state.previewShadowed) {
    return {
      label: NOT_SHOWING_TEXT.shadowed,
      short: NOT_SHOWING_TEXT.shadowed,
      dot: DOT.warn,
      warn: true,
      detail:
        "A config file loaded after the preview overrides some of your changes.",
    };
  }
  if (edited.type === "file") {
    return {
      label: `Preview for ${app}`,
      short: "Preview",
      dot: DOT.unsure,
      detail: `${appName(edited, true)} shows your changes when it reloads its config. Some apps reload on their own. Your config changes only when you save.`,
    };
  }
  if (state.instances === 0) {
    return {
      label: "Live · no open windows",
      short: "Live",
      dot: DOT.live,
      detail:
        "Ghostty isn't running. Your changes show when you open a window. Your config changes only when you save.",
    };
  }
  return {
    label: "Live in Ghostty",
    short: "Live",
    dot: DOT.live,
    detail:
      "Changes preview in your Ghostty windows. Your config changes only when you save.",
  };
}

function useLiveStatus() {
  const state = useSnapshot((snapshot) => snapshot.state);
  const options = useSnapshot((snapshot) => snapshot.options);
  const edited = useSnapshot((snapshot) => snapshot.ghostty.edited);
  return liveStatus(state, options, edited);
}

/**
 * Whether Ghostty shows the changes now: a dot with its words, shortened in a
 * narrow window. A click opens the details, the status's action and the live
 * preview switch. Turning it on shows the setup card when the include is
 * missing.
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
        <span aria-hidden className="lg:hidden">
          {status.short}
        </span>
        <Truncate className="max-w-56 max-lg:sr-only">{status.label}</Truncate>
      </PopoverTrigger>
      <PopoverContent
        align="start"
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
