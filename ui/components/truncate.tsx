import {type CSSProperties, type ReactNode, useRef, useState} from "react";
import {cn} from "cn";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";

/**
 * Text cut to one line with an ellipsis. Hovering it shows the whole text, but
 * only while it is cut.
 */
export function Truncate(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const text = ref.current;
        setOpen(next && text !== null && text.scrollWidth > text.clientWidth);
      }}>
      <TooltipTrigger
        render={
          <span
            ref={ref}
            style={props.style}
            className={cn("truncate", props.className)}
          />
        }>
        {props.children}
      </TooltipTrigger>
      <TooltipContent className="wrap-anywhere">
        {props.children}
      </TooltipContent>
    </Tooltip>
  );
}
