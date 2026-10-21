import type {CSSProperties} from "react";
import {cn} from "cn";
import {xterm256} from "@/core/color";
import type {ThemeColors} from "@/core/types";
import {useGhosttyFont} from "@/lib/fonts";
import type {
  SpecimenColor,
  SpecimenLine,
  SpecimenSegment,
} from "@/lib/specimen";

function resolve(color: SpecimenColor, colors: ThemeColors) {
  if (color === "fg") return colors.foreground;
  return color === "bg"
    ? colors.background
    : (colors.palette[color] ?? xterm256(color));
}

/**
 * Ghostty's rules: selection and cursor colours fall back to inverting the
 * cell.
 */
function segmentStyle(segment: SpecimenSegment, colors: ThemeColors) {
  let fg =
    segment.fg === undefined ? colors.foreground : resolve(segment.fg, colors);
  let bg = segment.bg === undefined ? undefined : resolve(segment.bg, colors);
  if (segment.inverse) [fg, bg] = [bg ?? colors.background, fg];
  if (segment.selected) {
    [fg, bg] = colors.selectionBackground
      ? [colors.selectionForeground ?? fg, colors.selectionBackground]
      : [bg ?? colors.background, fg];
  }
  if (segment.cursor) {
    [fg, bg] = [
      colors.cursorText ?? colors.background,
      colors.cursorColor ?? colors.foreground,
    ];
  }

  const style: CSSProperties = {color: fg, background: bg};
  if (segment.dim) style.color = `color-mix(in srgb, ${fg} 50%, transparent)`;
  if (segment.bold) style.fontWeight = 700;
  if (segment.italic) style.fontStyle = "italic";
  if (segment.underline) style.textDecoration = "underline";
  return style;
}

/** Specimen lines in a theme's colours and Ghostty's font, without chrome. */
export function SpecimenLines(props: {
  lines: SpecimenLine[];
  colors: ThemeColors;
  className?: string;
}) {
  const {lines, colors, className} = props;
  const ghosttyFont = useGhosttyFont();
  return (
    <div
      className={cn(
        "overflow-hidden px-3.5 py-3 text-[13px] leading-[19px] whitespace-pre",
        className,
      )}
      style={{
        background: colors.background,
        color: colors.foreground,
        fontFamily: ghosttyFont,
        fontVariantNumeric: "normal",
      }}>
      {lines.map((line, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- specimen lines never reorder
        <div key={i}>
          {line.length === 0
            ? " "
            : line.map((segment, j) => (
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
