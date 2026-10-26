// Draft edits: the draft an intent makes, after checking that it sets only
// options of the catalog, to values Ghostty can read.
import {inputError} from "./errors";
import {withoutTag} from "./font-settings";
import {type HistoryChange, THEME_KEY} from "./history";
import {draftTheme, pruned, type Sources} from "./resolve";
import {resolveThemePair} from "./theme";
import type {ThemeLibrary} from "./theme-library";
import {type Draft, type Intent, type Values} from "./types";
import {paletteByIndex, paletteIndex} from "./values";

/**
 * Ghostty stops reading a file at a line over 4096 bytes
 * (src/cli/args.zig:1399,1442-1445).
 */
const MAX_VALUE_LENGTH = 512;

const DRAFT_INTENTS = [
  "set",
  "set-many",
  "set-tag",
  "set-flag",
  "reset",
  "theme",
] as const;

/** The intents that edit the draft's values or theme. */
export type DraftIntent = Extract<
  Intent,
  {type: (typeof DRAFT_INTENTS)[number]}
>;

export const isDraftIntent = (intent: Intent): intent is DraftIntent =>
  (DRAFT_INTENTS as readonly string[]).includes(intent.type);

/** A theme setting, a name or a light/dark pair, whose themes exist. */
export function checkTheme(library: ThemeLibrary, theme: string) {
  if (/[\n\r]/.test(theme)) throw inputError("Theme must be a theme name");
  const pair = resolveThemePair(theme);
  if (
    !pair ||
    library.values(pair.light) === undefined ||
    library.values(pair.dark) === undefined
  ) {
    throw inputError(`Unknown theme: ${theme}`);
  }
}

/**
 * The draft `intent` makes from `draft`, and how the change shows in the
 * history. Throws a SessionError for an option the catalog lacks or a value
 * Ghostty cannot read.
 */
export function editDraft(
  sources: Sources,
  draft: Draft,
  intent: DraftIntent,
): {change: HistoryChange; next: Draft} {
  const {catalog} = sources;
  const labelOf = (key: string) => catalog.optionOf.get(key)?.label ?? key;

  /** Values Ghostty can read for `key`. */
  const checkValues = (key: string, values: string[]) => {
    if (!catalog.optionOf.has(key)) throw inputError(`Unknown option: ${key}`);
    if (values.some((value) => /[\n\r]/.test(value))) {
      throw inputError(`Values of ${key} must not contain newlines`);
    }
    if (values.some((value) => value.length > MAX_VALUE_LENGTH)) {
      throw inputError(
        `Values of ${key} must be at most ${MAX_VALUE_LENGTH} characters`,
      );
    }
    if (
      key === "palette" &&
      values.some((value) => paletteIndex(value) === undefined)
    ) {
      throw inputError("Palette entries must be N=COLOR");
    }
  };

  /** The saved list of `key` with the draft's over it. */
  const effectiveValues = (key: string) =>
    draft.values[key] ?? sources.saved[key] ?? [];

  /** Applies updates, then drops those that change nothing once saved. */
  const withValues = (updates: Values): Draft => {
    const values = {...draft.values, ...updates};
    if (updates.palette) {
      values.palette = [
        ...paletteByIndex([
          ...(draft.values.palette ?? []),
          ...updates.palette,
        ]),
      ]
        .toSorted(([a], [b]) => a - b)
        .map(([, entry]) => entry);
    }
    return pruned(sources, {theme: draft.theme, values}, Object.keys(updates));
  };

  switch (intent.type) {
    case "set": {
      const {key, edit} = intent;
      checkValues(key, intent.values);
      const label = intent.label ?? `Set ${labelOf(key)}`;
      return {
        change: {label, key, pick: intent.pick, edit},
        next: withValues({[key]: catalog.normalize(key, intent.values)}),
      };
    }
    case "set-many": {
      const values: Values = {};
      for (const [key, list] of Object.entries(intent.values)) {
        checkValues(key, list);
        values[key] = catalog.normalize(key, list);
      }
      return {change: {label: intent.label}, next: withValues(values)};
    }
    case "set-tag": {
      const {key, tag, value, edit} = intent;
      // Tags come from the font files.
      if (!/^[^\s,="']{4}$/.test(tag)) {
        throw inputError("Tag must be four characters");
      }
      checkValues(key, value === null ? [] : [value]);
      const kept = withoutTag(key, effectiveValues(key), tag);
      const values = value === null ? kept : [...kept, value];
      return {
        change: {label: `${labelOf(key)}: ${tag}`, key: `${key}:${tag}`, edit},
        next: withValues({[key]: values}),
      };
    }
    case "set-flag": {
      const {key, flag, on} = intent;
      // The flag listed last wins over the effective ones.
      const setting = on ? flag : `no-${flag}`;
      const value = [...effectiveValues(key), setting]
        .filter(Boolean)
        .join(",");
      checkValues(key, [value]);
      return {
        change: {label: `${labelOf(key)}: ${setting}`, key: `${key}:${flag}`},
        next: withValues({[key]: catalog.normalize(key, [value])}),
      };
    }
    case "reset": {
      const {key} = intent;
      const index = /^palette:(\d+)$/.exec(key)?.[1];
      if (index === undefined) checkValues(key, []);
      const values = {...draft.values};
      if (index === undefined) {
        delete values[key];
      } else {
        const kept = (values.palette ?? []).filter(
          (value) => paletteIndex(value) !== Number(index),
        );
        if (kept.length > 0) values.palette = kept;
        else delete values.palette;
      }
      return {
        change: {label: `Revert ${labelOf(key)}`},
        next: {theme: draft.theme, values},
      };
    }
    case "theme": {
      if (intent.theme !== null) checkTheme(sources.library, intent.theme);
      const theme = draftTheme(sources, {
        theme: intent.theme,
        values: draft.values,
      });
      const label = theme === null ? "Back to saved theme" : `Theme: ${theme}`;
      return {
        change: {label, key: THEME_KEY, pick: intent.pick},
        next: {theme, values: draft.values},
      };
    }
  }
}
