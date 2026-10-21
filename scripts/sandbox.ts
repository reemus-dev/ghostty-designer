// Runs the designer against a sandbox: its own home, config, state and lock,
// so it never touches the user's config or Ghostty, and parallel runs with
// different names never share a session.
//
//   bun scripts/sandbox.ts run [--dev] [app args]|env|reset [--no-include] [--name <name>]
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {$} from "bun";

/** Removes `--name <name>` from the arguments and returns the name. */
function takeName(args: string[]) {
  const flag = args.indexOf("--name");
  if (flag === -1) return "default";
  const name = args.splice(flag, 2)[1] ?? "";
  if (!/^[\w-]+$/.test(name)) {
    throw new Error("usage: --name <name> with letters, digits, - or _");
  }
  return name;
}

const [command, ...rest] = process.argv.slice(2);
const name = takeName(rest);

const root = path.join(import.meta.dir, "..");
const sandboxDir = path.join(root, ".cache/sandboxes", name);
const home = path.join(sandboxDir, "home");
const xdg = path.join(sandboxDir, "xdg");
const state = path.join(sandboxDir, "state");
const configPath = path.join(xdg, "ghostty/config");
const previewPath = path.join(xdg, "ghostty/ghostty-designer.conf");
const themesPath = path.join(xdg, "ghostty/themes");

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
 * Starts a stand-in target that ignores SIGUSR2, so instance discovery never
 * finds or signals a real Ghostty.
 */
function startStandIn() {
  if (!existsSync(configPath)) reset(true);
  // `exec` keeps the PID and the ignored signal.
  return Bun.spawn(["sh", "-c", "trap '' USR2; exec sleep 2147483647"]);
}

/** The app's environment: target the stand-in, and stay attached. */
const appEnv = (standIn: Bun.Subprocess) => ({
  GHOSTTY_DESIGNER_TARGET_PID: String(standIn.pid),
  GHOSTTY_DESIGNER_ATTACHED: "1",
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
  process.exit(code);
}

/**
 * Builds the Tauri app with the real environment, because a sandbox HOME breaks
 * cargo, rustup and mise, then runs it attached in the sandbox. With `--dev`,
 * `tauri dev` serves the UI with hot reloading, and a cargo runner applies the
 * sandbox environment to the app alone.
 */
async function run(args: string[]) {
  const appArgs = args.filter((arg) => arg !== "--dev");

  if (!args.includes("--dev")) {
    await $`mise run ui:build`.cwd(root);
    await $`cargo build -p ghostty-designer`.cwd(root);
    const standIn = startStandIn();
    await foreground(
      [
        sandboxEnv,
        sandboxDir,
        path.join(root, "target/debug/ghostty-designer"),
        ...appArgs,
      ],
      {...process.env, ...appEnv(standIn)},
      standIn,
    );
    return;
  }

  const host = (await $`rustc --print host-tuple`.text()).trim();
  const standIn = startStandIn();
  const runner = path.join(sandboxDir, "runner.sh");
  const exports = Object.entries(appEnv(standIn))
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

const shellQuote = (value: string) =>
  `'${value.replaceAll("'", String.raw`'\''`)}'`;

const USAGE =
  "usage: sandbox run [--dev] [app args]|env|reset [--no-include] [--name <name>]";

// oxlint-disable-next-line typescript/switch-exhaustiveness-check -- argv is outside input, so the default prints usage
switch (command) {
  case "run": {
    await run(rest);
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
