import {ColorsSection} from "@/features/colors";
import {FontSection} from "@/features/fonts";
import {WindowSection} from "@/features/window";

/** Colours, font, and window and cursor settings, stacked in one scroll. */
export function CustomiseView() {
  return (
    <div data-customise className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-14 px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
        <ColorsSection />
        <FontSection />
        <WindowSection />
      </div>
    </div>
  );
}
