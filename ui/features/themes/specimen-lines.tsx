import type {CSSProperties} from "react";
import {xterm256} from "@/core/color";
import type {ThemeColors} from "@/core/types";
import {useGhosttyFont} from "@/lib/fonts";
import type {SpecimenLine, SpecimenSegment} from "@/lib/specimen";

/**
 * Ghostty's rules: selection and cursor colours fall back to inverting the
 * cell.
 */
function segmentStyle(
  segment: SpecimenSegment,
  colors: ThemeColors,
): CSSProperties {
  let fg =
    segment.fg === undefined
      ? colors.foreground
      : (colors.palette[segment.fg] ?? xterm256(segment.fg));
  let bg: string | undefined;
  if (segment.selected) {
    [fg, bg] = colors.selectionBackground
      ? [colors.selectionForeground ?? fg, colors.selectionBackground]
      : [colors.background, fg];
  }
  if (segment.cursor) {
    [fg, bg] = [
      colors.cursorText ?? colors.background,
      colors.cursorColor ?? colors.foreground,
    ];
  }
  return {color: fg, background: bg};
}

/** Specimen lines in a theme's colours and Ghostty's font, without chrome. */
export function SpecimenLines(props: {
  lines: SpecimenLine[];
  colors: ThemeColors;
}) {
  const {lines, colors} = props;
  const ghosttyFont = useGhosttyFont();
  return (
    <div
      className="overflow-hidden px-3.5 pt-3 pb-[13px] text-[12.5px] leading-[18px] whitespace-pre"
      style={{
        background: colors.background,
        color: colors.foreground,
        fontFamily: ghosttyFont,
        fontVariantNumeric: "normal",
      }}>
      {lines.map((line, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- specimen lines never reorder
        <div key={i}>
          {line.map((segment, j) => (
            // oxlint-disable-next-line react/no-array-index-key -- segments never reorder
            <span key={j} style={segmentStyle(segment, colors)}>
              {segment.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
