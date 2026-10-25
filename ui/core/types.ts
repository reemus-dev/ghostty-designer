// The session's contract with the views: they render SessionState and send
// Intents.
import type {
  Appearance,
  FontFamily,
  GhosttyInfo,
  Platform,
  PreviewStatus,
  ThemeSource,
} from "@/core/bindings";

/**
 * Ghostty's string-at-rest model: each key maps to its ordered values.
 * Repeatable keys hold several values. Palette entries are "N=#rrggbb".
 */
export type Values = Record<string, string[]>;

/** When a change becomes visible in already-open windows. */
export type Reload = "live" | "new-surface" | "new-window" | "special";

export type OptionGroup =
  | "colors"
  | "palette"
  | "fonts"
  | "font-metrics"
  | "cursor"
  | "window"
  | "splits"
  | "background";

export type Control =
  | {kind: "color"; keywords?: string[]}
  | {kind: "number"; min?: number; max?: number; step?: number; unit?: string}
  | {kind: "metric"}
  /** An empty value unsets the key, which can differ from every other value. */
  | {kind: "enum"; values: string[]}
  | {kind: "bool"}
  | {kind: "font-family"}
  | {kind: "text"}
  /**
   * Ghostty's comma-separated feature flags. Values list the flags that differ
   * from Ghostty's default, in its order, each as `name` or `no-name`. Change
   * one with `set-flag`.
   */
  | {kind: "flags"};

export type OptionMeta = {
  key: string;
  group: OptionGroup;
  label: string;
  /** Doc comment from the installed Ghostty. */
  doc: string;
  /** Default values from the installed Ghostty. */
  defaults: string[];
  repeatable: boolean;
  control: Control;
  reload: Reload;
  reloadNote?: string;
  platforms: Platform[];
};

export type ThemeColors = {
  background: string;
  foreground: string;
  /**
   * Index 0-15 always, and higher indices up to the highest one set, with
   * Ghostty's defaults for those not set.
   */
  palette: string[];
  cursorColor?: string;
  cursorText?: string;
  selectionBackground?: string;
  selectionForeground?: string;
};

export type ThemeSummary = {
  name: string;
  source: ThemeSource;
  colors: ThemeColors;
  dark: boolean;
  /** Dominant accent hue in OKLCH degrees, null for greyscale themes. */
  hue: number | null;
  /**
   * Text colours that miss their target, as in SessionState.warnings. Empty
   * when the theme reads well.
   */
  warnings: ReadabilityWarning[];
  /**
   * The weakest text colour's contrast over its target, for sorting: under 1
   * exactly when `warnings` is not empty.
   */
  readability: number;
};

export type Draft = {
  /**
   * Theme as written in config: "Name" or "light:A,dark:B". null keeps the
   * saved theme.
   */
  theme: string | null;
  /** Explicit values that override the saved config. */
  values: Values;
};

export type Provenance = "default" | "theme" | "config" | "draft";

/** The preview's status, or `paused` while Ghostty shows the saved config. */
export type ApplyStatus = Omit<PreviewStatus, "state"> & {
  state: PreviewStatus["state"] | "paused";
};

/** The theme the effective colours are, or are closest to. */
export type ColorMatch = {
  theme: string;
  /** True when all 22 theme colours are equal. */
  exact: boolean;
};

/** A text colour that misses its WCAG 2 contrast target against the background. */
export type ReadabilityWarning = {
  /** "foreground", or "palette" with `slot`. */
  key: string;
  slot?: number;
  ratio: number;
  target: number;
  /** The nearest colour that reaches the target, changing only OKLCH lightness. */
  fix: string;
};

export type HistoryEntry = {label: string};

export type SessionState = {
  /**
   * The saved config as Ghostty shows it, a light/dark theme pair in its
   * `appearance` half.
   */
  saved: Values;
  draft: Draft;
  /** What Ghostty shows once the draft is saved, as the preview shows it now. */
  effective: Values;
  /** Keyed by option key, and "palette:N" for palette entries. */
  provenance: Record<string, Provenance>;
  /** Number of changed keys (palette entries count individually). */
  changes: number;
  history: {undo: HistoryEntry[]; redo: HistoryEntry[]};
  apply: ApplyStatus;
  /** True once the preview include line is in the user's config. */
  previewInstalled: boolean;
  /**
   * True when a config file loads after the preview file, so its keys beat the
   * draft.
   */
  previewShadowed: boolean;
  /** Half of a light/dark theme pair that `saved` and `effective` show. */
  appearance: Appearance;
  /** The theme setting Ghostty shows once the draft is saved, or null. */
  themeSetting: string | null;
  /**
   * `themeSetting` as its light and dark names (the same for one theme). null
   * without one or when malformed.
   */
  themePair: {light: string; dark: string} | null;
  favorites: string[];
  /** Themes a later change or a save kept, most recent first. */
  recentThemes: string[];
  /** The theme pinned to line up under the user's own colours. */
  reference: string | null;
  /**
   * The user's choice to preview live. It shows in Ghostty only with
   * `previewInstalled`.
   */
  livePreview: boolean;
  /** True when a backup of the pre-designer config exists. */
  canRestoreOriginal: boolean;
  /** Running Ghostty instances the preview reloads. */
  instances: number;
  /** Matched against the theme library. null when there are no themes. */
  colorMatch: ColorMatch | null;
  /**
   * Foreground (target 4.5) and ANSI 1-6 and 8 (target 3) against the
   * background.
   */
  warnings: ReadabilityWarning[];
  /**
   * The user's own colours with their unsaved changes: what shows without a
   * draft theme.
   */
  own: {
    colors: ThemeColors;
    warnings: ReadabilityWarning[];
    colorMatch: ColorMatch | null;
  };
};

/** What the panel renders. The session's messages keep it current. */
export type Snapshot = {
  ghostty: GhosttyInfo;
  options: OptionMeta[];
  /** Ghostty's colours where neither a theme nor the config sets one. */
  colorDefaults: Values;
  themes: ThemeSummary[];
  /** Null while the font scan runs. A "fonts" message follows. */
  fonts: FontFamily[] | null;
  state: SessionState;
};

export type Intent =
  /**
   * `pick` marks a pick from a list, as with `theme`. `edit` names an edit: one
   * focus of a field or slider. Its sets of one key make one undo step, and
   * none when they return to where they began.
   */
  | {
      type: "set";
      key: string;
      values: string[];
      label?: string;
      pick?: boolean;
      edit?: string;
    }
  | {type: "set-many"; values: Values; label: string}
  | {type: "reset"; key: string}
  /**
   * Replaces one OpenType tag's entries in a font-feature or font-variation*
   * list, keeping every other entry as written. null removes the tag's
   * entries.
   */
  | {
      type: "set-tag";
      key: string;
      tag: string;
      value: string | null;
      edit?: string;
    }
  /**
   * Turns one flag of a `flags` option on or off, keeping the other effective
   * flags.
   */
  | {type: "set-flag"; key: string; flag: string; on: boolean}
  /**
   * `pick` marks a pick from a list. Picks one after another make one undo
   * step, and none when they return to where they began.
   */
  | {type: "theme"; theme: string | null; pick?: boolean}
  | {type: "undo"}
  | {type: "redo"}
  | {type: "revert"}
  | {type: "appearance"; appearance: Appearance}
  | {type: "pause"; paused: boolean}
  /** Turns live preview on or off, and remembers the choice. */
  | {type: "live-preview"; on: boolean}
  | {type: "install-preview"}
  | {type: "favorite"; theme: string; on: boolean}
  /** Pins a theme to line up under the user's own colours, or unpins with null. */
  | {type: "reference"; theme: string | null}
  /** Scans the installed fonts again. A "fonts" message follows. */
  | {type: "rescan-fonts"};

export type SaveConflict = {
  key: string;
  path: string;
  line: number;
  text: string;
};

export type SavePlan = {
  /** Identifies this review: a save applies only the plan last reviewed. */
  id: string;
  files: {path: string; diff: string}[];
  /**
   * Explicit colour lines and `palette = ""` resets that would hide the saved
   * theme. Save comments them out.
   */
  conflicts: SaveConflict[];
  /**
   * Settings besides colours that the new theme file sets and the config does
   * not. Ghostty applies them on save; the preview shows only colours.
   */
  themeSettings: {key: string; value: string}[];
  /**
   * True when saving changes the saved colours, so the sheet offers a backup
   * theme.
   */
  replacesColors: boolean;
};

/**
 * The colours "Save as theme" saves: those the draft shows ("shown"), the
 * user's own without a draft theme ("own"), or a theme's own.
 */
export type SaveThemeSource = "shown" | "own" | {theme: string};

export type SaveResult = {
  backupDir: string;
  files: string[];
  /** The user theme the saved colours were backed up as, when asked. */
  backupTheme: string | null;
};

/**
 * What the session tells the panel besides what its calls return. `state`
 * follows every change, `fonts` each font scan, and `error` a background
 * failure, such as a config read after an outside edit.
 */
export type SessionMessage =
  | {type: "state"; state: SessionState}
  | {type: "fonts"; fonts: FontFamily[]}
  | {type: "themes"; themes: ThemeSummary[]}
  | {type: "error"; message: string}
  | {type: "close-requested"};
