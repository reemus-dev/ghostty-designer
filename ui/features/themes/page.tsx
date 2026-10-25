import type {ReactNode} from "react";
import {PanelRightOpenIcon} from "lucide-react";
import {Sheet, SheetContent, SheetTrigger} from "@/components/ui/sheet";
import {MD, useMediaQuery} from "@/lib/media";

/**
 * Themes' body: the filter row, which sticks while the content scrolls at a
 * readable width unless its wrapped rows would crowd a narrow window, and the
 * detail of the focused card. The detail is a side panel when wide, and a sheet
 * behind a button that names the card when narrow.
 */
export function Page(props: {
  filter: ReactNode;
  /** The focused card's name. */
  focused: string;
  detail: ReactNode;
  children: ReactNode;
}) {
  const {filter, focused, detail, children} = props;
  // From `md` the side panel fits beside a column of cards.
  const wide = useMediaQuery(MD);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_clamp(320px,30vw,400px)]">
      <div className="min-w-0 overflow-y-auto">
        <div className="z-10 bg-background/95 backdrop-blur-sm md:sticky md:top-0">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-4 pt-6 pb-3 sm:px-8">
            {filter}
          </div>
        </div>
        <div className="mx-auto max-w-[1100px] px-4 pb-6 sm:px-8">
          {children}
        </div>
        {!wide && (
          <Sheet>
            <div className="pointer-events-none sticky bottom-4 flex justify-end px-4">
              <SheetTrigger
                aria-label={`${focused} details`}
                className="pointer-events-auto flex h-8 max-w-full items-center gap-2 rounded-full bg-popover px-3 popup hover:bg-accent">
                <span className="truncate">{focused}</span>
                <PanelRightOpenIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </SheetTrigger>
            </div>
            <SheetContent
              aria-label={`${focused} details`}
              className="gap-5 p-6 pt-12">
              {detail}
            </SheetContent>
          </Sheet>
        )}
      </div>
      {wide && (
        <aside className="flex min-w-0 flex-col gap-5 overflow-y-auto border-l bg-card p-6">
          {detail}
        </aside>
      )}
    </div>
  );
}
