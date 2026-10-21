import {onHistoryMove, send} from "./store";

export const DWELL_MS = 250;

/** A theme name, or null for the user's own colours (the saved theme setting). */
export type ThemeChoice = string | null;

const pending: {
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
} = {};

/**
 * Runs a pick from a list once `dwell` ms pass without another pick, so fast
 * scrolling through the list does not reload on every step.
 */
export function schedulePick(pick: () => void, dwell: number) {
  // Undo, redo and discard win over a pick still waiting out its dwell.
  pending.unsubscribe ??= onHistoryMove(cancelPick);
  clearTimeout(pending.timer);
  pending.timer = setTimeout(pick, dwell);
}

/** Drops the pick still waiting out its dwell. */
export const cancelPick = () => clearTimeout(pending.timer);

/**
 * Picks a theme: Ghostty shows it as a draft change, and picks one after
 * another are one undo step. Arrow keys wait out a 250 ms dwell; a click picks
 * at once.
 */
export function pickTheme(theme: ThemeChoice, dwell = DWELL_MS) {
  schedulePick(() => void send({type: "theme", theme, pick: true}), dwell);
}
