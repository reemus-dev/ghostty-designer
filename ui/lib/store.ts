import {useSyncExternalStore} from "react";
import {errorText} from "@/core/errors";
import {type Session, startSession} from "@/core/session";
import type {
  Intent,
  SaveThemeSource,
  SessionMessage,
  SessionState,
  Snapshot,
} from "@/core/types";
import {closePromptShown, host} from "./host";
import {MOD} from "./keys";
import type {ThemeChoice} from "./pick";
import type {SlotId} from "./slots";
import type {View} from "./views";

type Notice = {id: number; text: string; tone: "info" | "error"};

export type ThemeFilters = {
  query: string;
  mode: "all" | "dark" | "light";
  readable: boolean;
  starred: boolean;
};

const NO_FILTERS: ThemeFilters = {
  query: "",
  mode: "all",
  readable: false,
  starred: false,
};

type Store = {
  /** Null until the session starts. Its messages keep it current. */
  snapshot: Snapshot | null;
  /** Why the session could not start. */
  failure: string | null;
  /** The window asked to close with unsaved changes. */
  closeRequested: boolean;
  /** One transient line above the bottom bar. */
  notice: Notice | null;
  view: View;
  paletteOpen: boolean;
  saveOpen: boolean;
  /** The open "Save as theme" dialog: what it saves, and the name it suggests. */
  saveTheme: {source: SaveThemeSource; name: string} | null;
  /** "Not now" on the setup card: the views show while live preview is off. */
  setupLater: boolean;
  /** The colour in Customise's editor. */
  color: SlotId;
  /** The theme in Themes' detail panel. */
  theme: ThemeChoice;
  themeFilters: ThemeFilters;
};

/** Module state lives in objects: lint forbids reassigning top-level bindings. */
const current: {store: Store; session?: Session} = {
  store: {
    snapshot: null,
    failure: null,
    closeRequested: false,
    notice: null,
    view: "customise",
    paletteOpen: false,
    saveOpen: false,
    saveTheme: null,
    setupLater: false,
    color: "background",
    theme: null,
    themeFilters: NO_FILTERS,
  },
};
const listeners = new Set<() => void>();

function update(patch: Partial<Store>) {
  current.store = {...current.store, ...patch};
  for (const listener of listeners) listener();
}

function updateSnapshot(change: (snapshot: Snapshot) => Snapshot) {
  const {snapshot} = current.store;
  if (snapshot) update({snapshot: change(snapshot)});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Subscribes to a slice. `select` must return a stored reference, not a new
 * object.
 */
export function useStore<T>(select: (store: Store) => T): T {
  return useSyncExternalStore(subscribe, () => select(current.store));
}

/** Like useStore, for components that render only once the session started. */
export function useSnapshot<T>(select: (snapshot: Snapshot) => T): T {
  return useSyncExternalStore(subscribe, () => select(current.store.snapshot!));
}

/** The values Ghostty shows for `key`: the saved ones with the draft applied. */
export const useEffective = (key: string) =>
  useSnapshot((snapshot) => snapshot.state.effective[key]);

/** The current store, for event handlers outside React's render. */
export const getStore = () => current.store;

// ─── Session ───

/** Starts the session. Call once at start. */
export function start() {
  startSession(host, receive)
    .then((session) => {
      current.session = session;
      // Themes opens on the theme Ghostty shows.
      const {themePair, appearance} = session.snapshot.state;
      update({
        snapshot: session.snapshot,
        theme: themePair?.[appearance] ?? null,
      });
    })
    .catch((error: unknown) => update({failure: errorText(error)}));
}

function receive(message: SessionMessage) {
  switch (message.type) {
    case "state": {
      updateSnapshot((snapshot) => ({...snapshot, state: message.state}));
      break;
    }
    case "fonts": {
      updateSnapshot((snapshot) => ({...snapshot, fonts: message.fonts}));
      break;
    }
    case "themes": {
      updateSnapshot((snapshot) => ({...snapshot, themes: message.themes}));
      break;
    }
    case "error": {
      notify(message.message, "error");
      break;
    }
    case "close-requested": {
      update({closeRequested: true});
      // The window closes anyway unless the page answers in time, so a page
      // still loading lets it close.
      if (current.store.snapshot) void closePromptShown().catch(console.error);
      break;
    }
  }
}

/** The session, for components that render only after it starts. */
export const session = () => current.session!;

export const setCloseRequested = (closeRequested: boolean) =>
  update({closeRequested});

// ─── Intents ───

const inflight = new Set<Promise<void>>();

/**
 * The edit of the focused field or slider (marked `data-edits`): its sets make
 * one undo step. It ends a tick after focus leaves, so a value the field sends
 * as it blurs still belongs to it.
 */
const editing: {id?: string; root?: Element} = {};

/** Starts an edit when the event enters a `[data-edits]` root it is not in. */
function beginEdit(event: Event) {
  const root =
    event.target instanceof Element
      ? event.target.closest("[data-edits]")
      : null;
  if (!root || root === editing.root) return;
  editing.id = crypto.randomUUID();
  editing.root = root;
}

/**
 * Follows fields and sliders. A press starts an edit too, because a slider
 * sends its first value before its thumb takes focus. Call once at start.
 */
export function trackEdits() {
  addEventListener("pointerdown", beginEdit, true);
  addEventListener("focusin", beginEdit);
  addEventListener("focusout", () => {
    const {id, root} = editing;
    setTimeout(() => {
      if (editing.id !== id || root?.contains(document.activeElement)) return;
      editing.id = undefined;
      editing.root = undefined;
    }, 0);
  });
}

/** Marks a set made during an edit, when the intent is made rather than sent. */
const inEdit = (intent: Intent): Intent =>
  editing.id !== undefined &&
  (intent.type === "set-tag" || (intent.type === "set" && !intent.pick))
    ? {...intent, edit: editing.id}
    : intent;

/** Sends an intent. A rejected intent shows its error as a notice. */
export const send = (intent: Intent) => track(session().intent(inEdit(intent)));

/**
 * Sends an intent from a drag, a scrub or typing, which the session paces. It
 * folds a run of them, or all of an edit's, into one undo step.
 */
export const sendLive = (intent: Intent) =>
  void track(session().live(inEdit(intent)));

function track(applying: Promise<void>) {
  const delivery = applying
    .catch((error: unknown) => notify(errorText(error), "error"))
    .finally(() => inflight.delete(delivery));
  inflight.add(delivery);
  return delivery;
}

/** Resolves once no intent is in flight, so the stored state has their effects. */
async function settled() {
  while (inflight.size > 0) await Promise.all(inflight);
}

const historyListeners = new Set<() => void>();

/**
 * Calls `listener` when undo, redo or discard replaces the draft. Returns the
 * unsubscribe.
 */
export function onHistoryMove(listener: () => void) {
  historyListeners.add(listener);
  return () => void historyListeners.delete(listener);
}

const moves = {queue: Promise.resolve()};

/**
 * Sends an undo, redo or revert once the intents before it, such as a drag's
 * first value, have applied, so `notice` reads the state the move applies to.
 * `notice` names the move, or returns null when there is nothing to move.
 */
function moveHistory(
  intent: Intent,
  notice: (state: SessionState) => string | null,
) {
  for (const listener of historyListeners) listener();
  moves.queue = moves.queue.then(async () => {
    await settled();
    const state = current.store.snapshot?.state;
    const text = state && notice(state);
    if (!text) return;
    notify(text);
    await send(intent);
  });
}

/** Undoes or redoes one step and names it in a notice. */
export function stepHistory(direction: "undo" | "redo") {
  moveHistory({type: direction}, (state) => {
    const step = state.history[direction].at(-1);
    if (!step) return null;
    return `${direction === "undo" ? "Undid" : "Redid"}: ${step.label}`;
  });
}

export function revertAll() {
  moveHistory({type: "revert"}, (state) =>
    state.changes > 0
      ? `Discarded all changes · ${MOD}Z brings them back`
      : null,
  );
}

const peek = {on: false};

/**
 * Compare with saved: Ghostty shows the saved config while on (the `pause`
 * intent).
 */
export function setPeek(on: boolean) {
  if (on === peek.on) return;
  peek.on = on;
  void send({type: "pause", paused: on});
}

// ─── UI state ───

const notices = {lastId: 0};
const NOTICE_MS = 4000;

export function notify(
  text: string,
  tone: Notice["tone"] = "info",
  ms = NOTICE_MS,
) {
  const notice = {id: ++notices.lastId, text, tone};
  update({notice});
  setTimeout(() => {
    if (current.store.notice?.id === notice.id) update({notice: null});
  }, ms);
}

/** The notice floats over the view's content, so it leaves with that view. */
export const setView = (view: View) => update({view, notice: null});

export const setPaletteOpen = (paletteOpen: boolean) => update({paletteOpen});

export const setSaveOpen = (saveOpen: boolean) => update({saveOpen});

/** Opens the "Save as theme" dialog for `source`. */
export const openSaveTheme = (source: SaveThemeSource) =>
  update({
    saveTheme: {
      source,
      name:
        typeof source === "object" ? `${source.theme} (my copy)` : "My colours",
    },
  });

export const closeSaveTheme = () => update({saveTheme: null});

export const setColor = (color: SlotId) => update({color});

export const setTheme = (theme: ThemeChoice) => update({theme});

export const setThemeFilters = (filters: Partial<ThemeFilters>) =>
  update({themeFilters: {...current.store.themeFilters, ...filters}});

export const clearThemeFilters = () => update({themeFilters: NO_FILTERS});

/** Hides the setup card for now, or shows it again with false. */
export const setSetupLater = (setupLater: boolean) => update({setupLater});

/**
 * The setup card shows in place of the views: live preview is off and not put
 * off.
 */
export const showsSetup = (store: Store) =>
  !store.snapshot?.state.previewInstalled && !store.setupLater;
