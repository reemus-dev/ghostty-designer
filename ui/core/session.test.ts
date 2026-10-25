import {describe, expect, it, setSystemTime} from "bun:test";
import {
  type Appearance,
  type HostMessage,
  PREVIEW_FILE_NAME,
  type ThemeFile,
} from "./bindings";
import {SessionError} from "./errors";
import type {Host} from "./host";
import {startSession} from "./session";
import {DEFAULTS} from "./testing/sources";
import type {Intent, SessionMessage, SessionState} from "./types";

const CONFIG = "/config";
const INCLUDE = `config-file = ?${PREVIEW_FILE_NAME}\n`;
const THEMES = {
  Dark: "background = #111111\nforeground = #eeeeee\n",
  Light: "background = #fafafa\nforeground = #111111\n",
};

type Options = {
  config?: string;
  themes?: Record<string, string>;
  /** Whether Ghostty loads the preview include once the config has it. */
  includeLoads?: boolean;
  persisted?: string | null;
  stash?: string | null;
};

/**
 * A host over one config file that records what the session sends it.
 * `+show-config` reports the file's own lines, and `hold` keeps the next one
 * from answering until it is released.
 */
function fakeHost(options: Options) {
  const original = options.config ?? "font-size = 13\n";
  const includeLoads = options.includeLoads ?? true;
  let file = original;
  let held: {started: () => void; released: Promise<void>} | null = null;
  let failNext = false;
  let system: Appearance = "dark";
  let onMessage: ((message: HostMessage) => void) | undefined;
  const themes: ThemeFile[] = Object.entries(options.themes ?? {}).map(
    ([name, text]) => ({name, source: "bundled", text}),
  );
  const calls = {
    /** Each preview text, "" for a revert. */
    previews: [] as string[],
    states: [] as string[],
    reports: [] as {changes: number; stash: string}[],
  };

  const host: Host = {
    connect(listener) {
      onMessage = listener;
      return Promise.resolve({
        ghostty: {version: "1.3.1", platform: "macos", configPath: CONFIG},
        defaultsWithDocs: DEFAULTS,
        fonts: [],
        instances: 0,
        persisted: options.persisted ?? null,
        stash: options.stash ?? null,
      });
    },
    loadConfig: () =>
      Promise.resolve({
        files: [{path: CONFIG, text: file, utf8: true}],
        preview:
          includeLoads && file.includes(PREVIEW_FILE_NAME) ? "last" : "absent",
        previewClearedBy: null,
        canRestoreOriginal: file !== original,
      }),
    async showConfig() {
      const shown = file;
      if (held) {
        const {started, released} = held;
        held = null;
        started();
        await released;
      }
      if (failNext) {
        failNext = false;
        throw new SessionError("Ghostty did not answer", "internal");
      }
      return shown;
    },
    validateConfig: () => Promise.resolve(""),
    systemAppearance: () => Promise.resolve(system),
    loadThemes: () => Promise.resolve([...themes]),
    writeTheme(name, text) {
      if (themes.some((theme) => theme.name === name)) {
        return Promise.resolve(null);
      }
      themes.push({name, source: "user", text});
      return Promise.resolve({path: `/themes/${name}`});
    },
    previewApply(_id, text) {
      calls.previews.push(text);
      return Promise.resolve();
    },
    previewRevert() {
      calls.previews.push("");
      return Promise.resolve();
    },
    resetFontSize: () => Promise.resolve(true),
    applySave(edits) {
      for (const edit of edits) file = edit.after;
      return Promise.resolve({backupDir: "/backup", files: [CONFIG]});
    },
    restoreOriginal() {
      file = original;
      return Promise.resolve({backupDir: "/backup", files: [CONFIG]});
    },
    writeState(text) {
      calls.states.push(text);
      return Promise.resolve();
    },
    reportDraft(changes, stash) {
      calls.reports.push({changes, stash});
      return Promise.resolve();
    },
    rescanFonts: () => Promise.resolve(),
  };

  return {
    host,
    calls,
    /** Holds the next `+show-config` once it starts, until `release`. */
    hold() {
      const started = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      held = {started: started.resolve, released: released.promise};
      return {started: started.promise, release: released.resolve};
    },
    failNextRead() {
      failNext = true;
    },
    /** Switches the system's appearance, and lets the session follow it. */
    switchAppearance(appearance: Appearance) {
      system = appearance;
      onMessage?.({type: "appearance-changed"});
      return flush();
    },
  };
}

async function setup(options: Options = {}) {
  const fake = fakeHost(options);
  const messages: SessionMessage[] = [];
  const session = await startSession(fake.host, (message) =>
    messages.push(message),
  );
  const state = (): SessionState => {
    const last = messages.findLast((message) => message.type === "state");
    return last?.type === "state" ? last.state : session.snapshot.state;
  };
  const errors = () =>
    messages.flatMap((message) =>
      message.type === "error" ? [message.message] : [],
    );
  const set = (key: string, value: string) =>
    session.intent({type: "set", key, values: [value]});
  const intents = async (...list: Intent[]) => {
    for (const intent of list) await session.intent(intent);
  };
  const save = async (backup = false) => {
    const {id} = await session.planSave();
    return session.save(id, backup);
  };
  return {fake, session, messages, state, errors, set, intents, save};
}

/** Lets every settled call run on. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a write holds later requests until the session reads it back", () => {
  it("applies an intent sent during a save against the saved config", async () => {
    const {fake, session, state, set} = await setup();
    await set("font-size", "20");
    const {id} = await session.planSave();

    const readBack = fake.hold();
    const saving = session.save(id, false);
    const editing = set("font-size", "13");
    await readBack.started;
    await flush();
    readBack.release();
    await Promise.all([saving, editing]);

    expect(state().saved["font-size"]).toEqual(["20"]);
    expect(state().draft.values).toEqual({"font-size": ["13"]});
  });

  it("applies an intent sent during a restore against the restored config", async () => {
    const {fake, session, state, set, save} = await setup();
    await set("font-size", "20");
    await save();

    const readBack = fake.hold();
    const restoring = session.restoreOriginal();
    const editing = set("font-size", "20");
    await readBack.started;
    await flush();
    readBack.release();
    await Promise.all([restoring, editing]);

    expect(state().saved["font-size"]).toEqual(["13"]);
    expect(state().draft.values).toEqual({"font-size": ["20"]});
  });

  it("completes a save whose read-back fails, and reports the failure", async () => {
    const {fake, state, errors, set, save} = await setup();
    await set("font-size", "20");

    fake.failNextRead();
    await save();

    expect(errors()).toEqual(["Ghostty did not answer"]);
    expect(state().draft.values).toEqual({});
  });
});

describe("the draft", () => {
  it("comes back after a reload with its history and the closest theme", async () => {
    const before = await setup({themes: THEMES});
    await before.set("font-size", "20");
    await before.intents({type: "theme", theme: "Dark"});

    const {stash} = before.fake.calls.reports.at(-1)!;
    const {state} = await setup({themes: THEMES, stash});

    expect(state().draft).toEqual(before.state().draft);
    expect(state().history).toEqual(before.state().history);
    expect(state().own.colorMatch).toEqual(before.state().own.colorMatch);
    expect(state().own.colorMatch).not.toBeNull();
  });

  it("undoes and redoes one change at a time", async () => {
    const {state, set, intents} = await setup();
    await set("font-size", "20");
    await set("background", "#000000");

    await intents({type: "undo"});
    expect(state().draft.values).toEqual({"font-size": ["20"]});
    await intents({type: "redo"});
    expect(state().draft.values).toEqual({
      "font-size": ["20"],
      background: ["#000000"],
    });
  });

  it("previews nothing while it is compared with the saved config", async () => {
    const {fake, state, set, intents} = await setup({
      config: `font-size = 13\n${INCLUDE}`,
    });
    await set("font-size", "20");
    expect(fake.calls.previews.at(-1)).toContain("font-size = 20");

    await intents({type: "pause", paused: true});
    expect(fake.calls.previews.at(-1)).toBe("");
    expect(state().apply.state).toBe("paused");

    await intents({type: "pause", paused: false});
    expect(fake.calls.previews.at(-1)).toContain("font-size = 20");
  });

  it("reverts to the system's half of a theme pair", async () => {
    const {state, intents} = await setup({
      config: "theme = light:Light,dark:Dark\n",
      themes: THEMES,
    });
    await intents({type: "appearance", appearance: "light"});
    expect(state().appearance).toBe("light");

    await intents({type: "revert"});
    expect(state().appearance).toBe("dark");
    expect(state().draft.values).toEqual({});
  });
});

describe("the system's appearance", () => {
  it("picks the half of a draft theme pair that Ghostty previews", async () => {
    const {fake, state, intents} = await setup({
      config: INCLUDE,
      themes: THEMES,
    });
    await intents({type: "theme", theme: "light:Light,dark:Dark"});
    expect(fake.calls.previews.at(-1)).toContain("background = #111111");

    await fake.switchAppearance("light");
    expect(state().appearance).toBe("light");
    expect(fake.calls.previews.at(-1)).toContain("background = #fafafa");
  });

  it("keeps a chosen half until the system picks it too", async () => {
    const {fake, state, intents} = await setup({
      config: "theme = light:Light,dark:Dark\n",
      themes: THEMES,
    });
    await intents({type: "appearance", appearance: "light"});
    await fake.switchAppearance("dark");
    expect(state().appearance).toBe("light");

    await fake.switchAppearance("light");
    await fake.switchAppearance("dark");
    expect(state().appearance).toBe("dark");
  });
});

describe("themes", () => {
  it("keeps favourites, the reference theme and saved themes as recent", async () => {
    const {fake, state, intents, save} = await setup({themes: THEMES});
    await intents(
      {type: "favorite", theme: "Light", on: true},
      {type: "reference", theme: "Light"},
      {type: "theme", theme: "Dark"},
    );
    await save();

    expect(state().favorites).toEqual(["Light"]);
    expect(state().reference).toBe("Light");
    expect(state().recentThemes[0]).toBe("Dark");
    expect(JSON.parse(fake.calls.states.at(-1)!)).toEqual({
      favorites: ["Light"],
      recentThemes: state().recentThemes,
      reference: "Light",
    });
  });

  it("backs up the saved colours under a free name for today", async () => {
    setSystemTime(new Date(2026, 9, 21, 12));
    const base = "My colours 2026-10-21";
    const {intents, save} = await setup({
      themes: {...THEMES, [base]: THEMES.Dark},
    });
    await intents({type: "theme", theme: "Light"});

    expect((await save(true)).backupTheme).toBe(`${base} 2`);
    setSystemTime();
  });

  it("refuses a theme name Ghostty cannot load or one that exists", async () => {
    const {session} = await setup({themes: THEMES});
    const refusal = (name: string) =>
      session.saveTheme(name, "own").catch((error: unknown) => error);

    expect(await refusal("a,b")).toMatchObject({kind: "input"});
    expect(await refusal("dark")).toMatchObject({
      kind: "input",
      message: "A theme named dark already exists",
    });
  });
});

it("reports a preview include that does not load, and still publishes", async () => {
  const {session, messages, state} = await setup({includeLoads: false});
  const published = messages.length;

  const refusal = await session
    .intent({type: "install-preview"})
    .catch((error: unknown) => error);

  expect(refusal).toMatchObject({kind: "input"});
  expect(messages.length).toBeGreaterThan(published);
  expect(state().previewInstalled).toBe(false);
});
