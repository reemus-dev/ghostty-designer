// The gallery cards' mini terminal, from the `card` section of
// crates/host/src/sample.json. The Rust `demo` printout renders the same
// file's `pages`. Colours name palette slots, never values, so any theme
// renders the same card.
import content from "../../crates/host/src/sample.json";

export type SampleSegment = {
  text: string;
  /** A palette index (0-255). Without one, the theme's foreground. */
  fg?: number;
  /** Drawn with the selection colours. */
  selected?: boolean;
  /** The cell under the cursor, drawn with the cursor colours. */
  cursor?: boolean;
};

export type SampleLine = SampleSegment[];

/**
 * The mini terminal on gallery cards: prompt, accents, selection, diff, comment
 * and cursor.
 */
export const SAMPLE_CARD = content.card as SampleLine[];
