#!/usr/bin/env bun
// Walks the panel through its main stops in a fresh sandbox and screenshots
// each one, for a visual audit of the whole UI.
//
//   tour.ts
//
// Writes `.cache/tour/`: a PNG per stop, and `index.html` with a map of how the
// stops connect, then every screenshot in tour order. From a terminal, it opens
// the page in the browser. The sandbox starts from
// the baseline config, so runs on one machine match. The font list and theme
// catalog come from the machine. Native parts, such as the window frame, menus
// and the close dialog, are out of reach (docs/verify.md).
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {$} from "bun";
import {
  drive,
  runScript,
  sandboxTarget,
  type Session,
  settle,
  startSession,
} from "./panel";

type Action = [command: string, ...args: string[]];

type Stop = {
  /** The file name and map node. */
  id: string;
  title: string;
  /** The stop this one starts from: the tour must be there. */
  from?: string;
  /** What the user does to get here, for the map. */
  via?: string;
  steps: Action[];
  /** Escape closes the stop after the screenshot, back at `from`. */
  popup?: true;
};

const NAME = "tour";
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"]';
const MORE_ACTIONS: Action = ["click", '[aria-label="More actions"]'];

const STOPS: Stop[] = [
  {
    id: "setup",
    title: "Live preview setup",
    steps: [["wait", "#setup-title"]],
  },
  {
    id: "colours",
    title: "Customise: colours",
    from: "setup",
    via: "Enable live preview",
    steps: [
      ["click", '//button[.="Enable live preview"]'],
      ["wait", '[aria-label="Sections"]'],
    ],
  },
  {
    id: "live-status",
    title: "Live status",
    from: "colours",
    via: "Click the status",
    steps: [
      ["click", '//button[contains(., "Live in")]'],
      ["wait", '[role="dialog"]'],
    ],
    popup: true,
  },
  {
    id: "palette",
    title: "Command palette",
    from: "colours",
    via: "⌘K",
    steps: [
      ["key", "Meta+k"],
      ["wait", '[aria-label="Command palette"]'],
    ],
    popup: true,
  },
  {
    id: "font",
    title: "Customise: font",
    from: "colours",
    via: "Font in the rail",
    steps: [["click", '[aria-label="Font"]']],
  },
  {
    id: "window",
    title: "Customise: window and cursor",
    from: "font",
    via: "Window & cursor in the rail",
    steps: [["click", '[aria-label="Window & cursor"]']],
  },
  {
    id: "themes",
    title: "Themes",
    from: "window",
    via: "⌥2",
    steps: [["key", "Alt+2"]],
  },
  {
    id: "theme-chosen",
    title: "Themes: a theme chosen",
    from: "themes",
    via: "Click a theme",
    steps: [
      ["click", '[data-theme="12-bit Rainbow"]'],
      ["wait", '//button[contains(., "1 unsaved change")]'],
    ],
  },
  {
    id: "changes",
    title: "Unsaved changes",
    from: "theme-chosen",
    via: "Click the change count",
    steps: [
      ["click", '//button[contains(., "unsaved change")]'],
      ["wait", '[role="dialog"]'],
    ],
    popup: true,
  },
  {
    id: "save",
    title: "Save",
    from: "theme-chosen",
    via: "⌘S",
    steps: [
      ["key", "Meta+s"],
      ["wait", '[role="dialog"]'],
    ],
    popup: true,
  },
  {
    id: "save-theme",
    title: "Save as theme",
    from: "theme-chosen",
    via: "Save as theme…",
    steps: [
      ["click", '//button[.="Save as theme…"]'],
      ["wait", '[aria-label="Theme name"]'],
    ],
    popup: true,
  },
  {
    id: "more-actions",
    title: "More actions",
    from: "theme-chosen",
    via: "···",
    steps: [MORE_ACTIONS, ["wait", '[role="menu"]']],
    popup: true,
  },
  {
    id: "restore",
    title: "Restore original config",
    from: "theme-chosen",
    via: "··· → Restore original config…",
    steps: [
      MORE_ACTIONS,
      ["click", '//*[@role="menuitem"][contains(., "Restore original")]'],
      ["wait", '[role="alertdialog"]'],
    ],
    popup: true,
  },
  {
    id: "switch-config",
    title: "Switch config",
    from: "theme-chosen",
    via: "··· → Switch config…",
    steps: [
      MORE_ACTIONS,
      ["click", '//*[@role="menuitem"][contains(., "Switch config")]'],
      ["wait", '[role="dialog"]'],
    ],
    popup: true,
  },
];

const root = path.join(import.meta.dir, "..");
const out = path.join(root, ".cache/tour");
const page = path.join(out, "index.html");
const sandbox = path.join(import.meta.dir, "sandbox.ts");

/**
 * Presses Escape until no popup is open. A tooltip that opened as focus moved
 * into the popup takes the first press.
 */
async function closePopups(session: Session) {
  for (let presses = 0; ; presses++) {
    await settle(session);
    const open = `return document.querySelector('${POPUPS}') !== null`;
    if ((await runScript(session, open)) !== true) return;
    if (presses === 3) throw new Error("a popup stays open after Escape");
    await drive(session, "key", ["Escape"]);
  }
}

async function walk(session: Session) {
  const files: string[] = [];
  let at: string | undefined;
  for (const [index, stop] of STOPS.entries()) {
    if (stop.from !== at) {
      throw new Error(
        `stop ${stop.id} starts from ${stop.from}, but the tour is at ${at}`,
      );
    }
    for (const [command, ...args] of stop.steps) {
      await drive(session, command, args);
    }
    const file = `${String(index + 1).padStart(2, "0")}-${stop.id}.png`;
    await drive(session, "shot", [path.join(out, file)]);
    files.push(file);
    if (stop.popup) await closePopups(session);
    at = stop.popup ? stop.from : stop.id;
  }
  return files;
}

const html = Bun.escapeHTML;

/**
 * The stops reached from `from`, as nested lists that link to their
 * screenshots.
 */
function map(from?: string): string {
  const items = STOPS.filter((stop) => stop.from === from).map((stop) => {
    const via = stop.via === undefined ? "" : `${html(stop.via)} → `;
    const link = `<a href="#${stop.id}">${html(stop.title)}</a>`;
    return `<li>${via}${link}${map(stop.id)}</li>`;
  });
  return items.length === 0 ? "" : `<ul>${items.join("")}</ul>`;
}

/** The map of the stops, then each screenshot. */
function indexPage(files: string[]) {
  const shots = STOPS.map(
    (stop, i) =>
      `<h2 id="${stop.id}">${i + 1}. ${html(stop.title)}</h2>\n` +
      `<img src="${files[i]}" alt="${html(stop.title)}">`,
  );
  return `<!doctype html>
<meta charset="utf-8">
<title>Panel tour</title>
<style>
  body { margin: 2rem auto; max-width: 1200px; padding: 0 1rem; font: 15px/1.6 system-ui; color: #ddd; background: #1a1a1a; }
  a { color: #8ab4f8; }
  img { display: block; width: 100%; border-radius: 10px; }
  h2 { margin-top: 3rem; }
</style>
<h1>Panel tour</h1>
<p>Written by <code>tour.ts</code> from a sandbox with the baseline config.</p>
${map()}
${shots.join("\n")}
`;
}

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});
await $`${sandbox} --name ${NAME} stop`.quiet();
await $`${sandbox} --name ${NAME} reset --no-include`;
await $`${sandbox} --name ${NAME} start`;

const {port, label} = sandboxTarget(NAME);
const session = await startSession(port, label);
try {
  const files = await walk(session);
  writeFileSync(page, indexPage(files));
  console.log(`${page}: ${files.length} stops`);
} finally {
  await session.end();
  await $`${sandbox} --name ${NAME} stop`.quiet();
}
if (process.stdout.isTTY) {
  await $`${process.platform === "darwin" ? "open" : "xdg-open"} ${page}`;
}
