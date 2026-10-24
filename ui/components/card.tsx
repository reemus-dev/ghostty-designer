import type {ReactNode} from "react";
import {cn} from "cn";

/** A titled card on a page. `aside` is a plain-words summary under the title. */
export function Card(props: {
  label: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const {label, aside, className, children} = props;
  return (
    <section className={cn("flex flex-col gap-5 card p-6", className)}>
      <header className="flex flex-col gap-[3px]">
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{label}</h3>
        {aside !== undefined && (
          <div className="text-sm text-muted-foreground">{aside}</div>
        )}
      </header>
      {children}
    </section>
  );
}
