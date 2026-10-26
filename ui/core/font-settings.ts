import type {FontFamily} from "@/core/bindings";
import {trimWhitespace} from "./config-file";
// Ghostty's font-feature and font-variation syntax, read to show the controls'
// state and to replace one tag's entries, and which of a font's features the
// controls offer. Ghostty itself stays the authority on what the values mean.

/** HarfBuzz turns these on unless a font-feature value turns them off. */
const DEFAULT_ON = new Set(["calt", "clig", "liga", "rclt"]);

/** Shaping and positioning features, which are not user choices. */
const BASIC_FEATURES = new Set([
  "aalt",
  "abvm",
  "blwm",
  "ccmp",
  "curs",
  "dist",
  "fina",
  "init",
  "isol",
  "kern",
  "locl",
  "mark",
  "medi",
  "mkmk",
  "rclt",
  "rlig",
  "rvrn",
  "vert",
  "vrt2",
]);

/** The features of `family` that a user can switch. */
export const choosableFeatures = (family: FontFamily) =>
  family.features.filter((tag) => !BASIC_FEATURES.has(tag));

type TagSetting = {tag: string; value: number};

/**
 * One comma-separated font-feature entry as Ghostty reads it, or null when
 * Ghostty skips it (src/font/shaper/feature.zig:36-187): a four-character tag
 * that may be quoted, with a "+" or "-" prefix or else an optional "=" and a
 * number, "on" or "off".
 */
function parseFeature(entry: string): TagSetting | null {
  const text = entry.replace(/^[ \t]+/, "");
  let value: number | null = null;
  let i = 0;
  if (text.startsWith("+") || text.startsWith("-")) {
    value = text.startsWith("+") ? 1 : 0;
    i = 1;
  }

  // Quotes anywhere in the tag are ignored, and whitespace counts.
  let tag = "";
  for (; tag.length < 4; i++) {
    const char = text[i];
    if (char === undefined) return null;
    if (char !== '"' && char !== "'") tag += char;
  }

  const [, gap, setting] = /^([ \t"'=]*)(.*)$/s.exec(text.slice(i))!;
  if (value !== null) {
    return setting || gap!.includes("=") ? null : {tag, value};
  }
  if (!setting) return {tag, value: 1};
  if (/^\d+$/.test(setting)) {
    const number = Number(setting);
    return number <= 0xff_ff_ff_ff ? {tag, value: number} : null;
  }
  const keyword = /^o(n|ff)[ \t]*$/i.exec(setting);
  if (!keyword) return null;
  return {tag, value: keyword[1]!.toLowerCase() === "n" ? 1 : 0};
}

/**
 * A font-variation value as Ghostty reads it, or null when Ghostty rejects it
 * (src/config/Config.zig:6267-6277). Each value sets one axis.
 */
function parseVariation(text: string): TagSetting | null {
  const equals = text.indexOf("=");
  if (equals === -1) return null;
  const tag = trimWhitespace(text.slice(0, equals));
  const number = trimWhitespace(text.slice(equals + 1));
  const value = Number(number);
  return number === "" || tag.length !== 4 || Number.isNaN(value)
    ? null
    : {tag, value};
}

const featureEntries = (values: string[]) =>
  values.flatMap((value) => value.split(","));

/** Font-feature values as tag → on. A later entry wins. */
export function parseFeatures(values: string[]) {
  const features = new Map<string, boolean>();
  for (const entry of featureEntries(values)) {
    const feature = parseFeature(entry);
    if (feature) features.set(feature.tag, feature.value !== 0);
  }
  return features;
}

export const featureOn = (features: Map<string, boolean>, tag: string) =>
  features.get(tag) ?? DEFAULT_ON.has(tag);

/**
 * The font-feature entry that flips one tag, or null when that puts it back at
 * its default.
 */
export function toggledFeature(features: Map<string, boolean>, tag: string) {
  const on = !featureOn(features, tag);
  if (on === DEFAULT_ON.has(tag)) return null;
  return `${on ? "+" : "-"}${tag}`;
}

/** Font-variation values as tag → value. A later value wins. */
export function parseVariations(values: string[]) {
  const axes = new Map<string, number>();
  for (const value of values) {
    const axis = parseVariation(value);
    if (axis) axes.set(axis.tag, axis.value);
  }
  return axes;
}

/**
 * A font-feature or font-variation list without the entries for `tag`. Every
 * other entry keeps its text.
 */
export function withoutTag(key: string, list: string[], tag: string) {
  if (key === "font-variation") {
    return list.filter((value) => parseVariation(value)?.tag !== tag);
  }
  const kept: string[] = [];
  for (const value of list) {
    const entries = value.split(",");
    const rest = entries.filter((entry) => parseFeature(entry)?.tag !== tag);
    if (rest.length === entries.length) {
      kept.push(value);
    } else if (rest.some((entry) => entry.trim() !== "")) {
      kept.push(rest.join(",").trim());
    }
  }
  return kept;
}
