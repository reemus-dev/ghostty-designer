import * as React from "react";
import {cn} from "cn";
import {Input as InputPrimitive} from "@base-ui/react/input";

function Input({className, type, ...props}: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[30px] w-full min-w-0 rounded-lg border border-input bg-muted px-2.5 py-1 text-base transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 aria-invalid:border-destructive/60 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export {Input};
