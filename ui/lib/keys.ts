const MAC = navigator.platform.startsWith("Mac");
/**
 * Shortcut labels for this platform: ⌘ and ⌥ on macOS, Ctrl+ and Alt+
 * elsewhere.
 */
export const MOD = MAC ? "⌘" : "Ctrl+";
export const ALT = MAC ? "⌥" : "Alt+";
export const SHIFT_MOD = MAC ? "⇧⌘" : "Ctrl+Shift+";

export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The element in the next or previous rendered row nearest the element's
 * centre, for grids whose column counts follow the width and sections whose
 * rows do not line up by index.
 */
export function verticalNeighbour(
  elements: HTMLElement[],
  from: HTMLElement,
  down: boolean,
) {
  const here = from.getBoundingClientRect();
  const centre = here.left + here.width / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const dy = down ? rect.top - here.top : here.top - rect.top;
    if (dy < 1) continue;
    const score = dy * 10_000 + Math.abs(rect.left + rect.width / 2 - centre);
    if (!(score < bestScore)) continue;
    best = element;
    bestScore = score;
  }
  return best;
}
