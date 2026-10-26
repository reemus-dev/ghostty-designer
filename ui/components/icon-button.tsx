import type {ComponentProps} from "react";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";

/** An icon-only button: its label doubles as the tooltip. */
export function IconButton(
  props: ComponentProps<typeof Button> & {label: string; shortcut?: string},
) {
  const {label, shortcut, onClick, children, ...rest} = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            {...rest}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              onClick?.(event);
            }}
          />
        }>
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
