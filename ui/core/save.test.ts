import {expect, it} from "bun:test";
import {PREVIEW_FILE_NAME} from "@/core/bindings";
import {parseConfig, serializeConfig} from "./config-file";
import {planSave, previewIncludeEdit} from "./save";
import type {Draft, Values} from "./types";

/** Comments, repeatable keys, an include, explicit colours and a theme. */
const FIXTURE = String.raw`# Fonts
font-family = Iosevka
font-size = 16
config-file = ?local

# Keys
keybind = cmd+shift+period=reload_config
# Send a literal Ctrl-A
keybind = ctrl+a=text:\x01

# Colours
background = #121212
foreground = #FAF9F6
cursor-color = #FC7D54
selection-background = #4C3128
palette = 1=#E5534B
palette = 2=#8FBF6F
palette = 4=#6CA0DC
# background = #1E1E1E
theme = "GitHub Dark"
`;
const REPEATABLE = new Set(["font-family", "keybind", "config-file"]);
/** A theme that sets every colour key a theme may set. */
const FULL_THEME: Values = {
  background: ["#282a36"],
  foreground: ["#f8f8f2"],
  "cursor-color": ["#f8f8f2"],
  "cursor-text": ["#282a36"],
  "selection-background": ["#44475a"],
  "selection-foreground": ["#ffffff"],
  palette: Array.from({length: 16}, (_, i) => `${i}=#00000${i.toString(16)}`),
};
const CONFIG = "/home/config";
const INCLUDE = "/home/local";

/** Config files by path, the main config holding the fixture. */
const setup = (files: Record<string, string> = {}) =>
  new Map(Object.entries({[CONFIG]: FIXTURE, ...files}));

/**
 * Plans a save of `draft` against `loaded`, the files that load in Ghostty's
 * order, and writes its edits into `disk`, each over the text it was planned
 * from.
 */
function save(
  disk: Map<string, string>,
  draft: Partial<Draft>,
  {
    themeValues = {},
    loaded = [CONFIG],
    configPath = CONFIG,
  }: {themeValues?: Values; loaded?: string[]; configPath?: string} = {},
) {
  const planned = planSave({
    files: loaded.map((file) => parseConfig(file, disk.get(file)!)),
    configPath,
    draft: {theme: null, values: {}, ...draft},
    themeValues,
    repeatable: REPEATABLE,
  });
  for (const edit of planned.edits) {
    expect(disk.get(edit.path) ?? null).toBe(edit.before);
    disk.set(edit.path, edit.after);
  }
  return planned.plan;
}

it("round-trips files losslessly", () => {
  for (const content of [FIXTURE, "a = 1\r\n# b\r\n", "a = 1\n\n  b=2", ""]) {
    expect(serializeConfig(parseConfig("x", content))).toBe(content);
  }
  const theme = parseConfig("x", FIXTURE).lines.find(
    (line) => line.kind === "entry" && line.key === "theme",
  );
  expect(theme).toMatchObject({value: "GitHub Dark"});
});

it("replaces a scalar in place", () => {
  const disk = setup();
  const plan = save(disk, {values: {"font-size": ["18"]}});

  expect(disk.get(CONFIG)).toBe(
    FIXTURE.replace("font-size = 16\n", "font-size = 18\n"),
  );
  expect(plan.files.map((file) => file.path)).toEqual([CONFIG]);
  expect(plan.files[0]!.diff).toContain("-font-size = 16\n+font-size = 18\n");
});

it("replaces a repeatable run, resetting when earlier lines contribute", () => {
  const disk = setup();
  save(disk, {
    values: {
      "font-family": ["JetBrains Mono", "Symbols Nerd Font"],
      keybind: ["cmd+shift+period=reload_config", "ctrl+b=new_tab"],
    },
  });

  expect(disk.get(CONFIG)).toBe(
    FIXTURE.replace(
      "font-family = Iosevka\n",
      "font-family = JetBrains Mono\nfont-family = Symbols Nerd Font\n",
    ).replace(
      String.raw`keybind = ctrl+a=text:\x01` + "\n",
      'keybind = ""\nkeybind = cmd+shift+period=reload_config\nkeybind = ctrl+b=new_tab\n',
    ),
  );
});

it("replaces palette entries by index", () => {
  const disk = setup();
  save(disk, {values: {palette: ["1=#ff0000", "2=#8fbf6f"]}});

  expect(disk.get(CONFIG)).toBe(
    FIXTURE.replace("palette = 1=#E5534B\n", "palette = 1=#ff0000\n"),
  );
});

it("adds a palette entry after the last palette reset, even in an include", () => {
  const disk = setup({[INCLUDE]: 'palette = ""\npalette = 0=#000000\n'});
  save(disk, {values: {palette: ["5=#ff00ff"]}}, {loaded: [CONFIG, INCLUDE]});

  expect(disk.get(CONFIG)).toBe(FIXTURE);
  expect(disk.get(INCLUDE)).toBe(
    'palette = ""\npalette = 0=#000000\npalette = 5=#ff00ff\n',
  );
});

it("appends new keys to a designer block above the preview include", () => {
  const disk = setup();
  const include = previewIncludeEdit(CONFIG, parseConfig(CONFIG, FIXTURE))!;
  disk.set(CONFIG, include.after);
  const includeLines = `\n# ghostty-designer: live preview, keep below other config-file lines\nconfig-file = ?${PREVIEW_FILE_NAME}\n`;
  expect(include).toEqual({
    path: CONFIG,
    before: FIXTURE,
    after: FIXTURE + includeLines,
  });
  expect(previewIncludeEdit(CONFIG, parseConfig(CONFIG, include.after))).toBe(
    null,
  );

  save(disk, {values: {"cursor-style-blink": ["false"]}});
  save(disk, {values: {"cursor-opacity": ["0.8"]}});

  expect(disk.get(CONFIG)).toBe(
    `${FIXTURE}\n# ghostty-designer: saved settings\ncursor-style-blink = false\ncursor-opacity = 0.8\n${includeLines}`,
  );
});

it("saves a theme and comments out the colour lines that would hide it", () => {
  const disk = setup();
  const plan = save(
    disk,
    {
      theme: "Dracula",
      values: {background: ["#000000"], palette: ["4=#6ca0dc"]},
    },
    {themeValues: FULL_THEME},
  );

  expect(disk.get(CONFIG)).toBe(
    FIXTURE.replace("background = #121212", "background = #000000")
      .replaceAll(
        /^(foreground|cursor-color|selection-background|palette = [12]=).*$/gm,
        "# ghostty-designer: $&",
      )
      .replace('theme = "GitHub Dark"', 'theme = "Dracula"'),
  );
  expect(plan.conflicts.map(({key, line}) => [key, line])).toEqual([
    ["foreground", 13],
    ["cursor-color", 14],
    ["selection-background", 15],
    ["palette", 16],
    ["palette", 17],
  ]);
  expect(plan.conflicts[0]).toEqual({
    key: "foreground",
    path: CONFIG,
    line: 13,
    text: "foreground = #FAF9F6",
  });
});

it("keeps colour lines for keys a partial theme leaves unset", () => {
  const disk = setup();
  save(
    disk,
    {theme: "Partial"},
    {themeValues: {background: ["#000000"], palette: ["1=#ff0000"]}},
  );

  expect(disk.get(CONFIG)).toBe(
    FIXTURE.replace("background = #121212", "# ghostty-designer: $&")
      .replace("palette = 1=#E5534B", "# ghostty-designer: $&")
      .replace('theme = "GitHub Dark"', 'theme = "Partial"'),
  );
});

it("patches the include file that defines a key last", () => {
  const disk = setup({
    [CONFIG]: `${FIXTURE}config-file = ?${PREVIEW_FILE_NAME}\n`,
    [INCLUDE]: "font-size = 17\n",
  });
  const plan = save(
    disk,
    {values: {"font-size": ["18"]}},
    {loaded: [CONFIG, INCLUDE]},
  );

  expect(plan.files.map((file) => file.path)).toEqual([INCLUDE]);
  expect(disk.get(INCLUDE)).toBe("font-size = 18\n");
});

it("creates the main config for keys no file defines", () => {
  const disk = setup();
  const main = "/home/config.ghostty";
  const plan = save(
    disk,
    {values: {"font-size": ["18"], "cursor-opacity": ["0.8"]}},
    {configPath: main},
  );

  expect(plan.files.map((file) => file.path)).toEqual([CONFIG, main]);
  expect(disk.get(main)).toBe(
    "# ghostty-designer: saved settings\ncursor-opacity = 0.8\n",
  );
});
