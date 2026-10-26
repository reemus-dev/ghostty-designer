// Theme files: the bundled themes and the user's, with the values each sets,
// and the colour analysis the gallery and the session show.
import type {ThemeFile} from "@/core/bindings";
import {
  contrastRatio,
  fixLightness,
  normalizeHex,
  oklabDistance,
  relativeLuminance,
  toOklch,
} from "./color";
import {parseConfig} from "./config-file";
import {inputError} from "./errors";
// The X11 project's rgb.txt (MIT/X11 license) as Ghostty embeds it
// (src/terminal/res/rgb.txt): its `+list-colors` drops the last buffer of output.
import RGB_TXT from "./rgb.txt";
import {THEME_COLOR_KEYS, themeColors} from "./theme";
import type {
  ColorMatch,
  ReadabilityWarning,
  ThemeColors,
  ThemeSummary,
  Values,
} from "./types";
import {paletteEntry, paletteIndex} from "./values";

export type ThemeLibrary = {
  /** In plain string order of their names; display order is the panel's. */
  themes: ThemeSummary[];
  /** The keys the theme file sets, or undefined for an unknown theme. */
  values(name: string): Values | undefined;
};

// Ghostty applies every key of a theme file (src/config/Config.zig:4413-4418).
const THEME_KEYS = new Set<string>(THEME_COLOR_KEYS);
/**
 * Keys that take only a colour; the others also take keywords such as
 * cell-foreground.
 */
const HEX_KEYS = new Set(["background", "foreground"]);

/** Below this luminance white text contrasts more than black (WCAG 2). */
const DARK_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;
/** Mean chroma of ANSI 1-6 under which a theme has no accent hue. */
const GREYSCALE_CHROMA = 0.02;
const HUE_SPREAD = 30;

/** X11 colour names, lower-cased because Ghostty ignores case, with their hex. */
const COLOR_NAMES = new Map(
  RGB_TXT.split("\n")
    .filter(Boolean)
    .map((line) => {
      // Columns as Ghostty reads them (src/terminal/x11_color.zig).
      const rgb = [0, 4, 8].map((at) => Number(line.slice(at, at + 3)));
      const hex = rgb.map((part) => part.toString(16).padStart(2, "0"));
      return [line.slice(12).trim().toLowerCase(), `#${hex.join("")}`];
    }),
);

/** A colour value as hex, X11 names included (src/config/Config.zig:5395-5406). */
const colorHex = (value: string) =>
  normalizeHex(value) ?? COLOR_NAMES.get(value.trim().toLowerCase());

/**
 * The keys a theme file sets. Colours are hex, so they compare with the
 * config's. A colour Ghostty would reject is left out.
 */
function parseTheme(text: string) {
  const values: Values = {};
  const palette = new Map<number, string>();

  // Theme files are config files: values may be quoted.
  for (const line of parseConfig("", text).lines) {
    if (line.kind !== "entry" || line.value === null) {
      continue;
    }
    const {key, value} = line;

    // An empty value resets a key to its default (src/cli/args.zig:326-338).
    // A theme loads into an empty config, so the key is as if unset.
    if (value === "") {
      if (key === "palette") palette.clear();
      else delete values[key];
    } else if (key === "palette") {
      const index = paletteIndex(value);
      const hex = colorHex(value.slice(value.indexOf("=") + 1));
      if (hex && index !== undefined) {
        palette.set(index, hex);
      }
    } else if (HEX_KEYS.has(key)) {
      const hex = colorHex(value);
      if (hex) {
        values[key] = [hex];
      }
    } else if (THEME_KEYS.has(key)) {
      values[key] = [colorHex(value) ?? value];
    } else {
      values[key] = [...(values[key] ?? []), value];
    }
  }

  if (palette.size > 0) {
    values["palette"] = [...palette]
      .toSorted(([a], [b]) => a - b)
      .map(([index, hex]) => paletteEntry(index, hex));
  }
  return values;
}

/**
 * The hue of the ANSI 1-6 colour with the most chroma-weighted neighbours
 * within HUE_SPREAD degrees, so a cluster of accents wins over one outlier.
 */
function accentHue(accents: string[]) {
  const oklch = accents.map((hex) => toOklch(hex));
  if (
    oklch.reduce((sum, {c}) => sum + c, 0) / oklch.length <
    GREYSCALE_CHROMA
  ) {
    return null;
  }

  let best = {hue: 0, weight: -1};
  for (const {h} of oklch) {
    let weight = 0;
    for (const other of oklch) {
      const delta = Math.abs(h - other.h);
      const distance = Math.min(delta, 360 - delta);
      weight += other.c * Math.exp(-((distance / HUE_SPREAD) ** 2));
    }
    if (weight > best.weight) {
      best = {hue: h, weight};
    }
  }
  return best.hue;
}

/**
 * ANSI 1-6 and 8: the colours text is commonly drawn in, besides the
 * foreground.
 */
const ACCENT_SLOTS = [1, 2, 3, 4, 5, 6, 8];
/** WCAG 2 AA for body text, and for the larger, sparser text accents colour. */
const FOREGROUND_TARGET = 4.5;
const ACCENT_TARGET = 3;

/**
 * The foreground and accent colours against the background, each with its
 * contrast target.
 */
function textContrast(colors: ThemeColors) {
  const {background} = colors;
  return [
    {key: "foreground", hex: colors.foreground, target: FOREGROUND_TARGET},
    ...ACCENT_SLOTS.map((slot) => ({
      key: "palette",
      slot,
      hex: colors.palette[slot]!,
      target: ACCENT_TARGET,
    })),
  ].map((check) => ({...check, ratio: contrastRatio(check.hex, background)}));
}

/**
 * Text colours that miss their contrast target against the background, each
 * with the nearest fix.
 */
export function readabilityWarnings(colors: ThemeColors): ReadabilityWarning[] {
  const warnings: ReadabilityWarning[] = [];
  for (const {hex, ...check} of textContrast(colors)) {
    if (check.ratio >= check.target) continue;
    // Black or white reaches either target against any background.
    const fix = fixLightness(hex, colors.background, check.target);
    if (fix) warnings.push({...check, fix});
  }
  return warnings;
}

/**
 * Background, foreground and palette 0-15: the colours a theme is recognised
 * by.
 */
const signature = (colors: ThemeColors) => [
  colors.background,
  colors.foreground,
  ...colors.palette.slice(0, 16),
];

/** All 22 theme colours equal. */
const sameColors = (a: ThemeColors, b: ThemeColors) =>
  signature(a).every((hex, i) => hex === signature(b)[i]) &&
  a.cursorColor === b.cursorColor &&
  a.cursorText === b.cursorText &&
  a.selectionBackground === b.selectionBackground &&
  a.selectionForeground === b.selectionForeground;

/**
 * The theme whose colours these are, preferring `current` among equals, else
 * the nearest by weighted OKLab distance. The background fills the window, so
 * it counts as much as palette 0-15 together, and the foreground half as much.
 */
export function matchTheme(
  colors: ThemeColors,
  themes: ThemeSummary[],
  current: string | null,
): ColorMatch | null {
  const exact = themes.filter((theme) => sameColors(theme.colors, colors));
  if (exact.length > 0) {
    const theme = exact.find((t) => t.name === current) ?? exact[0]!;
    return {theme: theme.name, exact: true};
  }

  let best: {theme: string; distance: number} | null = null;
  for (const theme of themes) {
    const distance = theme.colors.palette
      .slice(0, 16)
      .reduce(
        (sum, hex, i) => sum + oklabDistance(hex, colors.palette[i]!),
        16 * oklabDistance(theme.colors.background, colors.background) +
          8 * oklabDistance(theme.colors.foreground, colors.foreground),
      );
    if (!best || distance < best.distance) best = {theme: theme.name, distance};
  }
  return best && {theme: best.theme, exact: false};
}

const words = (name: string) => name.toLowerCase().split(/[\s_-]+/);

/**
 * The likeliest other half of a light/dark pair: the opposite-mode theme
 * sharing the longest leading run of name words ("Rose Pine Moon" → "Rose Pine
 * Dawn", "GitHub Dark Default" → "GitHub Light Default").
 */
export function siblingOf<T extends Pick<ThemeSummary, "name" | "dark">>(
  theme: T,
  themes: T[],
) {
  const mine = words(theme.name);
  let best: T | undefined;
  let bestScore = 0;
  for (const other of themes) {
    if (other.dark === theme.dark) continue;
    const theirs = words(other.name);
    let prefix = 0;
    while (prefix < mine.length && mine[prefix] === theirs[prefix]) prefix++;
    if (prefix === 0) continue;
    const shared = theirs.filter((word) => mine.includes(word)).length;
    const score =
      prefix * 10 + shared * 2 - Math.abs(theirs.length - mine.length);
    if (score <= bestScore) continue;
    best = other;
    bestScore = score;
  }
  return best;
}

function summarize(
  name: string,
  source: ThemeFile["source"],
  values: Values,
  defaults: Values,
): ThemeSummary {
  const colors = themeColors(values, defaults);
  const {background, palette} = colors;
  return {
    name,
    source,
    colors,
    dark: relativeLuminance(background) < DARK_LUMINANCE,
    hue: accentHue(palette.slice(1, 7)),
    warnings: readabilityWarnings(colors),
    readability: Math.min(
      ...textContrast(colors).map(({ratio, target}) => ratio / target),
    ),
  };
}

/**
 * The library of the loaded theme files, their colours over Ghostty's
 * `defaults`. A user theme replaces a bundled one of the same name.
 */
export function themeLibrary(
  files: readonly ThemeFile[],
  defaults: Values,
): ThemeLibrary {
  const byName = new Map<
    string,
    {source: ThemeFile["source"]; values: Values}
  >();
  for (const source of ["bundled", "user"] as const) {
    for (const file of files) {
      if (file.source !== source) continue;
      byName.set(file.name, {source, values: parseTheme(file.text)});
    }
  }

  const themes = [...byName]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, {source, values}]) =>
      summarize(name, source, values, defaults),
    );
  return {themes, values: (name) => byName.get(name)?.values};
}

/**
 * Whether a theme has `name`. A user theme shadows a bundled one of the same
 * name, which would change the look of a config that uses it, and macOS file
 * names ignore case.
 */
export function hasThemeName(library: ThemeLibrary, name: string) {
  const lower = name.toLowerCase();
  return library.themes.some((theme) => theme.name.toLowerCase() === lower);
}

/** Refuses a name a new user theme cannot take. */
export function checkThemeName(library: ThemeLibrary, name: string) {
  // ",", "=" and ":" make Ghostty parse a light/dark pair (src/config/Config.zig:9788-9790).
  if (
    name === "" ||
    name !== name.trim() ||
    name.startsWith(".") ||
    /[\0\n\r,/:=\\]/.test(name)
  ) {
    throw inputError(`Invalid theme name: ${name}`);
  }
  if (hasThemeName(library, name)) {
    throw inputError(`A theme named ${name} already exists`);
  }
}
