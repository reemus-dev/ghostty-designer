import type {ReactNode} from "react";
import {ChevronRightIcon} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * A reference view inside a card, closed until opened. `aside` sits beside the
 * label.
 */
export function Disclosure(props: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const {label, aside, children} = props;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/trigger flex h-7 items-center gap-1.5 rounded-md text-left font-medium text-fg-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3 text-fg-3 transition-transform group-data-panel-open/trigger:rotate-90"
        />
        {label}
        {aside !== undefined && (
          <span className="truncate text-sm font-normal text-fg-3">
            {aside}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
