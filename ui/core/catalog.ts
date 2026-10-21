import type {Platform} from "@/core/bindings";
import {normalizeHex} from "./color";
import {trimWhitespace} from "./config-file";
import {OPTIONS} from "./options";
import {THEME_COLOR_KEYS} from "./theme";
import type {OptionMeta, Values} from "./types";
import {paletteEntry, paletteIndex} from "./values";

/** The options a draft may set, as the installed Ghostty knows them. */
export type Catalog = {
  options: OptionMeta[];
  optionOf: ReadonlyMap<string, OptionMeta>;
  repeatable: ReadonlySet<string>;
  /** Ghostty's theme colours where neither a theme nor the config sets one. */
  colorDefaults: Values;
  /** Gives values one spelling each, so formatting alone is never a change. */
  normalize: (key: string, list: readonly string[]) => string[];
};

const ALL_PLATFORMS: Platform[] = ["macos", "linux"];
const KEY_VALUE = /^([a-z0-9-]+) = ?(.*)$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const METRIC = /^(.+?)(%?)$/;
/**
 * Enough digits for any value a control sets, few enough to drop float noise
 * such as 10.000000000000009.
 */
const NUMBER_PRECISION = 12;

/**
 * Parses `ghostty +show-config` output: `key = value` lines, each repeatable
 * key on several lines, an empty value as an empty list. With `--docs`, the
 * comment block above a key documents it, and keys that follow without a block
 * of their own (font-family-bold after font-family) share the previous one.
 */
export function parseShowConfig(text: string) {
  const values: Values = {};
  const docs: Record<string, string> = {};
  let block: string[] = [];
  let doc = "";
  let previousWasComment = false;
  let previousKey = "";

  for (const line of text.split("\n")) {
    if (line.startsWith("#")) {
      if (!previousWasComment) {
        block = [];
      }
      block.push(line.replace(/^# ?/, ""));
      previousWasComment = true;
      continue;
    }
    previousWasComment = false;

    const match = KEY_VALUE.exec(line);
    if (!match) {
      continue;
    }
    const [, key, value] = match as unknown as [string, string, string];

    if (block.length > 0) {
      doc = block.join("\n").trimEnd();
      block = [];
    }
    if (key !== previousKey) {
      values[key] ??= [];
      docs[key] = doc;
      previousKey = key;
    }
    if (value !== "") {
      values[key]!.push(value);
    }
  }
  return {values, docs};
}

/**
 * Merges the curated table with the defaults and docs of the installed Ghostty
 * (`ghostty +show-config --default --docs`). Keys that Ghostty does not know
 * are dropped.
 */
export function buildCatalog(defaultsWithDocs: string): Catalog {
  const {values, docs} = parseShowConfig(defaultsWithDocs);
  const options: OptionMeta[] = OPTIONS.flatMap((option) => {
    const defaults = values[option.key];
    if (!defaults) {
      return [];
    }
    return {
      ...option,
      repeatable: option.repeatable ?? false,
      reload: option.reload ?? "live",
      platforms: option.platforms ?? ALL_PLATFORMS,
      doc: docs[option.key] ?? "",
      defaults,
    };
  });
  const optionOf = new Map(options.map((option) => [option.key, option]));
  const normalize = (key: string, list: readonly string[]) => {
    const option = optionOf.get(key);
    return option
      ? list.map((value) => normalizeValue(option, value))
      : [...list];
  };
  const colorDefaults = Object.fromEntries(
    [...THEME_COLOR_KEYS, "palette"].map((key) => [
      key,
      normalize(key, optionOf.get(key)?.defaults ?? []),
    ]),
  );
  const repeatable = new Set(
    options.filter((option) => option.repeatable).map((option) => option.key),
  );
  return {options, optionOf, repeatable, colorDefaults, normalize};
}

/**
 * Values Ghostty reads as a boolean (src/cli/args.zig:654-666), which sets
 * every flag.
 */
const BOOLEANS = new Map([
  ...["1", "t", "T", "true"].map((text) => [text, true] as const),
  ...["0", "f", "F", "false"].map((text) => [text, false] as const),
]);

/**
 * A flags value as Ghostty parses it (src/cli/args.zig:607-652): each line
 * starts from the defaults, each listed flag overrides its default, and the
 * last mention wins. The flags that differ from their default, in Ghostty's
 * order as `name` or `no-name`, or null when Ghostty rejects the value.
 */
function formatFlags(option: OptionMeta, text: string) {
  // The default value lists every flag (src/config/formatter.zig:99-110).
  const defaults = new Map(
    (option.defaults[0] ?? "")
      .split(",")
      .map((part) => [part.replace(/^no-/, ""), !part.startsWith("no-")]),
  );
  const flags = new Map(defaults);
  const all = BOOLEANS.get(text);
  if (all === undefined) {
    for (const raw of text.split(",")) {
      // Ghostty trims only spaces and tabs around each flag
      // (src/cli/args.zig:19, 634-642).
      const part = trimWhitespace(raw);
      const name = part.replace(/^no-/, "");
      if (!flags.has(name)) return null;
      flags.set(name, !part.startsWith("no-"));
    }
  }
  return flags
    .entries()
    .map(([name, on]) => [name, all ?? on] as const)
    .filter(([name, on]) => on !== defaults.get(name))
    .map(([name, on]) => (on ? name : `no-${name}`))
    .toArray()
    .join(",");
}

const formatNumber = (text: string) =>
  String(Number(Number(text).toPrecision(NUMBER_PRECISION)));

/**
 * One spelling per value of an option, so values that differ only in formatting
 * ("15.0" and "15", "#FFF" and "#ffffff") compare equal. Values the option's
 * control does not parse stay as they are, for Ghostty to judge.
 */
function normalizeValue(option: OptionMeta, value: string) {
  const text = value.trim();
  switch (option.control.kind) {
    case "number": {
      return NUMBER.test(text) ? formatNumber(text) : value;
    }
    case "metric": {
      const [, amount = "", percent = ""] = METRIC.exec(text) ?? [];
      return NUMBER.test(amount) ? formatNumber(amount) + percent : value;
    }
    case "color": {
      if (option.key !== "palette") return normalizeHex(text) ?? value;
      const index = paletteIndex(text);
      const hex = normalizeHex(text.slice(text.indexOf("=") + 1));
      return index !== undefined && hex ? paletteEntry(index, hex) : value;
    }
    case "flags": {
      return formatFlags(option, text) ?? value;
    }
    case "bool":
    case "enum":
    case "font-family":
    case "text": {
      return value;
    }
  }
}
