import {normalizeHex} from "./color";
import {trimWhitespace} from "./config-file";
import type {ThemeColors, Values} from "./types";
import {paletteByIndex} from "./values";

/**
 * The colour keys a theme may set besides palette 0-15 (Ghostty's bundled
 * themes set all 22).
 */
export const THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "cursor-color",
  "cursor-text",
  "selection-background",
  "selection-foreground",
] as const;

/** The keys a theme pick changes: the setting and the colours a theme sets. */
export const THEME_PICK_KEYS = ["theme", ...THEME_COLOR_KEYS, "palette"];

function hexValue(values: Values, key: string) {
  return normalizeHex(values[key]?.[0] ?? "");
}

/** The colour of a palette entry `N=COLOR`. */
const entryHex = (entry: string) =>
  normalizeHex(entry.slice(entry.indexOf("=") + 1));

/**
 * The colours a theme's or config's values show. `defaults` are Ghostty's,
 * which set every colour: they fill unset keys and colours Ghostty rejects.
 */
export function themeColors(values: Values, defaults: Values): ThemeColors {
  const fallback = paletteByIndex(defaults["palette"] ?? []);
  const palette: string[] = [];
  const fill = (length: number) => {
    while (palette.length < length) {
      palette.push(entryHex(fallback.get(palette.length)!)!);
    }
  };
  fill(16);
  const entries = paletteByIndex(values["palette"] ?? []);
  for (const [index, entry] of entries) {
    const hex = entryHex(entry);
    if (!hex) continue;
    fill(index);
    palette[index] = hex;
  }

  const colors: ThemeColors = {
    background:
      hexValue(values, "background") ?? hexValue(defaults, "background")!,
    foreground:
      hexValue(values, "foreground") ?? hexValue(defaults, "foreground")!,
    palette,
  };
  const cursorColor = hexValue(values, "cursor-color");
  const cursorText = hexValue(values, "cursor-text");
  const selectionBackground = hexValue(values, "selection-background");
  const selectionForeground = hexValue(values, "selection-foreground");
  if (cursorColor) {
    colors.cursorColor = cursorColor;
  }
  if (cursorText) {
    colors.cursorText = cursorText;
  }
  if (selectionBackground) {
    colors.selectionBackground = selectionBackground;
  }
  if (selectionForeground) {
    colors.selectionForeground = selectionForeground;
  }
  return colors;
}

export type SlotColor = {
  hex: string;
  /**
   * What the config says: the hex, a keyword such as `cell-foreground`, or
   * "default".
   */
  text: string;
};

/**
 * Every slot's colour as Ghostty draws it, by slot id ("palette:8" or a colour
 * key), with its defaults: an unset cursor and selection invert the cell, and
 * bold falls back to the text colour. `defaults` are Ghostty's colours, as in
 * themeColors.
 */
export function slotColors(
  values: Values,
  defaults: Values,
): Record<string, SlotColor> {
  const colors = themeColors(values, defaults);
  const result: Record<string, SlotColor> = {
    background: {hex: colors.background, text: colors.background},
    foreground: {hex: colors.foreground, text: colors.foreground},
  };
  for (const [i, hex] of colors.palette.slice(0, 16).entries()) {
    result[`palette:${i}`] = {hex, text: hex};
  }

  const keyword = (key: string, fallback: string): SlotColor => {
    const raw = values[key]?.[0];
    if (!raw) return {hex: fallback, text: "default"};
    const cell: Record<string, string> = {
      "cell-foreground": colors.foreground,
      "cell-background": colors.background,
    };
    return {hex: cell[raw] ?? normalizeHex(raw) ?? fallback, text: raw};
  };
  result["cursor-color"] = keyword("cursor-color", colors.foreground);
  result["cursor-text"] = keyword("cursor-text", colors.background);
  result["selection-background"] = keyword(
    "selection-background",
    colors.foreground,
  );
  result["selection-foreground"] = keyword(
    "selection-foreground",
    colors.background,
  );
  result["bold-color"] = keyword("bold-color", colors.foreground);
  return result;
}

/** The `theme` setting of a light/dark pair. */
export const formatThemePair = (pair: {light: string; dark: string}) =>
  `light:${pair.light},dark:${pair.dark}`;

/**
 * `setting` with the theme `from` renamed to `to`, or null when `to` is null
 * and the setting names `from`.
 */
export function replaceTheme(setting: string, from: string, to: string | null) {
  const pair = resolveThemePair(setting);
  if (!pair || (pair.light !== from && pair.dark !== from)) return setting;
  if (to === null) return null;
  const swap = (name: string) => (name === from ? to : name);
  return /[,:=]/.test(setting)
    ? formatThemePair({light: swap(pair.light), dark: swap(pair.dark)})
    : to;
}

/**
 * Splits a `theme` setting into its light and dark names. Like Ghostty, any
 * comma, colon or equals sign makes it a pair, which must read `light:A,dark:B`
 * in either order (src/config/Config.zig:9785-9797); otherwise one name serves
 * both. Null for a malformed pair.
 */
export function resolveThemePair(theme: string) {
  if (!/[,:=]/.test(theme)) {
    const name = trimWhitespace(theme);
    return {light: name, dark: name};
  }

  const pair: Record<string, string> = {};
  for (const part of theme.split(",")) {
    const colon = part.indexOf(":");
    if (colon === -1) return null;
    const side = trimWhitespace(part.slice(0, colon));
    const name = trimWhitespace(part.slice(colon + 1));
    if (name === "" || (side !== "light" && side !== "dark")) return null;
    pair[side] = name;
  }
  return pair["light"] && pair["dark"]
    ? {light: pair["light"], dark: pair["dark"]}
    : null;
}
