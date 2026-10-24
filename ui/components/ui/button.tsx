import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "cn";
import {Button as ButtonPrimitive} from "@base-ui/react/button";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[background-color,color,box-shadow] select-none disabled:pointer-events-none disabled:opacity-64 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/14%),0_1px_2px_rgb(0_0_0/30%)] hover:bg-primary/90 active:bg-primary/85 active:shadow-[inset_0_1px_0_rgb(0_0_0/12%)]",
        outline:
          "bg-secondary text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/3%)] inset-ring inset-ring-input hover:bg-accent active:bg-selected aria-expanded:bg-accent [&_svg:not([class*='opacity-'])]:opacity-80",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-selected aria-expanded:bg-accent aria-expanded:text-foreground",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/20 active:bg-destructive/28",
      },
      size: {
        default:
          "h-[30px] gap-[7px] px-3 text-base has-[>svg:first-child]:pl-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[26px] gap-1.5 px-2.5 text-sm",
        lg: "h-8 gap-2 px-3.5 text-base",
        icon: "size-[30px]",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[26px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({variant, size, className}))}
      {...props}
    />
  );
}

export {Button};
