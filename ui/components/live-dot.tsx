import {cn} from "cn";

/** The green dot of what Ghostty shows now. */
export function LiveDot(props: {className?: string}) {
  return (
    <i
      aria-hidden
      className={cn(
        "size-[7px] shrink-0 rounded-full bg-live shadow-live",
        props.className,
      )}
    />
  );
}
