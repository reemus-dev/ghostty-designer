import {cn} from "cn";
import {contrastRatio, parseHex} from "@/core/color";

type SwatchProps = {
  /** Any CSS colour. */
  color: string;
  /** A blue-ringed dot: the colour has an unsaved change. */
  changed?: boolean;
  /** An amber badge: the colour is hard to read on the background. */
  warning?: boolean;
  selected?: boolean;
  title?: string;
  className?: string;
};

/** --color-card, as a hex for the contrast check. */
const CARD = "#191a1e";

/**
 * A colour tile; size it with className. Colours close to the card get a
 * stronger edge so they stay visible, and translucent colours sit on a
 * checkerboard.
 */
export function Swatch(props: SwatchProps) {
  const {color, changed, warning, selected} = props;
  const hex = parseHex(color) ? color : null;
  const faint = hex !== null && contrastRatio(hex, CARD) < 1.6;
  return (
    <span
      title={props.title}
      className={cn(
        "relative block h-7 w-full shrink-0 rounded-md checkerboard",
        selected &&
          "ring-2 ring-ring ring-offset-2 ring-offset-(--swatch-offset,var(--color-card))",
        props.className,
      )}>
      <span
        style={{background: color}}
        className={cn(
          "absolute inset-0 rounded-[inherit]",
          faint
            ? "inset-ring inset-ring-foreground/40"
            : "inset-ring inset-ring-border",
        )}
      />
      {changed && (
        <span className="absolute right-1 bottom-1 size-[7px] rounded-full bg-white ring-2 ring-primary" />
      )}
      {warning && (
        <span className="absolute -top-[5px] -right-[5px] grid size-[15px] place-items-center rounded-full bg-warn text-[10px] leading-none font-bold text-[#1a1205] ring-2 ring-card">
          !
        </span>
      )}
    </span>
  );
}

/** A small colour square for inline text. */
export function ColorSquare(props: {color: string}) {
  return (
    <i
      aria-hidden
      className="size-2.5 shrink-0 rounded-[3px] inset-ring inset-ring-input"
      style={{background: props.color}}
    />
  );
}

/** A small colour square with its value, for inline text: "■ #1e1e2e". */
export function HexChip(props: {color: string}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ColorSquare color={props.color} />
      <code className="text-sm text-muted-foreground">{props.color}</code>
    </span>
  );
}
