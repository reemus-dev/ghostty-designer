// The session's requests, one at a time, and intents from a drag, a scrub or
// typing, applied at a pace the session keeps up with.
import type {Intent} from "./types";
import {paletteIndex} from "./values";

type Waiting = {intent: Intent; done: PromiseWithResolvers<void>};
type Slot = {waiting?: Waiting; busy: boolean};

/**
 * One slot per option, per palette index, per tag of an option, or per other
 * intent type.
 */
function liveKey(intent: Intent) {
  if (intent.type === "set" && intent.key === "palette") {
    return `set:palette:${paletteIndex(intent.values[0] ?? null)}`;
  }
  if (intent.type === "set") return `set:${intent.key}`;
  if (intent.type === "set-tag") return `set-tag:${intent.key}:${intent.tag}`;
  return intent.type;
}

/**
 * Applies live intents through `run`: at most one per slot every `ms`, in
 * order, and always the last. Each intent renders the preview, matches the
 * colours against every theme and sends the draft to the host, too much work
 * for every pointer event. `flush` sends the waiting ones at once, so a request
 * after it applies after them.
 */
export function liveIntents(
  run: (intent: Intent) => Promise<void>,
  ms: number,
) {
  const slots = new Map<string, Slot>();

  const apply = ({intent, done}: Waiting) => {
    const applied = run(intent);
    applied.then(done.resolve, done.reject);
    return applied;
  };

  const send = (slot: Slot, waiting: Waiting) => {
    slot.waiting = undefined;
    slot.busy = true;
    const pause = new Promise((resolve) => setTimeout(resolve, ms));
    void Promise.allSettled([apply(waiting), pause]).then(() => {
      slot.busy = false;
      if (slot.waiting) send(slot, slot.waiting);
    });
  };

  return {
    /**
     * Resolves once the intent applies, or at once when a later one replaces
     * it.
     */
    offer(intent: Intent) {
      const key = liveKey(intent);
      let slot = slots.get(key);
      if (!slot) {
        slot = {busy: false};
        slots.set(key, slot);
      }
      slot.waiting?.done.resolve();
      const waiting = {intent, done: Promise.withResolvers<void>()};
      if (slot.busy) slot.waiting = waiting;
      else send(slot, waiting);
      return waiting.done.promise;
    },

    flush() {
      for (const slot of slots.values()) {
        if (!slot.waiting) continue;
        void apply(slot.waiting);
        slot.waiting = undefined;
      }
    },
  };
}

/**
 * Runs the session's requests one at a time, in the order they come, so each
 * sees the effects of those before. Live intents wait in their slot until it is
 * free, or until another request comes, which runs after them.
 */
export function requestQueue(
  handle: (intent: Intent) => Promise<void>,
  ms: number,
) {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => T | Promise<T>) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
  const apply = (intent: Intent) => enqueue(() => handle(intent));
  const live = liveIntents(apply, ms);

  return {
    intent: (intent: Intent) => {
      live.flush();
      return apply(intent);
    },
    live: (intent: Intent) => live.offer(intent),
    /** Runs `task` after the requests before it. */
    serial: <T>(task: () => T | Promise<T>) => {
      live.flush();
      return enqueue(task);
    },
  };
}
