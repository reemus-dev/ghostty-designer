import type {Intent, ReadabilityWarning, ThemeColors} from "@/core/types";
import {paletteEntry} from "@/core/values";

/**
 * An editable colour: a palette slot ("palette:8", also its provenance key) or
 * a colour option key.
 */
export type SlotId = string;

type BaseSlot = {
  key: string;
  label: string;
  /** The colour it is read with. */
  against: SlotId;
  /** True when text sits on it, so specimens swap text and background. */
  surface?: boolean;
};

export const BASE_SLOTS: readonly BaseSlot[] = [
  {
    key: "background",
    label: "Background",
    against: "foreground",
    surface: true,
  },
  {
    key: "foreground",
    label: "Text",
    against: "background",
  },
  {
    key: "cursor-color",
    label: "Cursor",
    against: "background",
  },
  {
    key: "cursor-text",
    label: "Cursor text",
    against: "cursor-color",
  },
  {
    key: "selection-background",
    label: "Selection",
    against: "selection-foreground",
    surface: true,
  },
  {
    key: "selection-foreground",
    label: "Selection text",
    against: "selection-background",
  },
  {
    key: "bold-color",
    label: "Bold",
    against: "background",
  },
];

const ANSI: readonly string[] = [
  "Black",
  "Red",
  "Green",
  "Yellow",
  "Blue",
  "Magenta",
  "Cyan",
  "White",
  "Bright black",
  "Bright red",
  "Bright green",
  "Bright yellow",
  "Bright blue",
  "Bright magenta",
  "Bright cyan",
  "Bright white",
];

/** The 16 terminal colours, palette 0-15. */
export const TERMINAL_SLOTS: readonly SlotId[] = ANSI.map(
  (_, i) => `palette:${i}`,
);

export const slotIndex = (id: SlotId) =>
  id.startsWith("palette:") ? Number(id.slice(8)) : null;

export function describeSlot(id: SlotId) {
  const index = slotIndex(id);
  if (index === null) {
    const base = BASE_SLOTS.find((slot) => slot.key === id)!;
    return {...base, title: base.label};
  }
  return {
    title: ANSI[index] ?? `Colour ${index}`,
    against: "background",
    surface: false,
  };
}

/** A contrast ratio to three significant digits: 2.78, 11.3. */
export const formatRatio = (ratio: number) =>
  ratio.toFixed(ratio >= 10 ? 1 : 2);

/** The slot a readability warning is about. */
export const warningSlot = (warning: ReadabilityWarning): SlotId =>
  warning.slot === undefined ? warning.key : `palette:${warning.slot}`;

/** The `set` intent that writes a slot's colour. */
export function setSlot(id: SlotId, hex: string, label: string): Intent {
  const index = slotIndex(id);
  return index === null
    ? {type: "set", key: id, values: [hex], label}
    : {type: "set", key: "palette", values: [paletteEntry(index, hex)], label};
}

/** A slot's colour in a theme, when the theme sets it. */
export function themeSlot(colors: ThemeColors, id: SlotId) {
  const index = slotIndex(id);
  if (index !== null) return colors.palette[index];
  const byKey: Record<string, string | undefined> = {
    background: colors.background,
    foreground: colors.foreground,
    "cursor-color": colors.cursorColor,
    "cursor-text": colors.cursorText,
    "selection-background": colors.selectionBackground,
    "selection-foreground": colors.selectionForeground,
  };
  return byKey[id];
}
