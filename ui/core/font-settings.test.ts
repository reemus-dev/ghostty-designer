import {expect, it} from "bun:test";
import {parseFeatures, parseVariations, withoutTag} from "./font-settings";

// Ghostty 1.4.0's own cases, src/font/shaper/feature.zig:291-332.
const KERN_ON = ["kern", "kern on", "+kern", '"kern" = 1', "  kern "];
const KERN_OFF = ["kern off", "-'kern'", '"kern" = 0', "kern    off"];
const AALT_2 = ["aalt=2", "'aalt' 2", "'aalt'\t2"];
const SKIPPED = [
  "aalt=2x",
  "toolong",
  "sht",
  "-kern 1",
  "-kern on",
  "aalt=o",
  "aalt=ofn",
  "",
];

it("reads font-feature entries as Ghostty does", () => {
  for (const entry of KERN_ON) {
    expect([entry, parseFeatures([entry])]).toEqual([
      entry,
      new Map([["kern", true]]),
    ]);
  }
  for (const entry of KERN_OFF) {
    expect([entry, parseFeatures([entry])]).toEqual([
      entry,
      new Map([["kern", false]]),
    ]);
  }
  for (const entry of AALT_2) {
    expect([entry, parseFeatures([entry])]).toEqual([
      entry,
      new Map([["aalt", true]]),
    ]);
  }
  for (const entry of SKIPPED) {
    expect([entry, parseFeatures([entry])]).toEqual([entry, new Map()]);
  }
});

it("reads comma-separated font-feature entries, the last one winning", () => {
  expect(parseFeatures(["kern on , -'kern', last", "+liga"])).toEqual(
    new Map([
      ["kern", false],
      ["last", true],
      ["liga", true],
    ]),
  );
});

it("reads one axis per font-variation value", () => {
  expect(
    parseVariations(["wght=450", " wdth = 87.5 ", "opsz", "slnt=x"]),
  ).toEqual(
    new Map([
      ["wght", 450],
      ["wdth", 87.5],
    ]),
  );
  expect(parseVariations(["wght=450,wdth=100"])).toEqual(new Map());
});

it("drops one tag's entries and keeps every other entry's text", () => {
  expect(
    withoutTag(
      "font-feature",
      ["kern off, +liga", "'kern' 1", "-calt"],
      "kern",
    ),
  ).toEqual(["+liga", "-calt"]);
  expect(
    withoutTag("font-variation", ["wght = 450", "wdth=100"], "wght"),
  ).toEqual(["wdth=100"]);
});
