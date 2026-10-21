import {ColorsSection} from "@/features/colors";
import {FontSection} from "@/features/fonts";
import {WindowSection} from "@/features/window";

/** Colours, font, and window and cursor settings, stacked in one scroll. */
export function CustomiseView() {
  return (
    <div data-customise className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-14 px-8 pt-8 pb-16">
        <ColorsSection />
        <FontSection />
        <WindowSection />
      </div>
    </div>
  );
}
