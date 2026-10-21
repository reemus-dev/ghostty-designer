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
  role: string;
  /** The colour it is read with. */
  against: SlotId;
  /** True when text sits on it, so specimens swap text and background. */
  surface?: boolean;
};

export const BASE_SLOTS: readonly BaseSlot[] = [
  {
    key: "background",
    label: "Background",
    role: "Behind every cell without its own colour",
    against: "foreground",
    surface: true,
  },
  {
    key: "foreground",
    label: "Text",
    role: "Text without its own colour",
    against: "background",
  },
  {
    key: "cursor-color",
    label: "Cursor",
    role: "The block, bar or underline cursor",
    against: "background",
  },
  {
    key: "cursor-text",
    label: "Cursor text",
    role: "The character under a block cursor",
    against: "cursor-color",
  },
  {
    key: "selection-background",
    label: "Selection",
    role: "Cells of selected text",
    against: "selection-foreground",
    surface: true,
  },
  {
    key: "selection-foreground",
    label: "Selection text",
    role: "Selected text",
    against: "selection-background",
  },
  {
    key: "bold-color",
    label: "Bold",
    role: "Bold text; bright uses the bright variant of its colour",
    against: "background",
  },
];

const ANSI: readonly [name: string, role: string][] = [
  ["Black", "Dark panels in TUIs, black text on light themes"],
  ["Red", "Errors, deletions, failed exit codes"],
  ["Green", "Success, additions, staged files"],
  ["Yellow", "Warnings, modified files, search matches"],
  ["Blue", "Directories, links, info messages"],
  ["Magenta", "Keywords, git branches, special files"],
  ["Cyan", "Strings, symlinks, types"],
  ["White", "Light text in TUIs, dark themes' secondary text"],
  ["Bright black", "Comments, autosuggestions, dim git lines"],
  ["Bright red", "Bold errors, emphasised deletions"],
  ["Bright green", "Executables, bold success"],
  ["Bright yellow", "Highlights, bold warnings"],
  ["Bright blue", "Bold directories, active tabs"],
  ["Bright magenta", "Bold keywords, prompts"],
  ["Bright cyan", "Bold strings, info highlights"],
  ["Bright white", "Emphasised text, headings"],
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
  const [name, role] = ANSI[index] ?? [
    `Colour ${index}`,
    "One of the 256 colours terminal apps pick by number",
  ];
  return {
    title: name,
    role,
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
