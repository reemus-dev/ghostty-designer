import {cn} from "cn";
import type {Toggle as TogglePrimitive} from "@base-ui/react/toggle";
import {Toggle} from "@/components/ui/toggle";

/**
 * Native's filter chip: a toggle that shows as selected when on, with an
 * optional count of what it shows.
 */
export function Chip(props: TogglePrimitive.Props & {count?: number}) {
  const {count, className, children, ...rest} = props;
  return (
    <Toggle
      {...rest}
      className={cn(
        "h-[30px] shrink-0 gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground inset-ring inset-ring-input hover:bg-accent hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:inset-ring-foreground/20 [&_svg:not([class*='size-'])]:size-3.5",
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
