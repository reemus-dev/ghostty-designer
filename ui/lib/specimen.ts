// The gallery cards' mini terminal, from the `card` section of
// crates/host/src/specimen.json. The Rust `specimen` printout renders the same
// file's `pages`. Colours name palette slots, never values, so any theme
// renders the same card.
import content from "../../crates/host/src/specimen.json";

export type SpecimenSegment = {
  text: string;
  /** A palette index (0-255). Without one, the theme's foreground. */
  fg?: number;
  /** Drawn with the selection colours. */
  selected?: boolean;
  /** The cell under the cursor, drawn with the cursor colours. */
  cursor?: boolean;
};

export type SpecimenLine = SpecimenSegment[];

/**
 * The mini terminal on gallery cards: prompt, accents, selection, diff, comment
 * and cursor.
 */
export const SPECIMEN_CARD = content.card as SpecimenLine[];
