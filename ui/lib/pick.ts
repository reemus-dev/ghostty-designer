import {onHistoryMove, send} from "./store";

export const DWELL_MS = 250;

/** A theme name, or null for the user's own colours (the saved theme setting). */
export type ThemeChoice = string | null;

/** The lists that pick with a dwell. Each list's picks wait on their own. */
type PickList = "theme" | "font";

const timers = new Map<PickList, ReturnType<typeof setTimeout>>();
let unsubscribe: (() => void) | undefined;

/**
 * Runs a pick from a list once `dwell` ms pass without another pick from that
 * list, so fast scrolling through the list does not reload on every step.
 */
export function schedulePick(list: PickList, pick: () => void, dwell: number) {
  // Undo, redo and discard win over picks still waiting out their dwell.
  unsubscribe ??= onHistoryMove(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
  cancelPick(list);
  timers.set(list, setTimeout(pick, dwell));
}

/** Drops the list's pick still waiting out its dwell. */
export const cancelPick = (list: PickList) => clearTimeout(timers.get(list));

/**
 * Picks a theme: Ghostty shows it as a draft change, and picks one after
 * another are one undo step. Arrow keys wait out a 250 ms dwell; a click picks
 * at once.
 */
export function pickTheme(theme: ThemeChoice, dwell = DWELL_MS) {
  schedulePick(
    "theme",
    () => void send({type: "theme", theme, pick: true}),
    dwell,
  );
}
