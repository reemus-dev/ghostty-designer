import {cn} from "cn";
import {Toggle} from "@base-ui/react/toggle";

/**
 * Native's filter chip: a toggle that shows as selected when on, with an
 * optional count of what it shows.
 */
export function Chip(props: Toggle.Props & {count?: number}) {
  const {count, className, children, ...rest} = props;
  return (
    <Toggle
      {...rest}
      className={cn(
        "group/toggle inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground inset-ring inset-ring-input transition-[color,background-color,box-shadow] hover:bg-accent hover:text-foreground active:bg-selected disabled:pointer-events-none disabled:opacity-64 aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:inset-ring-foreground/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}>
      {children}
      {count !== undefined && (
        <span className="font-mono text-2xs font-normal text-muted-foreground group-aria-pressed/toggle:text-foreground">
          {count}
        </span>
      )}
    </Toggle>
  );
}
