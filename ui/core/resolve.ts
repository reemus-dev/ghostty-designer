// What Ghostty shows for a draft: a theme's colours under the config's own
// lines, the draft over both, and where each value shows from.
import type {Appearance} from "@/core/bindings";
import type {Catalog} from "./catalog";
import {
  type ConfigFile,
  type Definition,
  definitions,
  lastDefinitions,
} from "./config-file";
import {inputError} from "./errors";
import {renderPreview} from "./preview";
import {resolveThemePair, THEME_COLOR_KEYS} from "./theme";
import type {ThemeLibrary} from "./theme-library";
import type {Draft, Provenance, SaveThemeSource, Values} from "./types";
import {layer, paletteByIndex, paletteIndex, sameValues} from "./values";

/**
 * What Ghostty shows values from besides the draft: the catalog's defaults, the
 * config files, the saved values as `+show-config` reads them, and the theme
 * files.
 */
export type Sources = {
  catalog: Catalog;
  files: ConfigFile[];
  saved: Values;
  library: ThemeLibrary;
};

/**
 * Theme colours, keyed like Values, and where each shows from ("palette:N" for
 * palette entries).
 */
export type ResolvedColors = {values: Values; from: Record<string, Provenance>};

export const savedTheme = ({saved}: Sources) => saved.theme?.[0] ?? null;

/** Both halves of a light/dark pair, whose keys a saved theme may set. */
export function themePairValues(
  library: ThemeLibrary,
  theme: string | null,
): Values {
  const pair = theme === null ? null : resolveThemePair(theme);
  return pair
    ? layer(library.values(pair.light) ?? {}, library.values(pair.dark) ?? {})
    : {};
}

/**
 * The theme colours Ghostty shows once the draft's `theme` is saved (null keeps
 * the saved one), before draft values. Ghostty loads the theme, then replays
 * the config over it (src/config/Config.zig:4462-4482), so the config's own
 * lines win, except those planSave comments out for a draft theme: lines for
 * keys either half of it sets, and `palette = ""` resets. A light/dark pair
 * shows its `half`.
 */
export function colorsAfterSave(
  sources: Sources,
  theme: string | null,
  half: Appearance,
): ResolvedColors {
  const {catalog, files, saved, library} = sources;
  const setting = theme ?? savedTheme(sources);
  const pair = setting === null ? null : resolveThemePair(setting);
  // A saved theme the library lacks, such as one named by its path, shows as
  // +show-config reads it.
  const shown =
    setting === null
      ? {}
      : ((pair && library.values(pair[half])) ?? (theme === null ? saved : {}));
  const commented = themePairValues(library, theme);
  const values: Values = {};
  const from: Record<string, Provenance> = {};

  for (const key of THEME_COLOR_KEYS) {
    const inConfig = definitions(files, key).length > 0;
    if (inConfig && !Object.hasOwn(commented, key)) {
      values[key] = saved[key] ?? [];
      from[key] = "config";
    } else if (Object.hasOwn(shown, key)) {
      values[key] = shown[key]!;
      from[key] = "theme";
    } else {
      values[key] = catalog.colorDefaults[key]!;
      from[key] = "default";
    }
  }

  const palette = paletteAfterSave(sources, shown, commented);
  values.palette = palette.values;
  return {values, from: {...from, ...palette.from}};
}

/**
 * The palette half of colorsAfterSave, from the theme's palette `shown` and the
 * entries planSave comments out, `commented`.
 */
function paletteAfterSave(sources: Sources, shown: Values, commented: Values) {
  const {catalog, files, saved} = sources;
  const config = lastDefinitions(files, "palette");
  const configIndices = new Set(
    config.map((def) => paletteIndex(def.line.value)),
  );
  const commentedPalette = paletteByIndex(commented.palette ?? []);
  // A `palette = ""` reset wipes the theme's palette (src/cli/args.zig:326-338).
  const reset = config[0]?.line.value === "" && commentedPalette.size === 0;
  const savedPalette = paletteByIndex(saved.palette ?? []);
  const themePalette = paletteByIndex(shown.palette ?? []);
  const defaultPalette = paletteByIndex(catalog.colorDefaults.palette!);
  const values: string[] = [];
  const from: Record<string, Provenance> = {};
  for (let i = 0; i < 256; i++) {
    let entry = defaultPalette.get(i);
    let source: Provenance = "default";
    if (configIndices.has(i) && !commentedPalette.has(i)) {
      [entry, source] = [savedPalette.get(i), "config"];
    } else if (!reset && themePalette.has(i)) {
      [entry, source] = [themePalette.get(i), "theme"];
    }
    if (entry) values.push(entry);
    from[`palette:${i}`] = source;
  }
  return {values, from};
}

/**
 * The colours `source` saves as a theme: a theme's own, what shows once the
 * draft is saved, or that without the draft's theme.
 */
export function colorsToSave(
  sources: Sources,
  source: SaveThemeSource,
  draft: Draft,
  half: Appearance,
): Values {
  if (typeof source === "object") {
    const values = sources.library.values(source.theme);
    if (!values) throw inputError(`Unknown theme: ${source.theme}`);
    return layer(sources.catalog.colorDefaults, values);
  }
  const shown = source === "own" ? {theme: null, values: draft.values} : draft;
  return shownAfterSave(sources, shown, half);
}

/** What Ghostty shows once `draft` is saved, a light/dark pair in its `half`. */
export const shownAfterSave = (
  sources: Sources,
  draft: Draft,
  half: Appearance,
) =>
  layer(
    sources.saved,
    colorsAfterSave(sources, draft.theme, half).values,
    draft.values,
  );

/**
 * The theme a draft keeps. The saved theme changes nothing on save unless the
 * config's own lines hide some of it: picking it again then shows all of it,
 * and saving comments those lines out.
 */
export function draftTheme(sources: Sources, draft: Draft) {
  const {files, library} = sources;
  if (draft.theme !== savedTheme(sources)) return draft.theme;
  const values = themePairValues(library, draft.theme);
  return themeConflicts(files, values, draft).length > 0 ? draft.theme : null;
}

/**
 * The draft without what changes nothing once saved: the saved theme while
 * nothing hides it, and values of `keys` that Ghostty shows already. Of a
 * light/dark pair, a value must match both halves, because it saves for both.
 * An empty value resets a scalar to its default (src/cli/args.zig:326-338).
 */
export function pruned(
  sources: Sources,
  next: Draft,
  keys = Object.keys(next.values),
): Draft {
  const {catalog, files, saved, library} = sources;
  const theme = draftTheme(sources, next);
  const pair = theme === null ? null : resolveThemePair(theme);
  // A new theme's other keys apply once saved where the config does not
  // set them, but the preview shows only its colours, so a value changes
  // nothing only if it matches both.
  const halves = (["light", "dark"] as const).flatMap((half) => {
    const colors = colorsAfterSave(sources, theme, half).values;
    const shown = layer(saved, colors);
    const applied = {...shown};
    const settings = (pair && library.values(pair[half])) ?? {};
    for (const [key, list] of Object.entries(settings)) {
      if (!Object.hasOwn(colors, key) && definitions(files, key).length === 0) {
        applied[key] = catalog.normalize(key, list);
      }
    }
    return [shown, applied];
  });
  const palettes = halves.map((half) => paletteByIndex(half.palette ?? []));
  const values = {...next.values};
  for (const key of keys) {
    const list = values[key];
    if (list === undefined) continue;
    if (key === "palette") {
      const kept = list.filter((entry) =>
        palettes.some(
          (palette) =>
            entry.toLowerCase() !==
            palette.get(paletteIndex(entry)!)?.toLowerCase(),
        ),
      );
      if (kept.length > 0) values.palette = kept;
      else delete values.palette;
      continue;
    }
    const shows =
      !catalog.repeatable.has(key) && sameValues(list, [])
        ? catalog.normalize(key, catalog.optionOf.get(key)?.defaults ?? [])
        : list;
    if (halves.every((half) => sameValues(shows, half[key] ?? []))) {
      delete values[key];
    }
  }
  return {theme, values};
}

/**
 * The lines that would hide a draft theme. Any explicit colour line beats a
 * theme (src/config/Config.zig:4462-4465), unless the draft sets that key
 * itself. A `palette = ""` reset would wipe the theme's palette
 * (src/cli/args.zig:326-338), and the lines it disables would come back without
 * it.
 */
export function themeConflicts(
  files: ConfigFile[],
  themeValues: Values,
  draft: Draft,
): Definition[] {
  const conflicts = THEME_COLOR_KEYS.filter(
    (key) =>
      Object.hasOwn(themeValues, key) && !Object.hasOwn(draft.values, key),
  ).flatMap((key) => definitions(files, key));
  const themePalette = paletteByIndex(themeValues.palette ?? []);
  const draftPalette = paletteByIndex(draft.values.palette ?? []);
  const all = themePalette.size > 0 ? definitions(files, "palette") : [];
  const lastReset = all.findLastIndex((def) => def.line.value === "");
  for (const [i, def] of all.entries()) {
    const index = paletteIndex(def.line.value);
    if (
      i <= lastReset ||
      (index !== undefined &&
        themePalette.has(index) &&
        !draftPalette.has(index))
    ) {
      conflicts.push(def);
    }
  }
  return conflicts;
}

/**
 * Draft values beat everything; theme colours show from where `colors` resolved
 * them.
 */
export function provenance(
  {catalog, files}: Sources,
  draft: Draft,
  colors: ResolvedColors,
) {
  const result: Record<string, Provenance> = {};
  for (const {key} of catalog.options) {
    if (key === "palette") continue;
    result[key] = definitions(files, key).length > 0 ? "config" : "default";
  }
  Object.assign(result, colors.from);
  for (const key of Object.keys(draft.values)) {
    if (key !== "palette") result[key] = "draft";
  }
  const draftPalette = paletteByIndex(draft.values.palette ?? []);
  for (const index of draftPalette.keys()) {
    result[`palette:${index}`] = "draft";
  }
  return result;
}

/**
 * What the draft changes, one key per change: "theme", an option key, or
 * "palette:N" for each palette entry.
 */
export function draftKeys(draft: Draft) {
  const keys = draft.theme === null ? [] : ["theme"];
  for (const [key, list] of Object.entries(draft.values)) {
    if (key === "palette") {
      keys.push(...list.map((entry) => `palette:${paletteIndex(entry)}`));
    } else {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The preview of a draft. Without one, Ghostty shows the saved theme in the
 * half the system's appearance picks, so theme colours are written only for a
 * draft theme, or while the user chose the other half of the saved pair: each
 * one the config's own lines do not set already.
 */
export function previewText(
  sources: Sources,
  draft: Draft,
  view: {appearance: Appearance; appearanceChosen: boolean},
) {
  const theme = savedTheme(sources);
  const pair = theme === null ? null : resolveThemePair(theme);
  const halfChosen =
    view.appearanceChosen && pair !== null && pair.light !== pair.dark;
  const colors: Values = {};
  if (halfChosen || draft.theme !== null) {
    const {values, from} = colorsAfterSave(
      sources,
      draft.theme,
      view.appearance,
    );
    for (const key of THEME_COLOR_KEYS) {
      if (from[key] !== "config") colors[key] = values[key]!;
    }
    colors.palette = values.palette!.filter(
      (entry) => from[`palette:${paletteIndex(entry)}`] !== "config",
    );
  }
  return renderPreview({
    themeValues: colors,
    values: draft.values,
    repeatable: sources.catalog.repeatable,
  });
}
