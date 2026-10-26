// Replays the session scenarios in ../scenarios against the session on the
// Rust host and the real Ghostty CLI, and compares each with its recording in
// ../scenarios/recordings. `UPDATE_RECORDINGS=1` rewrites the recordings from
// the run instead. ../scenarios/README.md documents the sandbox, both
// formats, settling and normalisation.
//
// The file name is outside `bun test`'s pattern, so only
// `mise run test:scenarios` runs it.

// oxlint-disable-next-line max-classes-per-file -- Seen and Replay share one replay's state
import {expect, test} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir, userInfo} from "node:os";
import path from "node:path";
import {PREVIEW_FILE_NAME} from "@/core/bindings";
import {parseShowConfig} from "@/core/catalog";
import {SessionError} from "@/core/errors";
import {type Session, startSession} from "@/core/session";
import {
  type Intent,
  type SessionMessage,
  type SessionState,
  type Values,
} from "@/core/types";
import {paletteByIndex} from "@/core/values";
import {startTestHost, type TestHost} from "./host";

// ─── Corpus ───

type Step = (
  | {op: "intent"; intent: Intent}
  | {op: "plan-save"}
  | {op: "save"}
  | {op: "restore-original"}
  | {op: "write-file"; path: string; text: string; append?: boolean}
  | {op: "settle"}
) & {note?: string; expect?: "state"};

type Scenario = {
  description: string;
  setup?: {config?: string; include?: boolean; files?: Files};
  steps: Step[];
};

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type JsonObject = {[key: string]: Json};
type Files = Record<string, string>;
type Recording = {start: JsonObject; steps: JsonObject[]};

/**
 * How a recorded patch holds an object: the keys named here are patched in
 * turn, and the others are replaced whole. A `map` patch lists its changed
 * entries whole, null for a removed one.
 */
type Shape = {[key: string]: Shape | "map"};

const STATE_SHAPE: Shape = {
  saved: "map",
  effective: "map",
  provenance: "map",
  own: {colors: "map"},
};

const GHOSTTY_VERSION = "1.3.1";
const FIXTURES = path.join(
  import.meta.dir,
  `../../../crates/host/tests/fixtures/ghostty-${GHOSTTY_VERSION}`,
);
const SCENARIOS = path.join(import.meta.dir, "../scenarios");
const RECORDINGS = path.join(SCENARIOS, "recordings");
const GHOSTTY =
  process.platform === "darwin"
    ? "/Applications/Ghostty.app/Contents/MacOS/ghostty"
    : (Bun.which("ghostty") ?? "ghostty");
/** Ghostty's default `command`, which differs between machines. */
const SHELL = userInfo().shell;
const INCLUDE_LINE = `config-file = ?${PREVIEW_FILE_NAME}\n`;
const CONFIG = "xdg/ghostty/config";

const QUIET_MS = 800;
const SETTLE_TIMEOUT_MS = 15_000;
const FONTS_TIMEOUT_MS = 60_000;
const SCENARIO_TIMEOUT_MS = 300_000;
/** Recordings print a value on one line when it fits in this many columns. */
const WIDTH = 80;

const update = process.env.UPDATE_RECORDINGS !== undefined;

const names = readdirSync(SCENARIOS)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length))
  .toSorted(compare);

for (const name of names) {
  test.concurrent(
    name,
    async () => {
      const scenario = readJson(path.join(SCENARIOS, `${name}.json`));
      const recordingPath = path.join(RECORDINGS, `${name}.json`);
      const run = await replay(scenario as Scenario);
      if (update) {
        writeFileSync(recordingPath, `${stringify(run)}\n`);
        return;
      }
      expect(run).toEqual(readJson(recordingPath) as Recording);
    },
    {timeout: SCENARIO_TIMEOUT_MS},
  );
}

// ─── Replay ───

/** Replays the scenario in a fresh sandbox and records what the session did. */
async function replay(scenario: Scenario): Promise<Recording> {
  const temp = mkdtempSync(path.join(tmpdir(), "gd-scenario-"));
  const root = realpathSync(temp);
  let host: TestHost | undefined;
  try {
    prepare(root, scenario);
    const started = startTestHost(root, GHOSTTY);
    host = started;
    const seen = new Seen();
    // Ghostty's own defaults, which the recorded values leave out.
    let defaults: Values = {};
    const connect: TestHost["connect"] = async (listener) => {
      const info = await started.connect(listener);
      if (info.ghosttyVersion !== GHOSTTY_VERSION) {
        throw new Error(
          `Ghostty is ${info.ghosttyVersion}, but the recordings need ${GHOSTTY_VERSION}`,
        );
      }
      defaults = parseShowConfig(info.defaultsWithDocs).values;
      return info;
    };
    const session = await startSession({...started, connect}, (message) =>
      seen.observe(message),
    );
    const {state, fonts} = session.snapshot;
    seen.state ??= state;
    seen.fonts ||= fonts !== null;
    return await new Replay(session, seen, root, defaults).run(scenario);
  } finally {
    await host?.close();
    rmSync(root, {recursive: true, force: true});
  }
}

/** What the session's listener delivered so far. */
class Seen {
  /** Messages by type. */
  counts: Record<string, number> = {};
  last = Date.now();
  state: SessionState | undefined;
  /** True once the first font scan is done. */
  fonts = false;
  /** The messages of the session's background errors. */
  errors: string[] = [];

  observe(message: SessionMessage) {
    switch (message.type) {
      case "state": {
        this.state = message.state;
        break;
      }
      case "fonts": {
        this.fonts = true;
        break;
      }
      case "error": {
        this.errors.push(message.message);
        break;
      }
      case "themes":
      case "close-requested":
      case "switch-requested": {
        break;
      }
    }
    this.counts[message.type] = (this.counts[message.type] ?? 0) + 1;
    this.last = Date.now();
  }
}

class Replay {
  private plans: string[] = [];

  constructor(
    private session: Session,
    private seen: Seen,
    private root: string,
    private defaults: Values,
  ) {}

  /** Replays the scenario's steps after the start settles. */
  async run(scenario: Scenario): Promise<Recording> {
    const fontsDeadline = Date.now() + FONTS_TIMEOUT_MS;
    while (!this.seen.fonts) {
      if (Date.now() > fontsDeadline) {
        throw new Error("start: no fonts message");
      }
      await Bun.sleep(20);
    }
    await this.settle("start", {...this.seen.counts});

    let files = snapshot(this.root);
    const start = this.normalize({
      state: normalizeState(this.observeState(), this.defaults),
      apply: this.observeState().apply,
      files,
      errors: this.errorsSince(0),
    }) as JsonObject;
    let state = start.state as JsonObject;

    const steps: JsonObject[] = [];
    for (const [index, step] of scenario.steps.entries()) {
      const label = `step ${index} (${step.op}${step.note ? `: ${step.note}` : ""})`;
      const counts = {...this.seen.counts};
      const errors = this.seen.errors.length;
      let outcome: JsonObject;
      try {
        outcome = {reply: await this.execute(step)};
      } catch (error) {
        // An error's message is wording; its kind is the contract.
        outcome = {
          error: error instanceof SessionError ? error.kind : "internal",
        };
      }
      await this.settle(label, counts, step.expect);

      const next = snapshot(this.root);
      const recorded = this.normalize({
        op: step.op,
        ...outcome,
        apply: this.observeState().apply,
        files: patchOf(files, next, "map"),
        errors: this.errorsSince(errors),
      }) as JsonObject;
      files = next;

      const reply = recorded.reply as JsonObject | null | undefined;
      if (reply?.state !== undefined) {
        const patch = patchOf(state, reply.state as JsonObject, STATE_SHAPE);
        state = reply.state as JsonObject;
        reply.state = patch;
      }
      steps.push(recorded);
    }
    return {start, steps};
  }

  /** Runs a step: resolves with its reply, rejects with the session's error. */
  async execute(step: Step): Promise<Json> {
    switch (step.op) {
      case "intent": {
        await this.session.intent(step.intent);
        return {state: normalizeState(this.observeState(), this.defaults)};
      }
      case "plan-save": {
        const {id, ...plan} = await this.session.planSave();
        this.plans.push(id);
        return {plan: {id: `plan-${this.plans.length}`, ...plan}};
      }
      case "save": {
        const result = await this.session.save(this.plans.at(-1) ?? "", false);
        return {result};
      }
      case "restore-original": {
        await this.session.restoreOriginal();
        return {state: normalizeState(this.observeState(), this.defaults)};
      }
      case "write-file": {
        const file = path.join(this.root, step.path);
        writeFileSync(file, expand(step.text, this.root), {
          flag: step.append ? "a" : "w",
        });
        return null;
      }
      case "settle": {
        return {state: normalizeState(this.observeState(), this.defaults)};
      }
    }
  }

  /**
   * Waits for the `awaited` message since `before`, then for QUIET_MS without
   * any message. Throws when either takes longer than SETTLE_TIMEOUT_MS.
   */
  async settle(
    label: string,
    before: Record<string, number>,
    awaited?: "state",
  ) {
    this.seen.last = Date.now();
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    // oxlint-disable-next-line no-unmodified-loop-condition -- the message listener counts while this sleeps
    while (awaited && this.seen.counts[awaited] === before[awaited]) {
      if (Date.now() > deadline) {
        throw new Error(`${label}: no ${awaited} message`);
      }
      await Bun.sleep(20);
    }
    for (
      let idle = Date.now() - this.seen.last;
      idle < QUIET_MS;
      idle = Date.now() - this.seen.last
    ) {
      if (Date.now() > deadline) {
        throw new Error(`${label}: messages never stopped`);
      }
      await Bun.sleep(QUIET_MS - idle);
    }
  }

  observeState() {
    if (!this.seen.state) throw new Error("No state was published");
    return this.seen.state;
  }

  /** The background errors since the `from`th, or undefined for none. */
  errorsSince(from: number) {
    const errors = this.seen.errors.slice(from);
    return errors.length > 0 ? errors : undefined;
  }

  /**
   * The sandbox root as `<root>`, and the login shell as `<shell>`. A key is a
   * root-relative path, which mirrors a backed up file under its absolute path
   * without the leading slash. Text of several lines becomes its lines, so a
   * recording diff shows the lines that changed. Undefined values are left
   * out.
   */
  normalize(value: unknown): Json {
    if (typeof value === "string") {
      if (value === SHELL) return "<shell>";
      const text = value.replaceAll(this.root, "<root>");
      return text.includes("\n") ? text.split("\n") : text;
    }
    if (Array.isArray(value)) return value.map((item) => this.normalize(item));
    if (isObject(value)) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [
            key.replaceAll(this.root.slice(1), "<root>"),
            this.normalize(item),
          ]),
      );
    }
    return value as Json;
  }
}

// ─── Sandbox ───

/** Writes the scenario's files, then the config into the sandbox root. */
function prepare(root: string, scenario: Scenario) {
  for (const dir of ["home", "tmp", "xdg/ghostty", "state"]) {
    mkdirSync(path.join(root, dir), {recursive: true});
  }
  const put = (relative: string, text: string) =>
    writeFileSync(path.join(root, relative), expand(text, root));
  const setup = scenario.setup ?? {};
  const files = Object.entries(setup.files ?? {});
  for (const [file, text] of files) put(file, text);
  const include = setup.include === false ? "" : INCLUDE_LINE;
  put(CONFIG, (setup.config ?? "<baseline>") + include);
}

/** Scenario text with `<baseline>` and `<root>` expanded. */
function expand(text: string, root: string) {
  const baseline = readFileSync(path.join(FIXTURES, "baseline.conf"), "utf8");
  return text
    .replaceAll("<baseline>", () => baseline)
    .replaceAll("<root>", () => root);
}

/**
 * Every file under the root but `home/` and `tmp/`, keyed by root-relative
 * path.
 */
function snapshot(root: string) {
  const files: Files = {};
  const walk = (dir: string) => {
    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (relative === "home" || relative === "tmp") continue;
      if (entry.isDirectory()) walk(full);
      else files[relative] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return Object.fromEntries(
    Object.entries(files).toSorted(([a], [b]) => compare(a, b)),
  );
}

// ─── Normalisation ───

/** Warnings without the ratio and fix, which colour maths computes. */
const warningTargets = (list: SessionState["warnings"]) =>
  list.map(({ratio: _ratio, fix: _fix, ...warning}) => warning);

/**
 * The state without Ghostty's defaults in `saved` and `effective`, the
 * provenance of keys at their default, and the ratio and fix of readability
 * warnings, which colour maths computes. The apply status settles after a
 * reply, so each step records it separately.
 */
function normalizeState(
  {
    apply: _apply,
    saved,
    effective,
    provenance,
    warnings,
    own,
    ...rest
  }: SessionState,
  defaults: Values,
) {
  return structuredClone({
    ...rest,
    saved: recordedValues(saved, defaults),
    effective: recordedValues(effective, defaults),
    provenance: Object.fromEntries(
      Object.entries(provenance).filter(([, from]) => from !== "default"),
    ),
    warnings: warningTargets(warnings),
    own: {...own, warnings: warningTargets(own.warnings)},
  }) as Json;
}

/** Values without Ghostty's defaults, each palette colour keyed "palette:N". */
function recordedValues({palette = [], ...values}: Values, defaults: Values) {
  const recorded: JsonObject = Object.fromEntries(
    Object.entries(values).filter(
      ([key, list]) => !Bun.deepEquals(list, defaults[key]),
    ),
  );
  const defaultPalette = paletteByIndex(defaults.palette ?? []);
  for (const [index, entry] of paletteByIndex(palette)) {
    if (entry !== defaultPalette.get(index)) {
      recorded[`palette:${index}`] = entry.slice(entry.indexOf("=") + 1);
    }
  }
  return recorded;
}

/** What changed from `prev` to `next`, in the form `shape` gives. */
function patchOf(prev: JsonObject, next: JsonObject, shape: Shape | "map") {
  const patch: JsonObject = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const inner = shape === "map" ? undefined : shape[key];
    if (inner === undefined) {
      if (!Bun.deepEquals(prev[key], next[key])) patch[key] = next[key] ?? null;
      continue;
    }
    const changed = patchOf(
      prev[key] as JsonObject,
      next[key] as JsonObject,
      inner,
    );
    if (Object.keys(changed).length > 0) patch[key] = changed;
  }
  return patch;
}

// ─── Writing ───

/**
 * The recordings' layout: a value on one line when it fits in WIDTH columns
 * after `indent`, otherwise one item or key per line.
 */
function stringify(value: unknown, depth = 0, indent = 0): string {
  const compact = JSON.stringify(value);
  if (typeof value !== "object" || indent + compact.length <= WIDTH) {
    return compact;
  }
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  const entries = Array.isArray(value)
    ? value.map((item) => [pad, item] as const)
    : Object.entries(value as JsonObject).map(
        ([key, item]) => [`${pad}${JSON.stringify(key)}: `, item] as const,
      );
  if (entries.length === 0) return compact;
  const lines = entries.map(
    ([prefix, item]) => prefix + stringify(item, depth + 1, prefix.length),
  );
  const [open, end] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return `${open}\n${lines.join(",\n")}\n${close}${end}`;
}

// ─── Helpers ───

function compare(a: string, b: string) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}
