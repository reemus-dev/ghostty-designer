"use client";

import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "cn";
import {Toggle as TogglePrimitive} from "@base-ui/react/toggle";

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        /** Native's segmented control: the pressed item is a raised chip. */
        segmented:
          "font-medium text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/35%),inset_0_1px_0_rgb(255_255_255/5%)]",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    compoundVariants: [
      {
        variant: "segmented",
        className: "h-[26px] min-w-0 rounded-md px-2.5 text-sm",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({variant, size, className}))}
      {...props}
    />
  );
}

export {Toggle, toggleVariants};
