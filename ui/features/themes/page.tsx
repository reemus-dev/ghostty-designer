import type {ReactNode} from "react";
import {PanelRightOpenIcon} from "lucide-react";
import {Truncate} from "@/components/truncate";
import {Sheet, SheetContent, SheetTrigger} from "@/components/ui/sheet";
import {MD, useMediaQuery} from "@/lib/media";

/**
 * Themes' body: the filter row, which sticks while the content scrolls at a
 * readable width unless its wrapped rows would crowd a narrow window, and the
 * detail of the focused card. The detail is a side panel when wide, and a sheet
 * behind a bar docked under the cards that names the card when narrow.
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
      <div data-themes className="min-w-0 overflow-y-auto">
        <div className="z-10 bg-background md:sticky md:top-0">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-4 pt-6 pb-3 sm:px-8">
            {filter}
          </div>
        </div>
        <div className="mx-auto max-w-[1100px] px-4 pb-6 sm:px-8">
          {children}
        </div>
        {!wide && (
          <Sheet>
            <SheetTrigger
              aria-label={`${focused} details`}
              className="sticky bottom-0 flex h-12 w-full items-center gap-3 border-t bg-card px-4 hover:bg-accent sm:px-8">
              <Truncate className="min-w-0 font-medium">{focused}</Truncate>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                Details
                <PanelRightOpenIcon aria-hidden className="size-4" />
              </span>
            </SheetTrigger>
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
