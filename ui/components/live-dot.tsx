import {cn} from "cn";

/** The green dot of what Ghostty shows now. */
export function LiveDot(props: {className?: string}) {
  return (
    <i
      aria-hidden
      className={cn(
        "size-[7px] shrink-0 rounded-full bg-live ring-3 ring-live/16",
        props.className,
      )}
    />
  );
}
