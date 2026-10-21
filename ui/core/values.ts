// Ghostty's semantics for values: palette entries by index, layering, what
// makes two lists set the same thing, font fallbacks and metric syntax.
import {trimWhitespace} from "./config-file";
import type {SessionState, Values} from "./types";

/**
 * Palette entry index, parsed as Ghostty's `parseInt(u8, key, 0)` does
 * (src/config/Config.zig:5818-5822).
 */
export function paletteIndex(entry: string | null) {
  const eq = entry?.indexOf("=") ?? -1;
  if (eq === -1) return;
  return parseU8(trimWhitespace(entry!.slice(0, eq)));
}

/** The palette entry that sets slot `index` to `color`. */
export const paletteEntry = (index: number, color: string) =>
  `${index}=${color}`;

const RADIX: Record<string, number> = {b: 2, o: 8, x: 16};

/**
 * Zig's `std.fmt.parseInt(u8, text, 0)` (lib/std/fmt.zig, Zig 0.15.2): a sign,
 * a 0b/0o/0x prefix in either case, and `_` between digits.
 */
function parseU8(text: string) {
  const negative = text.startsWith("-");
  const unsigned = /^[+-]/.test(text) ? text.slice(1) : text;
  const prefix = /^0([box])./i.exec(unsigned)?.[1]?.toLowerCase();
  const radix = prefix === undefined ? 10 : RADIX[prefix]!;
  const digits = prefix === undefined ? unsigned : unsigned.slice(2);
  if (digits === "" || digits.startsWith("_") || digits.endsWith("_")) return;

  let value = 0;
  for (const char of digits.replaceAll("_", "")) {
    const digit = Number.parseInt(char, radix);
    if (Number.isNaN(digit)) return;
    value = value * radix + digit;
    if (value > 255) return;
  }
  // An unsigned type takes a negative only as zero.
  return negative && value !== 0 ? undefined : value;
}

/** Values that set each colour, keyed by option key or "palette:N". */
export function colorValues(colors: Iterable<readonly [string, string]>) {
  const values: Values = {};
  for (const [key, color] of colors) {
    const index = /^palette:(\d+)$/.exec(key)?.[1];
    if (index === undefined) values[key] = [color];
    else (values.palette ??= []).push(paletteEntry(Number(index), color));
  }
  return values;
}

/**
 * Palette entries by index. A later entry for an index wins, in the first one's
 * place.
 */
export function paletteByIndex(entries: readonly string[]) {
  const byIndex = new Map<number, string>();
  for (const entry of entries) {
    const index = paletteIndex(entry);
    if (index !== undefined) byIndex.set(index, entry);
  }
  return byIndex;
}

/**
 * Later layers win: palette entries override by index, other keys replace the
 * list.
 */
export function layer(...layers: Values[]): Values {
  const result: Values = {};
  for (const values of layers) {
    for (const [key, list] of Object.entries(values)) {
      result[key] =
        key === "palette"
          ? paletteByIndex([...(result.palette ?? []), ...list])
              .values()
              .toArray()
          : list;
    }
  }
  return result;
}

/**
 * True when two lists set the same thing. An empty value resets a repeatable
 * key and unsets a scalar (src/cli/args.zig:326-339), so only what follows the
 * last one counts.
 */
export function sameValues(a: readonly string[], b: readonly string[]) {
  const [x, y] = [
    a.slice(a.lastIndexOf("") + 1),
    b.slice(b.lastIndexOf("") + 1),
  ];
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

/**
 * Font-family with `name` first and the fallbacks Ghostty shows, or the saved
 * ones while it shows its default font, which has none.
 */
export function withPrimary(state: SessionState, name: string) {
  const shown = state.effective["font-family"] ?? [];
  const base = shown.length > 0 ? shown : (state.saved["font-family"] ?? []);
  return [name, ...base.slice(1).filter((item) => item !== name)];
}

/**
 * A typed adjust-* metric as Ghostty's value, or null when Ghostty rejects it:
 * whole pixels, or a percentage with decimals (src/font/Metrics.zig, parse). A
 * bare number is in `unit`; empty text unsets the key.
 */
export function parseMetric(text: string, unit: "%" | "px") {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(%|px)?$/.exec(trimmed);
  if (!match) return null;
  const [, amount, suffix = unit] = match;
  if (suffix === "%") return `${amount}%`;
  return Number.isSafeInteger(Number(amount)) ? String(Number(amount)) : null;
}
