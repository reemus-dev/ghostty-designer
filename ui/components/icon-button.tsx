import type {ReactNode} from "react";
import {Button} from "@/components/ui/button";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";

/** An icon-only button: its label doubles as the tooltip. */
export function IconButton(props: {
  label: string;
  disabled?: boolean;
  tabIndex?: number;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const {label, onClick, children, ...rest} = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            {...rest}
            aria-label={label}
            size="icon-xs"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          />
        }>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
