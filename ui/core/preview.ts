import {quoteValue} from "./config-file";
import {errorText} from "./errors";
import {type ApplyStatus, type SessionState, type Values} from "./types";
import {layer} from "./values";

type PreviewInput = {
  /**
   * Theme colours to show, written explicitly because any explicit key beats a
   * theme (src/config/Config.zig:4462-4465).
   */
  themeValues: Values;
  values: Values;
  repeatable: ReadonlySet<string>;
};

/** The preview file text: theme keys, then draft values, which win. */
export function renderPreview({themeValues, values, repeatable}: PreviewInput) {
  const merged = layer(themeValues, values);
  const lines: string[] = [];
  for (const [key, list] of Object.entries(merged)) {
    // Repeatable values append across files; an empty value resets the list,
    // and a scalar to its default (src/cli/args.zig:326-339). Palette entries
    // override by index instead, and `palette = ""` would reset all 256 colours.
    if (key !== "palette" && (repeatable.has(key) || list.length === 0)) {
      lines.push(`${key} = ""`);
    }
    for (const value of list) lines.push(`${key} = ${quoteValue(value)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * The preview calls and the statuses Ghostty reports for them. Each call
 * schedules a preview text under a new id, and only the statuses of the latest
 * call's id count.
 */
export class PreviewCalls {
  private latest = "";
  /** The preview text last scheduled: "" for a revert, null while unknown. */
  text: string | null = "";

  constructor(private readonly show: (status: ApplyStatus) => void) {}

  /** Schedules `text` through `call`, which sends it to the host with `id`. */
  schedule(text: string, call: (id: string) => Promise<void>) {
    this.text = text;
    // Unique across page reloads, which the host outlives.
    const id = crypto.randomUUID();
    this.latest = id;
    call(id).catch((error: unknown) => {
      if (id === this.latest) {
        this.show({state: "error", error: errorText(error)});
      }
    });
  }

  status(id: string, status: ApplyStatus) {
    if (id === this.latest) this.show(status);
  }
}

/** Whether the draft previews in Ghostty: live preview is on and installed. */
export const isLive = (state: SessionState) =>
  state.livePreview && state.previewInstalled;

/**
 * Why Ghostty does not show the draft for some keys: live preview is off or its
 * include is not installed, Compare with saved pauses it, Ghostty rejected the
 * keys, or a file that loads after the preview sets them too.
 */
export type NotShowing = "off" | "paused" | "rejected" | "shadowed";

/**
 * Why Ghostty does not show the draft for these keys now, or null when it does.
 * Ghostty shows the saved values of keys the draft leaves alone.
 */
export function whyNotShowing(
  state: SessionState,
  keys: readonly string[],
): NotShowing | null {
  const {draft} = state;
  const touched = keys.some((key) =>
    key === "theme" ? draft.theme !== null : Object.hasOwn(draft.values, key),
  );
  if (!touched) return null;
  if (!isLive(state)) return "off";
  if (state.apply.state === "paused") return "paused";
  if (state.apply.state === "error") {
    const rejected = state.apply.rejected ?? [];
    if (rejected.length === 0 || keys.some((key) => rejected.includes(key))) {
      return "rejected";
    }
  }
  return state.previewShadowed ? "shadowed" : null;
}
