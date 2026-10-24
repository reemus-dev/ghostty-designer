import type {ComponentPropsWithoutRef, ReactNode} from "react";
import {cn} from "cn";
import {SearchIcon} from "lucide-react";
import {Kbd} from "@/components/ui/kbd";
import {SECTION_TITLE, type SectionId} from "@/lib/customise";

/**
 * One of Customise's stacked sections: a heading row with its title, a
 * plain-words summary and actions, then its cards. The id is the ⌘K target.
 */
export function PageSection(props: {
  id: SectionId;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const {id, summary, actions, children} = props;
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-6 flex-col gap-4 outline-none">
      <header className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2
            id={`${id}-title`}
            className="text-xl font-semibold tracking-[-0.015em]">
            {SECTION_TITLE[id]}
          </h2>
          {summary !== undefined && (
            <div className="text-muted-foreground">{summary}</div>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * The page's one search field. `/` focuses it from anywhere. Esc clears it
 * first, then leaves it.
 */
export function PageFilter(
  props: Omit<ComponentPropsWithoutRef<"input">, "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  },
) {
  const {value, onValueChange, className, ...rest} = props;
  return (
    <label
      className={cn(
        "flex h-[30px] min-w-40 flex-1 items-center gap-2 rounded-lg bg-muted pr-1.5 pl-2.5 text-muted-foreground inset-ring inset-ring-input has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-focus-visible:inset-ring-ring",
        className,
      )}>
      <SearchIcon aria-hidden className="size-3.5 shrink-0" />
      {/* The wrapping label has no text of its own, so name the field. */}
      <input
        aria-label={rest.placeholder}
        {...rest}
        data-page-filter
        type="search"
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (value !== "" && event.key === "Escape") {
            event.preventDefault();
            onValueChange("");
          }
          rest.onKeyDown?.(event);
        }}
      />
      <Kbd aria-hidden>/</Kbd>
    </label>
  );
}
