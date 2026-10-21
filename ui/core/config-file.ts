// Ghostty config files as lossless lines, and the lines a key's value comes
// from.

export type EntryLine = {
  kind: "entry";
  text: string;
  key: string;
  /** Unquoted value. null for a bare `key` line without `=`. */
  value: string | null;
};

export type ConfigLine =
  | EntryLine
  | {kind: "blank"; text: string}
  | {kind: "comment"; text: string};

export type ConfigFile = {
  path: string;
  /** A leading UTF-8 byte order mark, kept out of the first line's text. */
  bom: boolean;
  /**
   * False when the text replaced bytes that are not UTF-8, so it cannot be
   * saved.
   */
  utf8: boolean;
  /** Exact line texts without "\n" (a CRLF file keeps its "\r"). */
  lines: ConfigLine[];
  trailingNewline: boolean;
};

export type Definition = {file: ConfigFile; index: number; line: EntryLine};

// ─── Lines ───

/** Trims Ghostty's `whitespace`, spaces and tabs (src/cli/args.zig:19). */
export const trimWhitespace = (text: string) =>
  text.replaceAll(/^[\t ]+|[\t ]+$/g, "");

/**
 * Mirrors Ghostty's LineIterator (src/cli/args.zig:1452-1484): no inline
 * comments.
 */
function parseLine(text: string): ConfigLine {
  const entry = text.replaceAll(/^[\t\r ]+|[\t\r ]+$/g, "");
  if (entry === "") return {kind: "blank", text};
  if (entry.startsWith("#")) return {kind: "comment", text};

  const eq = entry.indexOf("=");
  if (eq === -1) return {kind: "entry", text, key: entry, value: null};

  let value = trimWhitespace(entry.slice(eq + 1));
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return {kind: "entry", text, key: trimWhitespace(entry.slice(0, eq)), value};
}

const BOM = "\u{FEFF}";

export function parseConfig(
  filePath: string,
  content: string,
  utf8 = true,
): ConfigFile {
  // Ghostty skips one leading BOM (src/config/Config.zig:3887-3895).
  const bom = content.startsWith(BOM);
  const body = bom ? content.slice(BOM.length) : content;
  const texts = body.split("\n");
  const trailingNewline = body.endsWith("\n");
  if (trailingNewline || body === "") texts.pop();
  const lines = texts.map(parseLine);
  return {path: filePath, bom, utf8, lines, trailingNewline};
}

/** Joins line texts into the file's content, with its BOM if it had one. */
export function joinLines(file: ConfigFile, texts: string[]) {
  return (file.bom ? BOM : "") + texts.join("\n");
}

export function serializeConfig(file: ConfigFile) {
  const body = joinLines(
    file,
    file.lines.map((line) => line.text),
  );
  return file.trailingNewline ? `${body}\n` : body;
}

/**
 * Quotes a value where Ghostty's trim and quote stripping would change it
 * (src/cli/args.zig:1464-1476), so it reads back as written.
 */
export function quoteValue(value: string) {
  const needed =
    value === "" ||
    value !== trimWhitespace(value) ||
    (value.length >= 2 && value.startsWith('"') && value.endsWith('"'));
  return needed ? `"${value}"` : value;
}

// ─── Definitions ───

/** Every active line for `key`, in load order. */
export function definitions(files: ConfigFile[], key: string): Definition[] {
  const found: Definition[] = [];
  for (const file of files) {
    for (const [index, line] of file.lines.entries()) {
      if (line.kind === "entry" && line.key === key) {
        found.push({file, index, line});
      }
    }
  }
  return found;
}

export function lastDefinition(files: ConfigFile[], key: string) {
  return definitions(files, key).at(-1);
}

/**
 * The lines a repeatable key's effective value comes from: everything from its
 * last empty-value reset on, the reset included (src/cli/args.zig:326-339).
 */
export function lastDefinitions(files: ConfigFile[], key: string) {
  const all = definitions(files, key);
  const reset = all.findLastIndex((def) => def.line.value === "");
  return reset === -1 ? all : all.slice(reset);
}
