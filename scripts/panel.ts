#!/usr/bin/env bun
// Drives the panel of a running designer through the WebDriver server that
// development builds embed (the app crate's `webdriver` feature). Each call
// opens a session, runs one command, and closes the session.
//
//   panel.ts --name <sandbox> | --dev | --vm <vm> <command>
//
//   js <body>                  run an async function body in the panel, print any result as JSON
//   click <selector>           click the one visible element that matches with the pointer
//   wait <selector>            wait until one visible element matches
//   fill <selector> <text>     clear the one visible field that matches, then type text
//   key <key>...               press keys in order: Escape, Enter, ArrowDown, Meta+k …
//   drag <selector> <to>       drag the match onto another selector, or by an offset such as -80,0
//   text [selector]            print the visible text of the match, or of the whole panel
//   shot <out.png> [selector]  screenshot the panel, cropped to the match
//
// The target is a sandbox (`--name`), the user's dev instance (`--dev`), or the
// window in a Lima VM (`--vm`). Selectors are CSS, or XPath when they start
// with "/" or "(". Both views stay mounted, so only visible elements count as
// matches. A command waits up to five seconds for its match. The page gets
// synthetic events, so what needs real input is in docs/verify.md. `tour.ts`
// drives the panel through this module too.
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

/** The plugin's port when `TAURI_WEBDRIVER_PORT` is unset, as in `mise run dev`. */
const DEV_PORT = 4445;
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const USAGE =
  "usage: panel.ts --name <sandbox> | --dev | --vm <vm> js <body>|click <selector>|wait <selector>|fill <selector> <text>|key <key>...|drag <selector> <to>|text [selector]|shot <out.png> [selector]";

// WebDriver's codes for named keys. Any other key is its own character.
const KEYS: Record<string, string> = {
  Alt: "",
  ArrowDown: "",
  ArrowLeft: "",
  ArrowRight: "",
  ArrowUp: "",
  Backspace: "",
  Control: "",
  Delete: "",
  End: "",
  Enter: "",
  Escape: "",
  Home: "",
  Meta: "",
  PageDown: "",
  PageUp: "",
  Shift: "",
  Space: " ",
  Tab: "",
};

// Crops a screenshot to an element inside the panel, so the script needs no
// image tools. Arguments: the base64 PNG, the element, the async callback.
const CROP_SCRIPT = `
const [png, element, done] = arguments;
const rect = element.getBoundingClientRect();
const image = new Image();
image.onload = () => {
  const scale = image.naturalWidth / innerWidth;
  const [x, y, width, height] = [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, x, y, width, height, 0, 0, width, height);
  done(canvas.toDataURL("image/png").slice("data:image/png;base64,".length));
};
image.onerror = () => done(null);
image.src = "data:image/png;base64," + png;
`;

// Base UI marks a popup with these attributes while it animates open or
// closed, and a closing popup still takes the pointer. The opening transition
// runs on after its attribute goes. Every command waits for both, and for any
// other animation that ends, so it never acts on, reads or captures a popup
// mid-animation.
const SETTLE_SCRIPT = `
const deadline = Date.now() + 2000;
const moving = () =>
  document.querySelector("[data-starting-style], [data-ending-style]") ||
  document.getAnimations().some(
    (animation) => animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity,
  );
while (moving() && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}`;

// Font faces load once their text renders, such as a font list row scrolled
// into view, so a screenshot waits until three frames pass with none loading.
const FONTS_SCRIPT = `
for (let quiet = 0; quiet < 3; quiet++) {
  await new Promise(requestAnimationFrame);
  if (document.fonts.status === "loading") {
    await document.fonts.ready;
    quiet = -1;
  }
}`;

// WebKit hides the focus ring on script focus after a mouse press, until a key
// press without ⌘, ⌃ or ⌥. Synthetic events never count as either, so the page
// tracks them itself. The focused element is focused again without its ring, as
// after a real press.
const CLICK_FOCUS_SCRIPT = `
if (!window.clickFocus) {
  window.clickFocus = true;
  let afterClick = false;
  addEventListener("pointerdown", () => { afterClick = true }, true);
  addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) afterClick = false;
  }, true);
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    focus.call(this, {focusVisible: !afterClick, ...options});
  };
}
const active = document.activeElement;
if (active instanceof HTMLElement && active !== document.body) {
  active.blur();
  active.focus({preventScroll: true, focusVisible: false});
}`;

class DriveError extends Error {}

type ElementRef = {[ELEMENT_KEY]: string};

const root = path.join(import.meta.dir, "..");

/** Removes `flag <value>` from the arguments and returns the value. */
function takeOption(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return;
  return args.splice(index, 2)[1];
}

/** Removes the target options from the arguments, and finds the target's port. */
function resolveTarget(args: string[]) {
  const dev = args.indexOf("--dev");
  if (dev !== -1) {
    args.splice(dev, 1);
    return {port: DEV_PORT, label: "the dev instance"};
  }

  const vm = takeOption(args, "--vm");
  const name = takeOption(args, "--name");
  if (vm !== undefined) {
    return readPort(`VM ${vm}`, path.join(root, ".cache/vms", vm));
  }
  if (name !== undefined) {
    return sandboxTarget(name);
  }
  throw new DriveError(USAGE);
}

export const sandboxTarget = (name: string) =>
  readPort(`sandbox ${name}`, path.join(root, ".cache/sandboxes", name));

/** Reads the port that the target's runner records in its folder. */
function readPort(label: string, folder: string) {
  const portFile = path.join(folder, "webdriver-port");
  if (!existsSync(portFile)) {
    throw new DriveError(`${label} is not running: ${portFile} is missing`);
  }
  return {port: Number(readFileSync(portFile, "utf8")), label};
}

/** One WebDriver session on the target, closed by `end`. */
export async function startSession(port: number, label: string) {
  const base = `http://127.0.0.1:${port}`;

  async function request(method: string, route: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch(base + route, {
        method,
        headers: {"content-type": "application/json"},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new DriveError(
        `${label} does not answer on port ${port}. Is it running?`,
      );
    }
    const {value} = (await response.json()) as {value: unknown};
    if (typeof value === "object" && value !== null && "error" in value) {
      const {error, message} = value as {error: string; message: string};
      throw new DriveError(`${error}: ${message}`);
    }
    return value;
  }

  const {sessionId} = (await request("POST", "/session", {
    capabilities: {},
  })) as {sessionId: string};
  const session = `/session/${sessionId}`;

  return {
    call: (method: string, route: string, body?: unknown) =>
      request(method, session + route, body),
    end: () => request("DELETE", session),
  };
}

export type Session = Awaited<ReturnType<typeof startSession>>;

/** Finds the one visible match, waiting up to five seconds for it. */
async function find(session: Session, selector: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const matches = (await session.call("POST", "/elements", {
      using: /^[/(]/.test(selector) ? "xpath" : "css selector",
      value: selector,
    })) as ElementRef[];
    const shown = (await session.call("POST", "/execute/sync", {
      script:
        "return arguments[0].map((element) => element.getClientRects().length > 0)",
      args: [matches],
    })) as boolean[];
    const visible = matches.filter((_, index) => shown[index]);
    if (visible.length === 1) return visible[0]!;
    if (Date.now() > deadline) {
      throw new DriveError(
        visible.length === 0
          ? `no visible element matches ${selector}`
          : `${visible.length} visible elements match ${selector}. Narrow the selector`,
      );
    }
    await Bun.sleep(100);
  }
}

/** Runs `body` as an async function and returns its result. */
export async function runScript(session: Session, body: string) {
  const result = (await session.call("POST", "/execute/async", {
    script: `const done = arguments[0];
(async () => {${body}\n})().then(
  (value) => done({value}),
  (error) => done({error: String(error)}),
);`,
    args: [],
  })) as {value?: unknown; error?: string};
  if (result.error !== undefined) throw new DriveError(result.error);
  return result.value;
}

/** Presses each chord, such as `Meta+k`, holding its keys in order. */
async function pressKeys(session: Session, chords: string[]) {
  const actions = chords.flatMap((chord) => {
    const keys = chord.split("+").map((key) => KEYS[key] ?? key);
    return [
      ...keys.map((value) => ({type: "keyDown", value})),
      ...keys.toReversed().map((value) => ({type: "keyUp", value})),
    ];
  });
  await session.call("POST", "/actions", {
    actions: [{type: "key", id: "keyboard", actions}],
  });
  await session.call("DELETE", "/actions");
}

async function movePointer(session: Session, actions: object[]) {
  await session.call("POST", "/actions", {
    actions: [
      {
        type: "pointer",
        id: "mouse",
        parameters: {pointerType: "mouse"},
        actions,
      },
    ],
  });
  await session.call("DELETE", "/actions");
}

/**
 * Scrolls the element only as far as it takes to show it, like a person would,
 * and returns its centre in the viewport. A pointer action that starts from an
 * element centres it in its scroll container first, so pointer actions start
 * from this point instead.
 */
async function scrollIntoView(session: Session, element: ElementRef) {
  return (await session.call("POST", "/execute/sync", {
    script:
      "arguments[0].scrollIntoView({block: 'nearest'}); const r = arguments[0].getBoundingClientRect(); return {x: Math.floor(r.left + r.width / 2), y: Math.floor(r.top + r.height / 2)}",
    args: [element],
  })) as {x: number; y: number};
}

/**
 * Clicks like a mouse in WebKit: focus stays where it was, and only a text
 * field takes it. Then the pointer moves to the window's corner so no hover
 * tooltip opens. WebDriver's element click focuses any element without pointer
 * events, so the panel treats it as keyboard input and shows the focus ring and
 * the tooltip.
 */
async function click(session: Session, selector: string) {
  const element = await find(session, selector);
  const centre = await scrollIntoView(session, element);
  await runScript(session, CLICK_FOCUS_SCRIPT);
  await movePointer(session, [
    {type: "pointerMove", origin: "viewport", ...centre},
    {type: "pointerDown", button: 0},
    {type: "pointerUp", button: 0},
    {type: "pointerMove", origin: "viewport", x: 0, y: 0},
  ]);
  await session.call("POST", "/execute/sync", {
    script:
      "if (arguments[0].matches('input, textarea, [contenteditable]')) arguments[0].focus()",
    args: [element],
  });
}

/** Drags from the match's centre to another match's centre, or by `dx,dy`. */
async function drag(session: Session, selector: string, to: string) {
  const start = await scrollIntoView(session, await find(session, selector));
  const offset = /^(-?\d+),(-?\d+)$/.exec(to);
  const end = offset
    ? {origin: "pointer", x: Number(offset[1]), y: Number(offset[2])}
    : {
        origin: "viewport",
        ...(await scrollIntoView(session, await find(session, to))),
      };
  await movePointer(session, [
    {type: "pointerMove", origin: "viewport", ...start},
    {type: "pointerDown", button: 0},
    {type: "pointerMove", duration: 200, ...end},
    {type: "pointerUp", button: 0},
  ]);
}

async function screenshot(session: Session, out: string, selector?: string) {
  await runScript(session, FONTS_SCRIPT);
  if (selector === undefined) {
    writePng(out, (await session.call("GET", "/screenshot")) as string);
    return;
  }

  const element = await find(session, selector);
  await scrollIntoView(session, element);
  const png = await session.call("GET", "/screenshot");
  const cropped = await session.call("POST", "/execute/async", {
    script: CROP_SCRIPT,
    args: [png, element],
  });
  if (typeof cropped !== "string") {
    throw new DriveError("the panel could not crop the screenshot");
  }
  writePng(out, cropped);
}

function writePng(out: string, png: string) {
  const bytes = Buffer.from(png, "base64");
  writeFileSync(out, bytes);
  // A PNG's width and height are big-endian at bytes 16 and 20.
  console.log(`${out} ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
}

export async function settle(session: Session) {
  await runScript(session, SETTLE_SCRIPT);
}

/** Waits for popups to settle, then runs one command. */
export async function drive(session: Session, command: string, args: string[]) {
  await settle(session);
  await run(session, command, args);
}

// oxlint-disable-next-line complexity -- one switch over the commands, each checking its own arguments
async function run(session: Session, command: string, args: string[]) {
  const [first, second] = args;
  switch (command) {
    case "js": {
      if (first === undefined) break;
      const result = await runScript(session, first);
      if (result !== undefined) console.log(JSON.stringify(result));
      return;
    }
    case "click": {
      if (first === undefined) break;
      await click(session, first);
      return;
    }
    case "wait": {
      if (first === undefined) break;
      await find(session, first);
      return;
    }
    case "fill": {
      if (first === undefined || second === undefined) break;
      const id = (await find(session, first))[ELEMENT_KEY];
      await session.call("POST", `/element/${id}/clear`, {});
      await session.call("POST", `/element/${id}/value`, {text: second});
      return;
    }
    case "drag": {
      if (first === undefined || second === undefined) break;
      await drag(session, first, second);
      return;
    }
    case "key": {
      if (args.length === 0) break;
      await pressKeys(session, args);
      return;
    }
    case "text": {
      const element =
        first === undefined ? undefined : await find(session, first);
      const text = await session.call("POST", "/execute/sync", {
        script: "return (arguments[0] ?? document.body).innerText",
        args: [element ?? null],
      });
      console.log(
        String(text)
          .replaceAll(/\n{3,}/g, "\n\n")
          .trim(),
      );
      return;
    }
    case "shot": {
      if (first === undefined) break;
      await screenshot(session, first, second);
      return;
    }
    default: {
      break;
    }
  }
  throw new DriveError(USAGE);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const {port, label} = resolveTarget(args);
    const [command, ...rest] = args;
    if (command === undefined) throw new DriveError(USAGE);
    const session = await startSession(port, label);
    try {
      await drive(session, command, rest);
    } finally {
      await session.end();
    }
  } catch (error) {
    if (!(error instanceof DriveError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
