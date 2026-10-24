"use client";

import {cn} from "cn";
import {Switch as SwitchPrimitive} from "@base-ui/react/switch";

function Switch({className, ...props}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full p-0.5 transition-colors after:absolute after:-inset-x-2 after:-inset-y-2 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-64 data-unchecked:bg-input",
        className,
      )}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-foreground shadow-[0_1px_2px_rgb(0_0_0/40%)] transition-transform data-checked:translate-x-3.5 data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export {Switch};
