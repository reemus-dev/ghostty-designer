import {draftKeys} from "@/core/resolve";
import {slotColors} from "@/core/theme";
import type {Intent, OptionMeta, SessionState, Values} from "@/core/types";
import {paletteByIndex} from "@/core/values";
import {describeSlot, slotIndex} from "./slots";

export type DraftChange = {
  /** The key `reset` takes: an option key, "palette:N", or "theme". */
  key: string;
  label: string;
  before: string;
  after: string;
  /** Before and after are hex colours. */
  color: boolean;
};

/**
 * What the draft changes against the saved config: one entry per key or palette
 * slot. `colorDefaults` are Ghostty's colours, as in themeColors.
 */
export function draftChanges(
  state: SessionState,
  options: OptionMeta[],
  colorDefaults: Values,
): DraftChange[] {
  const {draft, saved} = state;
  const savedColors = slotColors(saved, colorDefaults);
  const draftColors = slotColors(state.effective, colorDefaults);
  const palette = paletteByIndex(draft.values.palette ?? []);
  return draftKeys(draft).map((key): DraftChange => {
    if (key === "theme") {
      const before = saved.theme?.[0] ?? "None";
      return {key, label: "Theme", before, after: draft.theme!, color: false};
    }
    const index = slotIndex(key);
    if (index !== null) {
      const entry = palette.get(index)!;
      return {
        key,
        label: describeSlot(key).title,
        before: savedColors[key]?.hex ?? "Default",
        after: draftColors[key]?.hex ?? entry.slice(entry.indexOf("=") + 1),
        color: true,
      };
    }
    const option = options.find((meta) => meta.key === key);
    return {
      key,
      label: option?.label ?? key,
      before: (saved[key] ?? []).join(", ") || "Default",
      after: draft.values[key]!.join(", ") || "Default",
      color: option?.control.kind === "color",
    };
  });
}

/** Undoes one change and keeps every other. */
export const undoChange = (change: DraftChange): Intent =>
  change.key === "theme"
    ? {type: "theme", theme: null}
    : {type: "reset", key: change.key};
