// Undo and redo. Each draft change is a step, unless it continues the last
// step, which it then folds into.
import type {Draft, HistoryEntry, SessionState} from "./types";

const HISTORY_LIMIT = 200;
/**
 * Consecutive sets of one key within this window are one undo step, so a
 * dragged slider undoes at once.
 */
const COALESCE_MS = 1000;
/** The key of `theme` intents' steps. */
export const THEME_KEY = "theme";

/**
 * How a draft change shows in the history, and which later changes continue its
 * step.
 */
export type HistoryChange = {
  label: string;
  /** Only a change with the key of the last step can continue it. */
  key?: string;
  /** A pick from a list: the next pick with its key folds in, however late. */
  pick?: boolean;
  /** An edit: later sets of its key in the same edit fold in, however late. */
  edit?: string;
};

type Step = {
  /** Milliseconds since the Unix epoch. */
  at: number;
  before: Draft;
  after: Draft;
  change: HistoryChange;
};

const historyEntry = ({change}: Step): HistoryEntry => ({label: change.label});

/** What a window reload keeps of the history. */
export type HistorySnapshot = {undo: Step[]; redo: Step[]};

export const EMPTY_DRAFT: Draft = {theme: null, values: {}};

export const sameDraft = (a: Draft, b: Draft) =>
  JSON.stringify(a) === JSON.stringify(b);

export class History {
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];
  /** Counts changes, so a reader can tell whether the history moved. */
  version = 0;

  private continues(last: Step, change: HistoryChange, now: number) {
    if (
      change.key === undefined ||
      last.change.key !== change.key ||
      this.redoSteps.length > 0
    ) {
      return false;
    }
    if (change.pick === true) return last.change.pick === true;
    return change.edit === undefined
      ? last.change.pick !== true &&
          last.change.edit === undefined &&
          last.change.label === change.label &&
          now - last.at < COALESCE_MS
      : last.change.edit === change.edit;
  }

  /**
   * Records the change from `draft` to `next`. A change with the key of the
   * last step continues it when both are picks, both belong to one edit, or
   * they are a drag (same label, within COALESCE_MS). A continued step back
   * where it began is dropped. Returns the theme of a theme step that this
   * change ended while keeping its theme, which becomes recent.
   */
  record(draft: Draft, next: Draft, change: HistoryChange, now = Date.now()) {
    const changed = !sameDraft(next, draft);
    const last = this.undoSteps.at(-1);
    let ended: string | null = null;
    if (last && this.continues(last, change, now)) {
      last.change = {...last.change, label: change.label};
      last.after = next;
      last.at = now;
      if (sameDraft(last.before, next)) this.undoSteps.pop();
      this.version++;
    } else if (changed) {
      if (
        last?.change.key === THEME_KEY &&
        draft.theme !== null &&
        draft.theme === next.theme &&
        sameDraft(last.after, draft)
      ) {
        ended = draft.theme;
      }
      const step = {at: now, before: draft, after: next, change};
      this.undoSteps = [...this.undoSteps, step].slice(-HISTORY_LIMIT);
      this.version++;
    }
    if (changed && this.redoSteps.length > 0) {
      this.redoSteps = [];
      this.version++;
    }
    return ended;
  }

  /** Moves the last step to redo and gives the draft from before it. */
  undo() {
    const step = this.undoSteps.pop();
    if (!step) return;
    this.redoSteps.push(step);
    this.version++;
    return step.before;
  }

  /** Moves the last undone step back and gives the draft from after it. */
  redo() {
    const step = this.redoSteps.pop();
    if (!step) return;
    this.undoSteps.push(step);
    this.version++;
    return step.after;
  }

  /** Forgets every step. */
  clear() {
    this.undoSteps = [];
    this.redoSteps = [];
    this.version++;
  }

  entries(): SessionState["history"] {
    return {
      undo: this.undoSteps.map(historyEntry),
      redo: this.redoSteps.map(historyEntry),
    };
  }

  snapshot(): HistorySnapshot {
    return {undo: this.undoSteps, redo: this.redoSteps};
  }

  restore({undo, redo}: HistorySnapshot) {
    this.undoSteps = undo;
    this.redoSteps = redo;
    this.version++;
  }
}
