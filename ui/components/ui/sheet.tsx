import {cn} from "cn";
import {XIcon} from "lucide-react";
import {Dialog as SheetPrimitive} from "@base-ui/react/dialog";
import {Button} from "@/components/ui/button";

function Sheet({...props}: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({...props}: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

/** A panel that slides in from the right edge, under the toolbar. */
function SheetContent({
  className,
  children,
  ...props
}: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-background/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed top-12 right-0 bottom-0 z-50 flex w-[min(400px,calc(100%-2.5rem))] flex-col overflow-y-auto rounded-tl-xl bg-card text-base text-foreground popup transition-[opacity,translate] outline-none data-ending-style:translate-x-10 data-ending-style:opacity-0 data-starting-style:translate-x-10 data-starting-style:opacity-0",
          className,
        )}
        {...props}>
        {children}
        <SheetPrimitive.Close
          data-slot="sheet-close"
          render={
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            />
          }>
          <XIcon />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

export {Sheet, SheetContent, SheetTrigger};
