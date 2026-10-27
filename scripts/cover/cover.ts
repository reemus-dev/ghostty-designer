#!/usr/bin/env bun
// Writes the README cover and the social preview from real windows: Ghostty
// running Claude Code, Ghostty running `ghostty-designer demo`, and the
// designer's Customise and Themes views, all in the look from `ghostty.conf`.
//
//   cover.ts
//
// macOS only, run by hand. It needs cua-driver, Ghostty in /Applications,
// RobotoMono Nerd Font and Claude Code, and it makes one Claude Code request
// on Sonnet. Captures come from the built-in display or BetterDisplay's
// virtual "work" display, never a wide-gamut monitor, and are converted to
// sRGB. `cover.html` lays them out, and stays usable in a browser to adjust
// the layout after a run.
import {copyFileSync, mkdirSync, readFileSync, rmSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {$} from "bun";
import {chromium} from "playwright";
import {drive, sandboxTarget, startSession} from "../panel";

const NAME = "cover";
const BUNDLE_ID = "com.mitchellh.ghostty.cover";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
const CLAUDE_PROMPT =
  "In three sentences, what does this app do? Read README.md first.";
/** Window sizes in points. `cover.html` scales each capture by these widths. */
const SIZES = {
  claude: {width: 820, height: 668},
  demo: {width: 820, height: 818},
  customise: {width: 1100, height: 760},
  themes: {width: 540, height: 930},
};

const root = path.join(import.meta.dir, "../..");
const captures = path.join(root, ".cache/cover");
const copy = path.join(captures, "Ghostty.app");
const ghosttyDir = path.join(root, ".cache/sandboxes", NAME, "xdg/ghostty");
const configPath = path.join(ghosttyDir, "config");
const sandbox = path.join(root, "scripts/sandbox.ts");

type Display = {name: string; x: number; y: number; height: number};
type WindowRef = {pid: number; id: number};
type Size = {width: number; height: number};

async function cua(tool: string, args: object): Promise<unknown> {
  return JSON.parse(await $`cua-driver ${tool} ${JSON.stringify(args)}`.text());
}

/**
 * The built-in or "work" display's area below the menu bar, in the global
 * coordinates cua-driver uses, with the origin at the main display's top left.
 */
async function captureDisplay() {
  const script = `ObjC.import("AppKit");
const screens = ObjC.unwrap($.NSScreen.screens);
const top = screens[0].frame.size.height;
JSON.stringify(screens.map((screen) => {
  const area = screen.visibleFrame;
  return {name: screen.localizedName.js, x: area.origin.x, y: top - area.origin.y - area.size.height, height: area.size.height};
}));`;
  const displays = JSON.parse(
    await $`osascript -l JavaScript -e ${script}`.text(),
  ) as Display[];
  const display = displays.find(
    ({name}) => name.startsWith("Built-in") || name === "work",
  );
  if (display === undefined) {
    throw new Error(
      `no built-in or "work" display among: ${displays.map(({name}) => name).join(", ")}`,
    );
  }
  return display;
}

async function windowOf(pid: number) {
  for (let tries = 0; tries < 50; tries++) {
    const {windows} = (await cua("list_windows", {pid})) as {
      windows: {window_id: number}[];
    };
    if (windows[0] !== undefined) return {pid, id: windows[0].window_id};
    await Bun.sleep(200);
  }
  throw new Error(`process ${pid} opened no window`);
}

/** Moves the window to the display's top left, at `size`. */
async function place(window: WindowRef, size: Size, display: Display) {
  await cua("set_window_frame", {
    pid: window.pid,
    window_id: window.id,
    x: display.x,
    y: display.y,
    ...size,
  });
}

/** The process of the app in front, such as the terminal that runs this. */
async function frontmostApp() {
  const front = (await $`lsappinfo front`.text()).trim();
  const info = await $`lsappinfo info -only pid ${front}`.text();
  const pid = /\bpid\s*=\s*(\d+)/.exec(info)?.[1];
  if (pid === undefined) throw new Error(`no app is in front: ${info}`);
  return Number(pid);
}

async function activate(pid: number) {
  await $`osascript -l JavaScript -e ${`ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(0)`}`.quiet();
}

/**
 * Captures the window alone, without its shadow, once it has looked the same
 * for three seconds, such as Claude Code once it has answered. Then converts it
 * to sRGB. `focus` comes to the front first, so the window draws inactive, with
 * grey traffic lights.
 */
async function capture(window: WindowRef, name: string, focus: number) {
  await activate(focus);
  const file = path.join(captures, `${name}.png`);
  let last: bigint | number | undefined;
  for (let still = 0, tries = 0; still < 3; tries++) {
    if (tries === 180) throw new Error(`the ${name} window never settled`);
    await Bun.sleep(1000);
    await $`screencapture -x -o -l ${window.id} ${file}`;
    const hash = Bun.hash(readFileSync(file));
    still = hash === last ? still + 1 : 0;
    last = hash;
  }
  await $`sips -m ${SRGB} ${file}`.quiet();
}

// ─── Sandbox and Ghostty ───

/** The sandbox with the cover's look, and the panel's window. */
async function startSandbox() {
  await $`${sandbox} --name ${NAME} reset`;
  copyFileSync(path.join(import.meta.dir, "ghostty.conf"), configPath);
  mkdirSync(path.join(ghosttyDir, "themes"));
  // Ghostty names a theme after its file, as the built-in "Catppuccin Mocha".
  copyFileSync(
    path.join(import.meta.dir, "deep-ember"),
    path.join(ghosttyDir, "themes/Deep Ember"),
  );
  await $`${sandbox} --name ${NAME} start`;
  const {port} = sandboxTarget(NAME);
  const pid = await $`lsof -ti tcp:${port} -sTCP:LISTEN`.text();
  return windowOf(Number(pid.trim()));
}

/**
 * Installs a copy of Ghostty under its own bundle ID. Ghostty keeps its
 * preferences and Application Support under its bundle ID, which `HOME` does
 * not move, so the copy keeps the terminals apart from the user's Ghostty.
 */
async function installGhostty() {
  rmSync(copy, {recursive: true, force: true});
  await $`cp -R /Applications/Ghostty.app ${copy}`;
  await $`/usr/libexec/PlistBuddy -c ${`Set :CFBundleIdentifier ${BUNDLE_ID}`} ${path.join(copy, "Contents/Info.plist")}`;
  await $`codesign --force --deep --sign - ${copy}`.quiet();
  // No update check on its first launch.
  await $`defaults write ${BUNDLE_ID} SUEnableAutomaticChecks -bool NO`;
  await $`defaults write ${BUNDLE_ID} SUHasLaunchedBefore -bool YES`;
  await $`${LSREGISTER} -f ${copy}`;
}

/** Quits every process of the copy, then removes it. */
async function removeGhostty() {
  await $`pkill -f ${path.join(copy, "Contents/MacOS/ghostty")}`.nothrow();
  await $`${LSREGISTER} -u ${copy}`.nothrow();
  rmSync(copy, {recursive: true, force: true});
  await $`defaults delete ${BUNDLE_ID}`.quiet().nothrow();
  // cfprefsd writes the emptied domain back to disk.
  rmSync(path.join(homedir(), "Library/Preferences", `${BUNDLE_ID}.plist`), {
    force: true,
  });
}

/** Opens a terminal with the cover's look, as its own Ghostty process. */
async function openTerminal(args: string[]): Promise<WindowRef> {
  const {pid} = (await cua("launch_app", {
    bundle_id: BUNDLE_ID,
    creates_new_application_instance: true,
    additional_arguments: [
      "--config-default-files=false",
      `--config-file=${configPath}`,
      ...args,
    ],
  })) as {pid: number};
  // `launch_app` leaves the process in the background, and it opens no window
  // until it is in front and asked for one.
  await activate(pid);
  await $`open -b ${BUNDLE_ID}`;
  return windowOf(pid);
}

// ─── Capture ───

async function captureWindows(display: Display, focus: number) {
  const panel = await startSandbox();
  await installGhostty();

  const claude = await openTerminal([
    `--working-directory=${root}`,
    // The default mode, so the footer shows none from the user's settings.
    `--command=/bin/bash -lc 'exec claude --model sonnet --permission-mode default "${CLAUDE_PROMPT}"'`,
  ]);
  await place(claude, SIZES.claude, display);

  // `head` keeps the top of the printout, which the window fits. Through a
  // pipe, `demo` needs FORCE_COLOR to print colour.
  const designer = path.join(root, "target/debug/ghostty-designer");
  const demo = await openTerminal([
    "--title=ghostty-designer demo",
    `--command=/bin/sh -c 'FORCE_COLOR=1 ${designer} demo | head -n 31; exec sleep 86400'`,
  ]);
  await place(demo, SIZES.demo, display);

  const session = await startSession(sandboxTarget(NAME).port, NAME);
  try {
    await place(panel, SIZES.customise, display);
    await capture(panel, "customise", focus);
    await drive(session, "click", ['button[aria-label="Themes"]']);
    await place(panel, SIZES.themes, display);
    await capture(panel, "themes", focus);
  } finally {
    await session.end();
  }

  await capture(demo, "demo", focus);
  await capture(claude, "claude", focus);
}

// ─── Render ───

/** Screenshots each stage of `cover.html` at 2×, into `assets/`. */
async function render() {
  await $`${path.join(root, "node_modules/.bin/playwright")} install chromium-headless-shell`.quiet();
  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb"],
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: {width: 1280, height: 936},
    });
    await page.goto(
      pathToFileURL(path.join(import.meta.dir, "cover.html")).href,
    );
    const outputs = [
      ["#readme", path.join(root, "assets/cover.png")],
      ["#social", path.join(root, "assets/social-preview.png")],
    ] as const;
    for (const [stage, file] of outputs) {
      await page.locator(stage).screenshot({path: file, omitBackground: true});
    }
    await $`oxipng -q -o 4 --strip safe ${outputs.map(([, file]) => file)}`;
  } finally {
    await browser.close();
  }
}

const display = await captureDisplay();
const focus = await frontmostApp();
mkdirSync(captures, {recursive: true});
try {
  await captureWindows(display, focus);
} finally {
  await $`${sandbox} --name ${NAME} stop`.nothrow();
  await removeGhostty();
}
await render();
