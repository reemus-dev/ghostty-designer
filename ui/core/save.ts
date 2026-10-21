// Save plans: the edits that save a draft into the config files, with their
// diffs, the include line that turns on live preview, and user theme files.
import {PREVIEW_FILE_NAME, type SaveEdit} from "@/core/bindings";
import {
  type ConfigFile,
  type ConfigLine,
  type Definition,
  definitions,
  type EntryLine,
  joinLines,
  lastDefinition,
  lastDefinitions,
  parseConfig,
  quoteValue,
  serializeConfig,
} from "./config-file";
import {inputError} from "./errors";
import {THEME_COLOR_KEYS} from "./theme";
import type {Draft, SaveConflict, SavePlan, Values} from "./types";
import {paletteByIndex, paletteIndex} from "./values";

const CONFLICT_PREFIX = "# ghostty-designer: ";
const SAVE_BLOCK_HEADER = "# ghostty-designer: saved settings";
const PREVIEW_INCLUDE_COMMENT =
  "# ghostty-designer: live preview, keep below other config-file lines";
const PREVIEW_INCLUDE_VALUE = `?${PREVIEW_FILE_NAME}`;
/** What `previewIncludeEdit` adds at the end of the config. */
export const PREVIEW_INCLUDE_LINES = [
  PREVIEW_INCLUDE_COMMENT,
  `config-file = ${PREVIEW_INCLUDE_VALUE}`,
];
const DIFF_CONTEXT = 3;

type SaveInput = {
  /** The config files that load, in Ghostty's order. */
  files: ConfigFile[];
  /** The main config that receives keys defined nowhere yet. */
  configPath: string;
  /**
   * What the save changes, all of which it writes: a theme other than the saved
   * one, and values that change what Ghostty shows once it is saved.
   */
  draft: Draft;
  /** The keys the draft theme sets, from both halves of a light/dark pair. */
  themeValues: Values;
  repeatable: ReadonlySet<string>;
};

/**
 * A plan without its id, which the session assigns per review, and the edits it
 * applies.
 */
export type PlannedSave = {plan: Omit<SavePlan, "id">; edits: SaveEdit[]};

// ─── Plan ───

export function planSave(input: SaveInput): PlannedSave {
  const {files, configPath, draft, themeValues, repeatable} = input;
  const replacements = new Map<ConfigFile, Map<number, string[]>>();
  const insertions = new Map<ConfigFile, Map<number, string[]>>();
  const appended: string[] = [];
  const conflicts: SaveConflict[] = [];

  const replace = (file: ConfigFile, index: number, texts: string[]) => {
    const lines = replacements.get(file) ?? new Map<number, string[]>();
    replacements.set(file, lines.set(index, texts));
  };
  const insertAfter = ({file, index}: Definition, text: string) => {
    const lines = insertions.get(file) ?? new Map<number, string[]>();
    const at = lines.get(index + 1) ?? [];
    insertions.set(file, lines.set(index + 1, [...at, text]));
  };

  /** A line that already sets the value stays as written. */
  const setScalar = (key: string, value: string) => {
    const def = lastDefinition(files, key);
    if (!def) {
      appended.push(formatEntry(key, value));
    } else if (def.line.value !== value) {
      replace(def.file, def.index, [formatEntry(key, value, def.line)]);
    }
  };

  const setRepeatable = (key: string, values: string[]) => {
    const all = definitions(files, key);
    const last = all.at(-1);
    if (!last) {
      appended.push(
        ...(values.length > 0 ? values : [""]).map((value) =>
          formatEntry(key, value),
        ),
      );
      return;
    }

    // The run is the adjacent lines for this key that end at the last one.
    const {file} = last;
    let start = last.index;
    while (start > 0 && isEntryFor(file.lines[start - 1], key)) start--;
    const first = file.lines[start] as EntryLine;
    const earlier = all.some((def) => def.file !== file || def.index < start);
    // Repeatable options default to empty, so a reset only keeps earlier lines out.
    const reset = values.length === 0 || earlier;

    const texts = values.map((value) => formatEntry(key, value, last.line));
    if (reset) texts.unshift(formatEntry(key, "", first));
    replace(file, start, texts);
    for (let i = start + 1; i <= last.index; i++) replace(file, i, []);
  };

  const palette = lastDefinitions(files, "palette");
  /** Palette entries override by index, so only that index's line changes. */
  const setPaletteEntry = (index: number, entry: string) => {
    const def = palette.findLast((d) => paletteIndex(d.line.value) === index);
    const last = palette.at(-1);
    if (def) {
      if (paletteColor(def.line.value) !== paletteColor(entry)) {
        replace(def.file, def.index, [formatEntry("palette", entry, def.line)]);
      }
    } else if (last) {
      // After the last `palette = ""` reset, which may sit in an include.
      insertAfter(last, formatEntry("palette", entry));
    } else {
      appended.push(formatEntry("palette", entry));
    }
  };

  const comment = (def: Definition) => {
    replace(def.file, def.index, [CONFLICT_PREFIX + def.line.text]);
    conflicts.push({
      key: def.line.key,
      path: def.file.path,
      line: def.index + 1,
      text: def.line.text,
    });
  };

  const themeChanged = draft.theme !== null;
  if (themeChanged) setScalar("theme", draft.theme!);
  let replacesColors = themeChanged;
  const colorKeys = new Set<string>(THEME_COLOR_KEYS);

  for (const [key, values] of Object.entries(draft.values)) {
    if (key === "palette") continue;
    if (colorKeys.has(key)) replacesColors = true;
    if (repeatable.has(key)) setRepeatable(key, values);
    else setScalar(key, values.at(-1) ?? "");
  }

  for (const [index, entry] of paletteByIndex(draft.values.palette ?? [])) {
    if (index < 16) replacesColors = true;
    setPaletteEntry(index, entry);
  }

  if (themeChanged) {
    for (const def of themeConflicts(files, themeValues, draft)) comment(def);
  }

  const changes = new Map<ConfigFile, LineEdit[]>();
  for (const [lines, remove] of [
    [replacements, 1],
    [insertions, 0],
  ] as const) {
    for (const [file, byLine] of lines) {
      changes.set(file, [
        ...(changes.get(file) ?? []),
        ...[...byLine].map(([start, insert]) => ({start, remove, insert})),
      ]);
    }
  }
  if (appended.length > 0) {
    const file =
      files.find((loaded) => loaded.path === configPath) ??
      parseConfig(configPath, "");
    changes.set(file, [
      ...(changes.get(file) ?? []),
      appendLines(file, appended),
    ]);
  }

  const {edits, diffs} = fileEdits(changes, files);
  return {
    plan: {
      files: diffs,
      conflicts,
      themeSettings: themeChanged
        ? themeSettings(themeValues, draft, files)
        : [],
      replacesColors,
    },
    edits,
  };
}

/**
 * The lines that would hide a new theme. Any explicit colour line beats a theme
 * (src/config/Config.zig:4462-4465), unless the draft sets that key itself. A
 * `palette = ""` reset would wipe the theme's palette
 * (src/cli/args.zig:326-338), and the lines it disables would come back without
 * it.
 */
function themeConflicts(
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
 * Settings of a new theme besides its colours. Ghostty applies every key of a
 * theme file (src/config/Config.zig:4413-4418) where the config does not set
 * it, but the preview shows only colours.
 */
function themeSettings(themeValues: Values, draft: Draft, files: ConfigFile[]) {
  const colorKeys = new Set<string>(THEME_COLOR_KEYS);
  return Object.entries(themeValues)
    .filter(
      ([key]) =>
        key !== "palette" &&
        !colorKeys.has(key) &&
        !Object.hasOwn(draft.values, key) &&
        definitions(files, key).length === 0,
    )
    .flatMap(([key, values]) => values.map((value) => ({key, value})));
}

/** Each changed file's new text, and its diff for review. */
function fileEdits(changes: Map<ConfigFile, LineEdit[]>, files: ConfigFile[]) {
  const edits: SaveEdit[] = [];
  const diffs: SavePlan["files"] = [];
  for (const [file, fileChanges] of changes) {
    const isNew = !files.includes(file);
    // A text edit would turn bytes that are not UTF-8 into U+FFFD.
    if (!file.utf8) {
      throw inputError(
        `${file.path} is not valid UTF-8, so it cannot be saved`,
      );
    }
    const {after, diff} = patch(file, fileChanges, isNew);
    edits.push({
      path: file.path,
      before: isNew ? null : serializeConfig(file),
      after,
    });
    diffs.push({path: file.path, diff});
  }
  return {edits, diffs};
}

const isEntryFor = (line: ConfigLine | undefined, key: string) =>
  line?.kind === "entry" && line.key === key;

const isPreviewInclude = (line: ConfigLine) =>
  line.kind === "entry" &&
  line.key === "config-file" &&
  line.value === PREVIEW_INCLUDE_VALUE;

const paletteColor = (entry: string | null | undefined) =>
  entry
    ?.slice(entry.indexOf("=") + 1)
    .trim()
    .toLowerCase();

/**
 * Formats `key = value`, keeping the spacing and quoting of the line it
 * replaces.
 */
function formatEntry(key: string, value: string, like?: EntryLine) {
  const quoted = quoteValue(value);
  if (typeof like?.value !== "string") return `${key} = ${quoted}`;

  const [, prefix = "", raw = "", suffix = ""] =
    /^([^=]*=[\t ]*)(.*?)([\t\r ]*)$/.exec(like.text) ?? [];
  // An empty value needs its quotes, so they say nothing about the style.
  const wasQuoted =
    like.value !== "" &&
    raw.length >= 2 &&
    raw.startsWith('"') &&
    raw.endsWith('"');
  return prefix + (wasQuoted ? `"${value}"` : quoted) + suffix;
}

/**
 * New keys go into the main config's `# ghostty-designer` block, created before
 * the preview include so that stays the last line.
 */
function appendLines(file: ConfigFile, entries: string[]): LineEdit {
  const {lines} = file;
  const header = lines.findIndex(
    (line) => line.text.trim() === SAVE_BLOCK_HEADER,
  );
  if (header !== -1) {
    let start = header + 1;
    while (lines[start]?.kind === "entry") start++;
    return {start, remove: 0, insert: entries};
  }

  const include = lines.findLastIndex(isPreviewInclude);
  let start = lines.length;
  if (include !== -1) {
    start =
      lines[include - 1]?.text === PREVIEW_INCLUDE_COMMENT
        ? include - 1
        : include;
  }
  const insert = [SAVE_BLOCK_HEADER, ...entries];
  if (start > 0 && lines[start - 1]!.kind !== "blank") insert.unshift("");
  if (start < lines.length) insert.push("");
  return {start, remove: 0, insert};
}

// ─── Diff ───

type LineEdit = {start: number; remove: number; insert: string[]};

/** Applies line changes and renders them as a unified diff. */
function patch(file: ConfigFile, changes: LineEdit[], isNew: boolean) {
  const old = file.lines.map((line) => line.text);
  const appendsAtEnd = changes.some((change) => change.start === old.length);
  // Adjacent changes merge so the diff groups their lines. An insertion sorts
  // before a replacement of the line it precedes.
  const ordered = changes.toSorted(
    (a, b) => a.start - b.start || a.remove - b.remove,
  );
  const sorted: LineEdit[] = [];
  for (const change of ordered) {
    const previous = sorted.at(-1);
    if (previous && previous.start + previous.remove === change.start) {
      previous.remove += change.remove;
      previous.insert = [...previous.insert, ...change.insert];
    } else {
      sorted.push({...change});
    }
  }

  const lines: string[] = [];
  let pos = 0;
  for (const change of sorted) {
    lines.push(...old.slice(pos, change.start), ...change.insert);
    pos = change.start + change.remove;
  }
  lines.push(...old.slice(pos));
  const endsWithNewline = file.trailingNewline || appendsAtEnd;
  const after =
    joinLines(file, lines) + (endsWithNewline && lines.length > 0 ? "\n" : "");

  const diff = [`--- ${isNew ? "/dev/null" : file.path}`, `+++ ${file.path}`];
  let offset = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1]!.start - (sorted[j]!.start + sorted[j]!.remove) <=
        2 * DIFF_CONTEXT
    ) {
      j++;
    }

    const from = Math.max(0, sorted[i]!.start - DIFF_CONTEXT);
    const to = Math.min(
      old.length,
      sorted[j]!.start + sorted[j]!.remove + DIFF_CONTEXT,
    );
    const body: string[] = [];
    let at = from;
    let delta = 0;
    const group = sorted.slice(i, j + 1);
    for (const change of group) {
      for (; at < change.start; at++) body.push(` ${old[at]}`);
      for (; at < change.start + change.remove; at++) body.push(`-${old[at]}`);
      body.push(...change.insert.map((text) => `+${text}`));
      delta += change.insert.length - change.remove;
    }
    for (; at < to; at++) body.push(` ${old[at]}`);

    const oldCount = to - from;
    const newCount = oldCount + delta;
    const oldStart = oldCount === 0 ? from : from + 1;
    const newStart = newCount === 0 ? from + offset : from + offset + 1;
    diff.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...body,
    );
    offset += delta;
    i = j + 1;
  }
  return {after, diff: `${diff.join("\n")}\n`};
}

// ─── Include and themes ───

/**
 * The edit that adds the preview include at the end of the main config, `file`
 * when it exists, or null when one loads from it already.
 */
export function previewIncludeEdit(
  configPath: string,
  existing: ConfigFile | undefined,
): SaveEdit | null {
  const file = existing ?? parseConfig(configPath, "");
  const {lines} = file;
  // An empty `config-file` drops the includes before it (src/config/path.zig:362-366).
  const reset = lines.findLastIndex(
    (line) =>
      line.kind === "entry" && line.key === "config-file" && line.value === "",
  );
  if (lines.slice(reset + 1).some(isPreviewInclude)) return null;

  const texts = lines.map((line) => line.text);
  if (lines.length > 0 && lines.at(-1)!.kind !== "blank") texts.push("");
  texts.push(...PREVIEW_INCLUDE_LINES);
  return {
    path: configPath,
    before: existing ? serializeConfig(existing) : null,
    after: `${joinLines(file, texts)}\n`,
  };
}

/**
 * A user theme file of `colors`: palette 0-15, the higher entries that differ
 * from Ghostty's `defaultPalette`, and the other theme colours.
 */
export function themeText(colors: Values, defaultPalette: readonly string[]) {
  const defaults = paletteByIndex(defaultPalette);
  const palette = [...paletteByIndex(colors.palette ?? [])]
    .filter(
      ([index, entry]) =>
        index < 16 || paletteColor(entry) !== paletteColor(defaults.get(index)),
    )
    .toSorted(([a], [b]) => a - b)
    .map(([, entry]) => `palette = ${entry}`);
  const lines = [...palette];
  for (const key of THEME_COLOR_KEYS) {
    const value = colors[key]?.at(-1);
    if (value) lines.push(`${key} = ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
