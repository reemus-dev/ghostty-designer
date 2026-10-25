import {Activity} from "react";
import {TooltipProvider} from "@/components/ui/tooltip";
import {ThemesView} from "@/features/themes";
import {showsSetup, useStore} from "@/lib/store";
import {CloseDialog} from "./close-dialog";
import {CommandPalette} from "./command-palette";
import {CustomiseView} from "./customise";
import {useGlobalKeys} from "./global-keys";
import {NoticeLine} from "./notices";
import {Rail} from "./rail";
import {SaveSheet} from "./save-sheet";
import {SaveThemeDialog} from "./save-theme-dialog";
import {SetupCard} from "./setup-card";
import {Toolbar} from "./toolbar";

export function App() {
  const loaded = useStore((store) => store.snapshot !== null);
  const failure = useStore((store) => store.failure);

  if (!loaded) {
    return (
      <main
        role={failure === null ? undefined : "alert"}
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {failure ?? "Loading…"}
      </main>
    );
  }
  return (
    <TooltipProvider delay={250}>
      <Shell />
    </TooltipProvider>
  );
}

/**
 * The toolbar across the top and the rail down the left, on one surface that
 * meets the content at a rounded corner. The content shows the two views or the
 * live preview setup. Both views stay mounted, also behind the setup, so each
 * keeps its scroll and its own state, such as the font search.
 */
function Shell() {
  useGlobalKeys();
  const view = useStore((store) => store.view);
  const setup = useStore(showsSetup);

  return (
    <div className="grid h-full grid-cols-[56px_minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)] bg-card">
      <TooltipProvider delay={50}>
        <Toolbar />
        <Rail />
      </TooltipProvider>
      <main className="relative flex min-h-0 flex-col overflow-hidden rounded-tl-xl bg-background after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-tl-xl after:shadow-[inset_1px_1px_0_var(--color-border)]">
        <Activity mode={!setup && view === "customise" ? "visible" : "hidden"}>
          <CustomiseView />
        </Activity>
        <Activity mode={!setup && view === "themes" ? "visible" : "hidden"}>
          <ThemesView />
        </Activity>
        {setup && <SetupCard />}
        <NoticeLine />
      </main>
      <CommandPalette />
      <SaveSheet />
      <SaveThemeDialog />
      <CloseDialog />
    </div>
  );
}
