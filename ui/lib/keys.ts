const MAC = navigator.platform.startsWith("Mac");
/**
 * Shortcut labels for this platform: ⌘ and ⌥ on macOS, Ctrl+ and Alt+
 * elsewhere.
 */
export const MOD = MAC ? "⌘" : "Ctrl+";
export const ALT = MAC ? "⌥" : "Alt+";
/** The Alt key on its own, as in "hold ⌥". */
export const ALT_KEY = MAC ? "⌥" : "Alt";
export const SHIFT_MOD = MAC ? "⇧⌘" : "Ctrl+Shift+";

/** Input types that take no typing, such as a slider's range input. */
const UNTYPED_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether the target takes typed keys, so the panel's own keys leave them. */
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !UNTYPED_INPUTS.has(target.type)));

export type Direction = "up" | "down" | "left" | "right";

/**
 * The nearest rendered element in a direction: the smallest gap from the
 * element's edge, then the nearest centre across. Up and down reach the next
 * row even when its columns do not line up. Left and right stay in the row.
 */
export function neighbour(
  elements: HTMLElement[],
  from: HTMLElement,
  direction: Direction,
) {
  const here = from.getBoundingClientRect();
  const vertical = direction === "up" || direction === "down";
  const centre = vertical
    ? here.left + here.width / 2
    : here.top + here.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const gap = {
      up: here.top - rect.bottom,
      down: rect.top - here.bottom,
      left: here.left - rect.right,
      right: rect.left - here.right,
    }[direction];
    if (gap < 0) continue;
    if (!vertical && (rect.bottom <= here.top || rect.top >= here.bottom))
      continue;
    const across = vertical
      ? rect.left + rect.width / 2
      : rect.top + rect.height / 2;
    const score = Math.round(gap) * 10_000 + Math.abs(across - centre);
    if (!(score < bestScore)) continue;
    best = element;
    bestScore = score;
  }
  return best;
}
