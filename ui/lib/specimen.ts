// Specimen content: one source of truth for the panel's approximate render and
// the exact one a terminal prints. Colours name palette slots, never values, so
// any theme renders the same pages. The content is crates/host/src/specimen.json,
// which the Rust printer embeds.
import content from "../../crates/host/src/specimen.json";

/** A palette index (0-255), or the theme's foreground or background. */
export type SpecimenColor = number | "fg" | "bg";

type SpecimenStyle = {
  fg?: SpecimenColor;
  bg?: SpecimenColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  inverse?: boolean;
  /** Drawn with the selection colours. */
  selected?: boolean;
  /** The cell under the cursor, drawn with the cursor colours. */
  cursor?: boolean;
};

export type SpecimenSegment = SpecimenStyle & {text: string};

export type SpecimenLine = SpecimenSegment[];

/**
 * The mini terminal on gallery cards: prompt, accents, selection, diff, comment
 * and cursor.
 */
export const SPECIMEN_CARD = content.card as SpecimenLine[];
