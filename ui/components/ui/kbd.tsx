import {cn} from "cn";

function Kbd({className, ...props}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] w-fit min-w-[18px] items-center justify-center gap-1 rounded-sm bg-muted px-[5px] font-sans text-xs leading-none font-medium text-muted-foreground inset-ring inset-ring-border select-none in-data-[variant=default]:bg-primary-foreground/16 in-data-[variant=default]:text-primary-foreground/85 in-data-[variant=default]:inset-ring-0 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export {Kbd};
