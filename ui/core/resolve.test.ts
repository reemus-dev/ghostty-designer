import {describe, expect, it} from "bun:test";
import {colorsAfterSave, previewText, provenance, pruned} from "./resolve";
import {sources} from "./testing/sources";

const THEMES = {
  Dark: "background = #111111\nforeground = #eeeeee\npalette = 1=#ff0000\n",
  Light: "background = #fafafa\nforeground = #222222\npalette = 1=#aa0000\n",
};
const PAIR = "light:Light,dark:Dark";

/** The Dark theme under the config's own background and cursor colour. */
const ON_DARK = sources({
  config: "theme = Dark\nbackground = #000000\ncursor-color = #00ff00\n",
  saved: {
    theme: ["Dark"],
    background: ["#000000"],
    foreground: ["#eeeeee"],
    "cursor-color": ["#00ff00"],
    palette: ["0=#1d1f21", "1=#ff0000", "2=#b5bd68"],
  },
  themes: THEMES,
});

describe("colorsAfterSave", () => {
  it("shows the config's own lines over the saved theme", () => {
    const {values, from} = colorsAfterSave(ON_DARK, null, "dark");
    expect(values).toMatchObject({
      background: ["#000000"],
      foreground: ["#eeeeee"],
    });
    expect(values.palette!.slice(0, 3)).toEqual([
      "0=#1d1f21",
      "1=#ff0000",
      "2=#b5bd68",
    ]);
    expect(from).toMatchObject({
      background: "config",
      foreground: "theme",
      "selection-background": "default",
      "palette:0": "default",
      "palette:1": "theme",
    });
  });

  it("shows a new theme over the lines the save comments out for it", () => {
    const {values, from} = colorsAfterSave(ON_DARK, "Light", "dark");
    expect(values).toMatchObject({
      background: ["#fafafa"],
      "cursor-color": ["#00ff00"],
    });
    expect(from).toMatchObject({background: "theme", "cursor-color": "config"});
  });

  it("shows the half of a light/dark pair asked for", () => {
    expect(colorsAfterSave(ON_DARK, PAIR, "light").values.foreground).toEqual([
      "#222222",
    ]);
    expect(colorsAfterSave(ON_DARK, PAIR, "dark").values.foreground).toEqual([
      "#eeeeee",
    ]);
  });

  it('drops the theme palette after `palette = ""`', () => {
    const reset = sources({
      config: 'theme = Dark\npalette = ""\npalette = 2=#123456\n',
      saved: {theme: ["Dark"], palette: ["2=#123456"]},
      themes: THEMES,
    });
    const {values, from} = colorsAfterSave(reset, null, "dark");
    expect(values.palette!.slice(0, 3)).toEqual([
      "0=#1d1f21",
      "1=#cc6666",
      "2=#123456",
    ]);
    expect(from).toMatchObject({"palette:1": "default", "palette:2": "config"});
  });
});

describe("pruned", () => {
  it("drops the saved theme and values Ghostty shows already", () => {
    const draft = {
      theme: "Dark",
      values: {background: ["#000000"], foreground: ["#123456"]},
    };
    expect(pruned(ON_DARK, draft)).toEqual({
      theme: null,
      values: {foreground: ["#123456"]},
    });
  });

  it("keeps a value that only one half of a light/dark pair shows", () => {
    const values = {foreground: ["#eeeeee"]};
    expect(pruned(ON_DARK, {theme: PAIR, values}).values).toEqual(values);
  });

  it("reads an empty scalar value as the default it resets to", () => {
    const draft = {theme: null, values: {"font-size": []}};
    const atDefault = sources({saved: {"font-size": ["13"]}});
    const set = sources({
      config: "font-size = 16\n",
      saved: {"font-size": ["16"]},
    });
    expect(pruned(atDefault, draft).values).toEqual({});
    expect(pruned(set, draft).values).toEqual({"font-size": []});
  });

  it("drops palette entries one at a time, ignoring case", () => {
    const draft = {theme: null, values: {palette: ["1=#FF0000", "2=#00ff00"]}};
    expect(pruned(ON_DARK, draft).values).toEqual({palette: ["2=#00ff00"]});
  });
});

it("tells where each value shows from, the draft first", () => {
  const draft = {
    theme: null,
    values: {
      "font-size": ["15"],
      background: ["#222222"],
      palette: ["2=#00ff00"],
    },
  };
  const colors = colorsAfterSave(ON_DARK, null, "dark");
  expect(provenance(ON_DARK, draft, colors)).toMatchObject({
    background: "draft",
    foreground: "theme",
    "cursor-color": "config",
    "font-size": "draft",
    "font-family": "default",
    "palette:0": "default",
    "palette:1": "theme",
    "palette:2": "draft",
  });
});

describe("previewText", () => {
  const view = {appearance: "dark", appearanceChosen: false} as const;

  it("writes only draft values while the saved theme shows", () => {
    const draft = {theme: null, values: {"font-size": ["15"]}};
    expect(previewText(ON_DARK, draft, view)).toBe("font-size = 15\n");
  });

  it("writes a draft theme's colours except those the config keeps", () => {
    const text = previewText(ON_DARK, {theme: "Light", values: {}}, view);
    expect(text).toContain("background = #fafafa\n");
    expect(text).toContain("palette = 1=#aa0000\n");
    expect(text).not.toContain("cursor-color");
  });

  it("writes the half of the saved pair the user chose", () => {
    const onPair = sources({
      config: `theme = ${PAIR}\n`,
      saved: {theme: [PAIR]},
      themes: THEMES,
    });
    const empty = {theme: null, values: {}};
    const light = {appearance: "light", appearanceChosen: true} as const;
    expect(previewText(onPair, empty, light)).toContain(
      "background = #fafafa\n",
    );
    expect(
      previewText(onPair, empty, {...light, appearanceChosen: false}),
    ).toBe("");
  });
});
