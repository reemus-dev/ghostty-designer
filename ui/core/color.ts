// Pure colour helpers. Colours are hex strings at rest.
import {
  clampChroma as clampOklchChroma,
  modeLab65,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeRgb,
  useMode,
  wcagContrast,
  wcagLuminance,
} from "culori/fn";

type Rgb = {r: number; g: number; b: number};

/** Lightness 0-1, chroma 0-0.4, hue in degrees (0 for greys). */
export type Oklch = {l: number; c: number; h: number};

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
// oxlint-disable react-hooks/rules-of-hooks -- culori's useMode is not a React hook
const toRgb = useMode(modeRgb);
const toOklchColor = useMode(modeOklch);
const toLab = useMode(modeLab65);
const toOklabColor = useMode(modeOklab);
const toLrgb = useMode(modeLrgb);
// oxlint-enable react-hooks/rules-of-hooks

/** Accepts the forms Ghostty does: #rgb, #rrggbb, rrggbb. Channels are 0-255. */
export function parseHex(text: string): Rgb | null {
  const match = HEX.exec(text.trim());
  if (!match) {
    return null;
  }
  let digits = match[1]!;
  if (digits.length === 3) {
    digits = digits.replaceAll(/./g, "$&$&");
  }
  const n = Number.parseInt(digits, 16);
  return {r: n >> 16, g: (n >> 8) & 255, b: n & 255};
}

/** Lowercase #rrggbb. Channels are rounded and clamped to 0-255. */
function formatHex({r, g, b}: Rgb): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

const hexByte = (v: number) =>
  Math.min(255, Math.max(0, Math.round(v)))
    .toString(16)
    .padStart(2, "0");

/**
 * A colour complete enough to show while it is typed: six hex digits, not three
 * on the way to six.
 */
export const FULL_HEX = /^#?[\da-f]{6}$/i;

/** Lowercase #rrggbb, or undefined when the text is not a hex colour. */
export function normalizeHex(text: string) {
  const rgb = parseHex(text);
  return rgb ? formatHex(rgb) : undefined;
}

function unit(hex: string) {
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new RangeError(`Not a hex colour: ${hex}`);
  }
  return {mode: "rgb" as const, r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255};
}

/** WCAG 2 relative luminance, 0-1. Throws RangeError on a non-hex colour. */
export const relativeLuminance = (hex: string) =>
  wcagLuminance(toLrgb(unit(hex)));

/** WCAG 2 contrast ratio, 1-21. Throws RangeError on a non-hex colour. */
export const contrastRatio = (a: string, b: string) =>
  wcagContrast(toLrgb(unit(a)), toLrgb(unit(b)));

/** Throws RangeError on a non-hex colour. */
export function toOklch(hex: string): Oklch {
  const color = toOklchColor(unit(hex));
  return {l: color.l, c: color.c, h: color.h ?? 0};
}

/**
 * Euclidean distance in OKLab, a perceptual colour difference. Throws
 * RangeError on a non-hex colour.
 */
export function oklabDistance(a: string, b: string) {
  const [x, y] = [toOklabColor(unit(a)), toOklabColor(unit(b))];
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/**
 * The colour nearest to `hex` in OKLCH lightness, hue and chroma held, whose
 * contrast against `against` reaches `target`. Chroma drops where the new
 * lightness cannot hold it in sRGB. Null when no lightness reaches the target.
 */
export function fixLightness(hex: string, against: string, target: number) {
  const from = toOklch(hex);
  const at = (l: number) => fromOklch({...from, l});
  const passes = (l: number) => contrastRatio(at(l), against) >= target;

  let best: number | undefined;
  for (const end of [0, 1]) {
    if (!passes(end)) continue;
    let [fail, pass] = [from.l, end];
    for (let i = 0; i < 32; i++) {
      const mid = (fail + pass) / 2;
      if (passes(mid)) pass = mid;
      else fail = mid;
    }
    if (
      best === undefined ||
      Math.abs(pass - from.l) < Math.abs(best - from.l)
    ) {
      best = pass;
    }
  }
  return best === undefined ? null : at(best);
}

/** Out-of-gamut colours lose chroma until they fit sRGB. */
export function fromOklch(color: Oklch): string {
  const {r, g, b} = toRgb({mode: "oklch", ...clampChroma(color)});
  return formatHex({r: r * 255, g: g * 255, b: b * 255});
}

/** True when every sRGB channel rounds into 0-255. */
export function inSrgbGamut(color: Oklch) {
  const {r, g, b} = toRgb({mode: "oklch", ...color});
  return [r, g, b].every((v) => v > -0.5 / 255 && v < 1 + 0.5 / 255);
}

/** Reduces chroma, keeping lightness and hue, until the colour fits sRGB. */
export function clampChroma(color: Oklch): Oklch {
  const {l, c, h} = clampOklchChroma({mode: "oklch", ...color}, "oklch");
  return {l, c, h: h ?? color.h};
}

const CUBE = [0, 95, 135, 175, 215, 255];

/**
 * Xterm's default for a 256-colour slot above 15: the 6×6×6 cube, then the grey
 * ramp.
 */
export function xterm256(index: number) {
  if (index >= 232) {
    const v = 8 + (index - 232) * 10;
    return formatHex({r: v, g: v, b: v});
  }
  const n = index - 16;
  return formatHex({
    r: CUBE[Math.floor(n / 36)]!,
    g: CUBE[Math.floor(n / 6) % 6]!,
    b: CUBE[n % 6]!,
  });
}

/** A channel from 0-1 scaled to 0-255, clamped. */
const unitByte = (v: number) => Math.min(1, Math.max(0, v)) * 255;

/**
 * Slots 16-255 as Ghostty shows them. `palette-generate` interpolates the cube
 * and grey ramp in CIELAB from the background, foreground and ANSI 1-6
 * (terminal/color.zig generate256Color); `explicit` slots are never replaced.
 */
export function extendedPalette(input: {
  background: string;
  foreground: string;
  palette: string[];
  explicit: (index: number) => boolean;
  generate: boolean;
  harmonious: boolean;
}) {
  const {background, foreground, palette, explicit, generate} = input;
  const fixed = (index: number) => palette[index] ?? xterm256(index);
  if (!generate) return Array.from({length: 240}, (_, i) => fixed(i + 16));

  const base = [background, ...palette.slice(1, 7), foreground].map((hex) =>
    toLab(hex)!,
  );
  // Light themes run the cube from black to white unless harmonious.
  if (!input.harmonious && base[7]!.l < base[0]!.l) {
    const light = base[0]!;
    base[0] = base[7]!;
    base[7] = light;
  }
  type Lab = (typeof base)[number];
  const blend = (t: number, a: Lab, b: Lab): Lab => ({
    mode: "lab65",
    l: a.l + (b.l - a.l) * t,
    a: a.a + (b.a - a.a) * t,
    b: a.b + (b.b - a.b) * t,
  });
  const hexOf = (color: Lab) => {
    const {r, g, b} = toRgb(color);
    return formatHex({r: unitByte(r), g: unitByte(g), b: unitByte(b)});
  };

  const result: string[] = [];
  for (let r = 0; r < 6; r++) {
    const c0 = blend(r / 5, base[0]!, base[1]!);
    const c1 = blend(r / 5, base[2]!, base[3]!);
    const c2 = blend(r / 5, base[4]!, base[5]!);
    const c3 = blend(r / 5, base[6]!, base[7]!);
    for (let g = 0; g < 6; g++) {
      const c4 = blend(g / 5, c0, c1);
      const c5 = blend(g / 5, c2, c3);
      for (let b = 0; b < 6; b++) result.push(hexOf(blend(b / 5, c4, c5)));
    }
  }
  for (let i = 0; i < 24; i++) {
    result.push(hexOf(blend((i + 1) / 25, base[0]!, base[7]!)));
  }
  return result.map((hex, i) => (explicit(i + 16) ? fixed(i + 16) : hex));
}

/** `oklch(0.561 0.034 279.1)`, as CSS writes it. */
export const formatOklch = ({l, c, h}: Oklch) =>
  `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;

const NUMBER = String.raw`\d+(?:\.\d*)?|\.\d+`;
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})\s+(${NUMBER})(?:deg)?\s*(?:\/\s*(?:${NUMBER})%?\s*)?\)$`,
  "i",
);

/** Parses the CSS form, lightness as 0-1 or a percentage. */
export function parseOklch(text: string): Oklch | null {
  const match = OKLCH.exec(text.trim());
  if (!match) return null;
  const [, l, percent, c, h] = match;
  return {
    l: Number(l) / (percent ? 100 : 1),
    c: Number(c),
    h: Number(h) % 360,
  };
}
