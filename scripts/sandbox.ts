#!/usr/bin/env bun
// Runs the designer against a sandbox: its own home, config, state and lock,
// so it never touches the user's config or Ghostty, and parallel runs with
// different names never share a session.
//
//   sandbox.ts --name <name> run [--dev] [app args]   build, then run in the foreground
//   sandbox.ts --name <name> start [--dev] [app args] the same in the background, until WebDriver answers
//   sandbox.ts --name <name> stop                     quit the running app
//   sandbox.ts --name <name> env                      export lines for other commands
//   sandbox.ts --name <name> reset [--no-include]     baseline config, no preview, themes or state
import {spawn} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {$} from "bun";

const USAGE =
  "usage: sandbox.ts --name <name> run [--dev] [app args]|start [--dev] [app args]|stop|env|reset [--no-include]";

/** Removes `--name <name>` from the arguments and returns the name. */
function takeName(args: string[]) {
  const flag = args.indexOf("--name");
  const name = flag === -1 ? undefined : args.splice(flag, 2)[1];
  if (name === undefined || !/^[\w-]+$/.test(name)) {
    console.error(`${USAGE}\nThe name has letters, digits, - or _.`);
    process.exit(2);
  }
  return name;
}

const input = process.argv.slice(2);
const name = takeName(input);
const [command, ...rest] = input;

const root = path.join(import.meta.dir, "..");
const sandboxDir = path.join(root, ".cache/sandboxes", name);
const home = path.join(sandboxDir, "home");
const xdg = path.join(sandboxDir, "xdg");
const state = path.join(sandboxDir, "state");
const configPath = path.join(xdg, "ghostty/config");
const previewPath = path.join(xdg, "ghostty/ghostty-designer.conf");
const themesPath = path.join(xdg, "ghostty/themes");
// Where `panel.ts` finds the running app's WebDriver port.
const portPath = path.join(sandboxDir, "webdriver-port");
const logPath = path.join(sandboxDir, "run.log");

// Explicit colours and a theme line: the explicit colours beat the theme, so
// a preview must write theme keys explicitly.
const BASELINE = readFileSync(
  path.join(root, "crates/host/tests/fixtures/ghostty-1.3.1/baseline.conf"),
  "utf8",
);
const INCLUDE_LINE = "config-file = ?ghostty-designer.conf\n";

const sandboxEnv = path.join(import.meta.dir, "sandbox-env.sh");

/**
 * Restores the baseline config and clears the preview file, saved themes and
 * designer state.
 */
function reset(include: boolean) {
  mkdirSync(home, {recursive: true});
  mkdirSync(path.dirname(configPath), {recursive: true});
  writeFileSync(configPath, include ? BASELINE + INCLUDE_LINE : BASELINE);
  rmSync(previewPath, {force: true});
  rmSync(themesPath, {recursive: true, force: true});
  rmSync(state, {recursive: true, force: true});
}

/**
 * Starts a stand-in target that ignores SIGUSR2, so the panel sees one running
 * instance and its reload signals reach a process that survives them.
 */
function startStandIn() {
  if (!existsSync(configPath)) reset(true);
  // `exec` keeps the PID and the ignored signal.
  return Bun.spawn(["sh", "-c", "trap '' USR2; exec sleep 2147483647"]);
}

/** Records a free port for the app's WebDriver server, so runs never collide. */
function claimPort() {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {data() {}},
  });
  const {port} = listener;
  listener.stop(true);
  writeFileSync(portPath, String(port));
  return port;
}

/**
 * The app's environment: target the stand-in, stay attached, and serve
 * WebDriver on `port`.
 */
const appEnv = (standIn: Bun.Subprocess, port: number) => ({
  GHOSTTY_DESIGNER_TARGET_PID: String(standIn.pid),
  GHOSTTY_DESIGNER_ATTACHED: "1",
  TAURI_WEBDRIVER_PORT: String(port),
});

/** Runs `argv` in the foreground, forwarding signals, then exits with its code. */
async function foreground(
  argv: string[],
  env: Record<string, string | undefined>,
  standIn: Bun.Subprocess,
) {
  const child = Bun.spawn(argv, {
    cwd: root,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  const code = await child.exited;
  standIn.kill();
  rmSync(portPath, {force: true});
  process.exit(code);
}

/** Whether the sandbox's app runs and its WebDriver server answers. */
async function answers() {
  if (!existsSync(portPath)) return false;
  try {
    await fetch(`http://127.0.0.1:${readFileSync(portPath, "utf8")}/status`);
    return true;
  } catch {
    return false;
  }
}

async function refuseIfRunning() {
  if (!(await answers())) return;
  console.error(
    `sandbox ${name} is already running. Stop it with: sandbox.ts --name ${name} stop`,
  );
  process.exit(1);
}

/**
 * Builds the Tauri app with the real environment, because a sandbox HOME breaks
 * cargo, rustup and mise, then runs it attached in the sandbox. With `--dev`,
 * `tauri dev` serves the UI with hot reloading, and a cargo runner applies the
 * sandbox environment to the app alone.
 */
async function run(args: string[]) {
  await refuseIfRunning();
  const appArgs = args.filter((arg) => arg !== "--dev");

  if (!args.includes("--dev")) {
    await $`mise run ui:build`.cwd(root);
    await $`cargo build -p ghostty-designer --features webdriver`.cwd(root);
    const standIn = startStandIn();
    await foreground(
      [
        sandboxEnv,
        sandboxDir,
        path.join(root, "target/debug/ghostty-designer"),
        ...appArgs,
      ],
      {...process.env, ...appEnv(standIn, claimPort())},
      standIn,
    );
    return;
  }

  const host = (await $`rustc --print host-tuple`.text()).trim();
  const standIn = startStandIn();
  const runner = path.join(sandboxDir, "runner.sh");
  const exports = Object.entries(appEnv(standIn, claimPort()))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
  writeFileSync(
    runner,
    `#!/bin/sh\n${exports}\nexec ${shellQuote(sandboxEnv)} ${shellQuote(sandboxDir)} "$@"\n`,
    {mode: 0o755},
  );
  await foreground(
    [
      path.join(root, "node_modules/.bin/tauri"),
      "dev",
      "--features",
      "webdriver",
      ...(appArgs.length > 0 ? ["--", "--", ...appArgs] : []),
    ],
    {
      ...process.env,
      TAURI_APP_PATH: path.join(root, "crates/app"),
      [`CARGO_TARGET_${host.toUpperCase().replaceAll("-", "_")}_RUNNER`]:
        runner,
    },
    standIn,
  );
}

/**
 * Runs `run` detached with its output in `run.log`, and returns once the app
 * answers.
 */
async function start(args: string[]) {
  await refuseIfRunning();
  mkdirSync(sandboxDir, {recursive: true});
  // A stale port could belong to another app by now.
  rmSync(portPath, {force: true});
  const log = openSync(logPath, "w");
  const child = spawn(
    process.execPath,
    [import.meta.path, "--name", name, "run", ...args],
    {detached: true, stdio: ["ignore", log, log]},
  );
  child.unref();
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  while (!(await answers())) {
    if (exited) {
      const tail = readFileSync(logPath, "utf8").trimEnd().split("\n");
      console.error(
        `sandbox ${name} did not start. The end of ${logPath}:\n${tail.slice(-20).join("\n")}`,
      );
      process.exit(1);
    }
    await Bun.sleep(500);
  }
  console.log(`sandbox ${name} is running, with its output in ${logPath}`);
}

/** Quits the app, which ends its `run`, and waits until `run` has cleaned up. */
async function stop() {
  if (!(await answers())) {
    rmSync(portPath, {force: true});
    console.log(`sandbox ${name} is not running`);
    return;
  }
  const port = readFileSync(portPath, "utf8");
  const pid = await $`lsof -ti tcp:${port} -sTCP:LISTEN`.text();
  process.kill(Number(pid.trim()), "SIGTERM");
  while (existsSync(portPath)) await Bun.sleep(200);
}

const shellQuote = (value: string) =>
  `'${value.replaceAll("'", String.raw`'\''`)}'`;

// oxlint-disable-next-line typescript/switch-exhaustiveness-check -- argv is outside input, so the default prints usage
switch (command) {
  case "run": {
    await run(rest);
    break;
  }
  case "start": {
    await start(rest);
    break;
  }
  case "stop": {
    await stop();
    break;
  }
  case "env": {
    await $`${sandboxEnv} ${sandboxDir}`;
    console.log("export GHOSTTY_DESIGNER_TARGET_PID=''");
    break;
  }
  case "reset": {
    reset(!rest.includes("--no-include"));
    break;
  }
  default: {
    console.error(USAGE);
    process.exit(2);
  }
}
