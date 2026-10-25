import {cn} from "cn";
import {Toggle as TogglePrimitive} from "@base-ui/react/toggle";
import {ToggleGroup as ToggleGroupPrimitive} from "@base-ui/react/toggle-group";

/** A segmented control: the pressed item is a raised chip in a sunken track. */
function ToggleGroup({className, ...props}: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "flex w-fit items-center rounded-lg bg-muted p-0.5 inset-ring inset-ring-input",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({className, ...props}: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-[26px] shrink-0 grow basis-0 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:z-10 disabled:pointer-events-none disabled:opacity-64 aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:shadow-raised aria-pressed:inset-shadow-highlight [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export {ToggleGroup, ToggleGroupItem};
