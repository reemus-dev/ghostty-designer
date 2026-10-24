import {cn} from "cn";
import {ColorSquare} from "@/components/swatch";
import type {DraftChange} from "@/lib/changes";

/** "16 → 17", with a small square before each colour. */
export function ChangeValues(props: {change: DraftChange; className?: string}) {
  const {change, className} = props;
  const value = (text: string) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {change.color && <ColorSquare color={text} />}
      <span className="truncate">{text}</span>
    </span>
  );
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground",
        className,
      )}>
      {value(change.before)}
      <span aria-label="to">→</span>
      <span className="flex min-w-0 text-foreground">
        {value(change.after)}
      </span>
    </span>
  );
}
