import {describe, expect, it} from "bun:test";
import {type DraftIntent, editDraft} from "./edits";
import {SessionError} from "./errors";
import {CATALOG, sources} from "./testing/sources";
import type {Draft} from "./types";

const EMPTY: Draft = {theme: null, values: {}};
const FLAGS = "shell-integration-features";

const SAVED = sources({
  config: "theme = Dark\nbackground = #000000\n",
  saved: {
    theme: ["Dark"],
    background: ["#000000"],
    [FLAGS]: CATALOG.normalize(FLAGS, ["cursor,no-sudo,title"]),
  },
  themes: {Dark: "background = #111111\n", Light: "background = #fafafa\n"},
});

const next = (intent: DraftIntent, draft = EMPTY) =>
  editDraft(SAVED, draft, intent).next;

describe("editDraft", () => {
  it("sets values in one spelling, and drops those Ghostty shows already", () => {
    const intent = {
      type: "set",
      key: "background",
      values: ["#ABC"],
    } satisfies DraftIntent;
    expect(next(intent).values).toEqual({background: ["#aabbcc"]});
    expect(next({...intent, values: ["#000"]}).values).toEqual({});
  });

  it("merges palette entries by index", () => {
    const draft = {theme: null, values: {palette: ["2=#00ff00"]}};
    const intent = {
      type: "set",
      key: "palette",
      values: ["0=#010101"],
    } satisfies DraftIntent;
    expect(next(intent, draft).values.palette).toEqual([
      "0=#010101",
      "2=#00ff00",
    ]);
  });

  it("replaces only the entries of one font feature tag", () => {
    const draft = {theme: null, values: {"font-feature": ["-calt", "ss01"]}};
    const intent = {
      type: "set-tag",
      key: "font-feature",
      tag: "calt",
      value: "+calt",
    } as const;
    expect(next(intent, draft).values["font-feature"]).toEqual([
      "ss01",
      "+calt",
    ]);
  });

  it("sets a flag over the effective ones, and drops it back at its default", () => {
    const on = next({type: "set-flag", key: FLAGS, flag: "sudo", on: true});
    expect(on.values).toEqual({[FLAGS]: ["sudo"]});
    const off = {
      type: "set-flag",
      key: FLAGS,
      flag: "sudo",
      on: false,
    } as const;
    expect(next(off, on).values).toEqual({});
  });

  it("resets a key or one palette entry", () => {
    const draft = {
      theme: null,
      values: {background: ["#aabbcc"], palette: ["1=#010101", "2=#020202"]},
    };
    expect(next({type: "reset", key: "palette:1"}, draft).values).toEqual({
      background: ["#aabbcc"],
      palette: ["2=#020202"],
    });
    expect(next({type: "reset", key: "background"}, draft).values).toEqual({
      palette: ["1=#010101", "2=#020202"],
    });
  });

  it("picks a theme, and the saved one only while config lines hide it", () => {
    expect(next({type: "theme", theme: "Light"}).theme).toBe("Light");
    expect(next({type: "theme", theme: "Dark"}).theme).toBe("Dark");
    const own = {theme: "Light", values: {background: ["#222222"]}};
    expect(next({type: "theme", theme: "Dark"}, own).theme).toBe(null);
  });

  it.each<[string, DraftIntent]>([
    [
      "an option the catalog lacks",
      {type: "set", key: "config-file", values: ["/x"]},
    ],
    ["a reset of one", {type: "reset", key: "config-file"}],
    [
      "one among others",
      {
        type: "set-many",
        values: {background: ["#000"], "config-file": ["/x"]},
        label: "x",
      },
    ],
    ["a newline", {type: "set", key: "font-family", values: ["a\nb"]}],
    [
      "a flag with a newline",
      {type: "set-flag", key: FLAGS, flag: "sudo\nx", on: true},
    ],
    [
      "a palette entry without an index",
      {type: "set", key: "palette", values: ["#000000"]},
    ],
    [
      "a tag that is not four characters",
      {type: "set-tag", key: "font-feature", tag: "kern1", value: null},
    ],
    ["an unknown theme", {type: "theme", theme: "Missing"}],
    [
      "a pair with an unknown half",
      {type: "theme", theme: "light:Light,dark:Missing"},
    ],
  ])("refuses %s", (_, intent) => {
    expect(() => next(intent)).toThrow(SessionError);
  });
});
