import {cn} from "cn";

function Kbd({className, ...props}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] w-fit min-w-[18px] items-center justify-center gap-1 rounded-sm bg-white/6 px-[5px] font-sans text-xs leading-none font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/7%)] select-none in-data-[variant=default]:bg-white/16 in-data-[variant=default]:text-white/85 in-data-[variant=default]:shadow-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({className, ...props}: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export {Kbd, KbdGroup};
