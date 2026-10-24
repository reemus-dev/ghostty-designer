import type {ReactNode} from "react";

/**
 * Themes' body: the filter row, which sticks while the content scrolls at a
 * readable width, and the side panel.
 */
export function Page(props: {
  filter: ReactNode;
  detail: ReactNode;
  children: ReactNode;
}) {
  const {filter, detail, children} = props;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(320px,30vw,400px)]">
      <div className="min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-app/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-8 pt-6 pb-3">
            {filter}
          </div>
        </div>
        <div className="mx-auto max-w-[1100px] px-8 pb-6">{children}</div>
      </div>
      <aside className="flex min-w-0 flex-col gap-5 overflow-y-auto border-l bg-panel p-6">
        {detail}
      </aside>
    </div>
  );
}
