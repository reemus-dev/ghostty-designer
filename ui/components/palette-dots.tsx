import type {ComponentPropsWithoutRef} from "react";

/** Palette colours as a row of dots, for theme previews. */
export function PaletteDots(
  props: ComponentPropsWithoutRef<"span"> & {
    colors: string[];
    dotClassName?: string;
  },
) {
  const {colors, dotClassName, ...rest} = props;
  return (
    <span aria-hidden {...rest}>
      {colors.map((color, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- a dot's index is its palette slot
        <i key={i} className={dotClassName} style={{background: color}} />
      ))}
    </span>
  );
}
