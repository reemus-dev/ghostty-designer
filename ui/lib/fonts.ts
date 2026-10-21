import type {FontFamily} from "@/core/bindings";
import {useEffective, useSnapshot} from "./store";

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/light/, 300],
  [/medium/, 500],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/bold/, 700],
  [/black|heavy/, 900],
];

/** CSS family names by family and face ids. */
const registered = new Map<string, string>();

/**
 * Registers @font-face rules for a family's faces, served by the app, and
 * returns the CSS family name. The browser fetches a face only when text uses
 * it, so registering a whole list is cheap. A rescan that changes a family's
 * faces gives them new ids, so they register under a new name.
 */
export function fontFace(family: FontFamily) {
  const key = [family.family, ...family.faces.map((face) => face.id)].join(
    "\n",
  );
  const known = registered.get(key);
  if (known) return known;
  const name = `gd ${registered.size} ${family.family}`;
  registered.set(key, name);

  const wght = family.axes.find((axis) => axis.tag === "wght");
  for (const face of family.faces) {
    const style = face.style.toLowerCase();
    const weight = wght
      ? `${wght.min} ${wght.max}`
      : String(WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400);
    const font = new FontFace(name, `url(font://localhost/${face.id})`, {
      weight,
      style: /italic|oblique/.test(style) ? "italic" : "normal",
    });
    document.fonts.add(font);
  }
  return name;
}

/**
 * A CSS font-family stack for a Ghostty family list, such as font-family's
 * values.
 */
export function useFontStack(families: string[]) {
  const fonts = useSnapshot((snapshot) => snapshot.fonts);
  const names = families.map((family) => {
    const known = fonts?.find((font) => font.family === family);
    return known ? `"${fontFace(known)}"` : JSON.stringify(family);
  });
  return [...names, "ui-monospace", "monospace"].join(", ");
}

/** The font stack of the font Ghostty shows now. */
export function useGhosttyFont() {
  const families = useEffective("font-family");
  return useFontStack(families ?? []);
}
