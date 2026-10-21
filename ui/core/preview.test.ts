import {describe, expect, it} from "bun:test";
import {PreviewCalls, renderPreview} from "./preview";
import type {ApplyStatus} from "./types";

const theme = {
  background: ["#191724"],
  foreground: ["#e0def4"],
  palette: ["0=#26233a", "1=#eb6f92"],
};
const repeatable = new Set(["font-family", "font-feature", "palette"]);

it("writes the theme's keys explicitly", () => {
  expect(renderPreview({themeValues: theme, values: {}, repeatable})).toBe(
    [
      "background = #191724",
      "foreground = #e0def4",
      "palette = 0=#26233a",
      "palette = 1=#eb6f92",
      "",
    ].join("\n"),
  );
});

it("resets repeatable keys before their values", () => {
  const values = {
    "font-family": ["JetBrains Mono", "Symbols Nerd Font"],
    "font-feature": [],
  };
  expect(renderPreview({themeValues: {}, values, repeatable})).toBe(
    [
      'font-family = ""',
      "font-family = JetBrains Mono",
      "font-family = Symbols Nerd Font",
      'font-feature = ""',
      "",
    ].join("\n"),
  );
});

it("writes palette entries by index without resetting the palette", () => {
  const values = {palette: ["4=#31748f"]};
  expect(renderPreview({themeValues: {}, values, repeatable})).toBe(
    "palette = 4=#31748f\n",
  );
});

it("lets draft values override theme values", () => {
  const values = {background: ["#3a3a3a"], palette: ["01=#ff0000"]};
  expect(renderPreview({themeValues: theme, values, repeatable})).toBe(
    [
      "background = #3a3a3a",
      "foreground = #e0def4",
      "palette = 0=#26233a",
      "palette = 01=#ff0000",
      "",
    ].join("\n"),
  );
});

/** Preview calls the test answers by hand, and the statuses shown. */
function setup() {
  const shown: ApplyStatus[] = [];
  const calls = new PreviewCalls((status) => {
    shown.push(status);
  });
  const schedule = () => {
    const call = Promise.withResolvers<void>();
    let id = "";
    calls.schedule("text", (sent) => {
      id = sent;
      return call.promise;
    });
    return {...call, id};
  };
  return {calls, shown, schedule};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PreviewCalls", () => {
  const APPLIED: ApplyStatus = {state: "applied"};

  it("shows a status that arrives before its call answers", () => {
    const {calls, shown, schedule} = setup();
    const {id} = schedule();
    calls.status(id, APPLIED);
    expect(shown).toEqual([APPLIED]);
  });

  it("shows statuses only for the latest call's id", () => {
    const {calls, shown, schedule} = setup();
    const first = schedule();
    const second = schedule();
    calls.status(first.id, {state: "error", error: "older"});
    calls.status(second.id, APPLIED);
    expect(shown).toEqual([APPLIED]);
  });

  it("ignores the failure of a call a later one replaced", async () => {
    const {shown, schedule} = setup();
    const first = schedule();
    schedule();
    first.reject(new Error("replaced"));
    await flush();
    expect(shown).toEqual([]);
  });

  it("shows a failed call as an error", async () => {
    const {shown, schedule} = setup();
    schedule().reject(new Error("no preview file"));
    await flush();
    expect(shown).toEqual([{state: "error", error: "no preview file"}]);
  });
});
