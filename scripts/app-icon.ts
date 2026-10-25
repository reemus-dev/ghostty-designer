#!/usr/bin/env bun
// Draws the app icon, a fan of terminal theme swatch cards, and writes it to
// crates/app/icons:
//
// - the Linux PNGs and icon.icns, rendered by `tauri icon` from a flat drawing
//   with the plate and shadows
// - AppIcon.icon, an Icon Composer document with one layer per card, so macOS
//   26 and later add their own shadows, glass and dark, clear and tinted looks.
//   docs/distribution.md says why the bundle does not list it yet.
//
//   app-icon.ts
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {$} from "bun";

const outDir = path.join(import.meta.dir, "../crates/app/icons");

type Theme = {
  name: string;
  /** Degrees around the rivet. */
  rotate: number;
  frame: [top: string, bottom: string];
  screen: string;
  /** The untinted part of each code line. */
  dim: string;
  prompt: string;
  cursor: string;
  /** Red, green, yellow, blue, magenta, cyan. */
  palette: string[];
  /** Code lines: share of the screen width, palette index of the token. */
  lines: [width: number, colour: number][];
};

// Back to front.
const THEMES: Theme[] = [
  {
    name: "dracula",
    rotate: 24,
    frame: ["#b48cf2", "#8f63d6"],
    screen: "#261c3a",
    dim: "#5b4b78",
    prompt: "#8be9fd",
    cursor: "#ff79c6",
    palette: ["#ff5c8a", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd"],
    lines: [
      [0.9, 3],
      [0.6, 1],
      [0.75, 4],
      [0.5, 2],
      [0.85, 5],
    ],
  },
  {
    name: "gruvbox",
    rotate: -2,
    frame: ["#ffb547", "#f08a1c"],
    screen: "#282320",
    dim: "#4a3f36",
    prompt: "#b8bb26",
    cursor: "#fabd2f",
    palette: ["#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c"],
    lines: [
      [0.8, 3],
      [0.55, 1],
      [0.9, 5],
      [0.6, 0],
      [0.7, 2],
    ],
  },
  {
    name: "tokyo-night",
    rotate: -28,
    frame: ["#4f8ff7", "#2f6fe0"],
    screen: "#16192b",
    dim: "#2e3552",
    prompt: "#9ece6a",
    cursor: "#7dcfff",
    palette: ["#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff"],
    lines: [
      [0.85, 3],
      [0.6, 4],
      [0.9, 1],
      [0.5, 0],
      [0.75, 5],
    ],
  },
];

const SIZE = 1024;
// Apple's macOS icon grid: the plate is 824 points, inset 100.
const PLATE = {inset: 100, size: 824, radius: 185};
const CARD = {width: 262, height: 572, radius: 30, border: 16, screen: 392};
/** The rivet's distance from a card's right and bottom edges. */
const RIVET_INSET = 44;
const RIVET_RADIUS = 26;

const centre = (values: number[]) =>
  (Math.min(...values) + Math.max(...values)) / 2;

/** The rivet position that centres the fan in the plate. */
const rivet = (() => {
  const xs: number[] = [];
  const ys: number[] = [];
  const left = RIVET_INSET - CARD.width;
  const top = RIVET_INSET - CARD.height;
  for (const {rotate} of THEMES) {
    const a = (rotate * Math.PI) / 180;
    for (const [x, y] of [
      [left, top],
      [RIVET_INSET, top],
      [left, RIVET_INSET],
      [RIVET_INSET, RIVET_INSET],
    ] as const) {
      xs.push(x * Math.cos(a) - y * Math.sin(a));
      ys.push(x * Math.sin(a) + y * Math.cos(a));
    }
  }
  // A little below the middle, which balances the fan's heavier top.
  return {x: Math.round(512 - centre(xs)), y: Math.round(520 - centre(ys))};
})();

const round = (n: number) => Math.round(n * 10) / 10;

/** A card in its rivet's coordinates. Glow is for the flat drawing only. */
function card(theme: Theme, glow: boolean) {
  const x = RIVET_INSET - CARD.width;
  const y = RIVET_INSET - CARD.height;
  const sx = x + CARD.border;
  const sy = y + CARD.border;
  const sw = CARD.width - 2 * CARD.border;
  const screenRadius = CARD.radius - CARD.border + 6;
  const parts = [
    `<rect x="${x}" y="${y}" width="${CARD.width}" height="${CARD.height}" rx="${CARD.radius}" fill="url(#${theme.name}-frame)"/>`,
    `<rect x="${x + 1.5}" y="${y + 1.5}" width="${CARD.width - 3}" height="${CARD.height - 3}" rx="${CARD.radius - 1.5}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>`,
    `<rect x="${sx}" y="${sy}" width="${sw}" height="${CARD.screen}" rx="${screenRadius}" fill="${theme.screen}"/>`,
    `<rect x="${sx}" y="${sy}" width="${sw}" height="${CARD.screen}" rx="${screenRadius}" fill="url(#sheen)"/>`,
  ];
  ["#ff5f57", "#febc2e", "#28c840"].forEach((colour, i) => {
    parts.push(
      `<circle cx="${sx + 30 + i * 26}" cy="${sy + 30}" r="8.5" fill="${colour}"/>`,
    );
  });
  const px = sx + 26;
  const py = sy + 78;
  parts.push(
    `<path d="M${px} ${py}l18 16-18 16" fill="none" stroke="${theme.prompt}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<rect x="${px + 34}" y="${py - 4}" width="22" height="40" rx="4" fill="${theme.cursor}"${glow ? ' filter="url(#glow)"' : ""}/>`,
  );
  theme.lines.forEach(([share, colour], i) => {
    const indent = i === 1 || i === 2 ? 22 : 0;
    const width = (sw - 52 - indent) * share;
    const lx = sx + 26 + indent;
    const ly = py + 64 + i * 34;
    parts.push(
      `<rect x="${lx}" y="${ly}" width="${round(width * 0.35)}" height="14" rx="7" fill="${theme.palette[colour]}"/>`,
      `<rect x="${round(lx + width * 0.35 + 10)}" y="${ly}" width="${round(width * 0.65)}" height="14" rx="7" fill="${theme.dim}"/>`,
    );
  });
  // Palette chips, like a paint swatch card, clear of the rivet's corner.
  const gap = 10;
  const chip = (sw - 2 * RIVET_INSET - 2 * gap) / 3;
  theme.palette.slice(0, 3).forEach((colour, i) => {
    parts.push(
      `<rect x="${round(sx + i * (chip + gap))}" y="${sy + CARD.screen + 16}" width="${round(chip)}" height="${round(chip)}" rx="10" fill="${colour}"/>`,
    );
  });
  return parts.join("\n");
}

function cardDefs(theme: Theme) {
  return `<linearGradient id="${theme.name}-frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.frame[0]}"/><stop offset="1" stop-color="${theme.frame[1]}"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
}

const RIVET_DEFS = `<radialGradient id="rivet" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#d6d8dc"/><stop offset="1" stop-color="#8d929a"/></radialGradient>`;

function rivetShape(filter: string) {
  return `<circle cx="${rivet.x}" cy="${rivet.y}" r="${RIVET_RADIUS}" fill="url(#rivet)"${filter}/>
<circle cx="${rivet.x}" cy="${rivet.y}" r="${RIVET_RADIUS - 1}" fill="none" stroke="#6f747c" stroke-opacity=".6" stroke-width="2"/>`;
}

const placed = (theme: Theme, body: string, filter = "") =>
  `<g transform="translate(${rivet.x} ${rivet.y}) rotate(${theme.rotate})"${filter}>\n${body}\n</g>`;

const svgDocument = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
${defs}
</defs>
${body}
</svg>
`;

/** The whole icon on its plate, with shadows, for the PNGs and icon.icns. */
function flatIcon() {
  const {inset, size, radius} = PLATE;
  const defs = [
    `<linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfaf8"/><stop offset="1" stop-color="#e4e1dc"/></linearGradient>`,
    `<radialGradient id="plate-glow" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<filter id="plate-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity=".28"/></filter>`,
    `<filter id="card-shadow" x="-30%" y="-20%" width="160%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1b1530" flood-opacity=".3"/></filter>`,
    `<filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    ...THEMES.map(cardDefs),
    RIVET_DEFS,
  ];
  const body = [
    `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="url(#plate)" filter="url(#plate-shadow)"/>`,
    `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="url(#plate-glow)"/>`,
    `<rect x="${inset + 1.5}" y="${inset + 1.5}" width="${size - 3}" height="${size - 3}" rx="${radius - 1.5}" fill="none" stroke="#fff" stroke-width="3"/>`,
    ...THEMES.map((theme) =>
      placed(theme, card(theme, true), ' filter="url(#card-shadow)"'),
    ),
    rivetShape(' filter="url(#card-shadow)"'),
  ];
  return svgDocument(defs.join("\n"), body.join("\n"));
}

// Icon Composer's canvas is the plate itself, so layers drawn on the plate's
// grid scale up to fill it.
const toCanvas = (body: string) => {
  const scale = SIZE / PLATE.size;
  const c = SIZE / 2;
  return `<g transform="translate(${c} ${c}) scale(${scale}) translate(${-c} ${-c})">\n${body}\n</g>`;
};

/** Top layer first, as Icon Composer orders groups. */
const LAYERS = [
  {name: "rivet", svg: svgDocument(RIVET_DEFS, toCanvas(rivetShape("")))},
  ...THEMES.toReversed().map((theme) => ({
    name: theme.name,
    svg: svgDocument(
      cardDefs(theme),
      toCanvas(placed(theme, card(theme, false))),
    ),
  })),
];

function iconDocument() {
  return {
    fill: {
      "linear-gradient": [
        "srgb:0.98431,0.98039,0.97255,1.00000",
        "srgb:0.89412,0.88235,0.86275,1.00000",
      ],
    },
    groups: LAYERS.map(({name}) => ({
      layers: [{"image-name": `${name}.svg`, name, glass: false}],
      shadow: {kind: "neutral", opacity: 0.5},
      translucency: {enabled: false, value: 0.5},
    })),
    "supported-platforms": {squares: ["macOS"]},
  };
}

const work = mkdtempSync(path.join(tmpdir(), "app-icon-"));
try {
  const flat = path.join(work, "app-icon.svg");
  writeFileSync(flat, flatIcon());
  await $`tauri icon ${flat} --output ${work} --png 16,32,64,128,256,512,1024`.quiet();
  const png = (size: number) => path.join(work, `${size}x${size}.png`);

  for (const size of [32, 64, 128, 256, 512]) {
    cpSync(png(size), path.join(outDir, `${size}x${size}.png`));
  }

  // `tauri icon` writes ICNS entries in a random order, so iconutil packs it
  // and an unchanged icon gives an unchanged file.
  const iconset = path.join(work, "icon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    cpSync(png(size), path.join(iconset, `icon_${size}x${size}.png`));
    cpSync(png(size * 2), path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await $`iconutil --convert icns ${iconset} --output ${path.join(outDir, "icon.icns")}`;

  const document = path.join(outDir, "AppIcon.icon");
  rmSync(document, {recursive: true, force: true});
  mkdirSync(path.join(document, "Assets"), {recursive: true});
  for (const {name, svg} of LAYERS) {
    writeFileSync(path.join(document, "Assets", `${name}.svg`), svg);
  }
  const json = path.join(document, "icon.json");
  writeFileSync(json, JSON.stringify(iconDocument()));
  await $`oxfmt ${json}`.quiet();
} finally {
  rmSync(work, {recursive: true, force: true});
}
