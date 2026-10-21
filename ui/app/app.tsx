import {Activity} from "react";
import {TooltipProvider} from "@/components/ui/tooltip";
import {ThemesView} from "@/features/themes";
import {showsSetup, useStore} from "@/lib/store";
import {BottomBar} from "./bottom-bar";
import {CloseDialog} from "./close-dialog";
import {CommandPalette} from "./command-palette";
import {CustomiseView} from "./customise";
import {useGlobalKeys} from "./global-keys";
import {Header} from "./header";
import {NoticeLine} from "./notices";
import {SaveSheet} from "./save-sheet";
import {SaveThemeDialog} from "./save-theme-dialog";
import {SetupCard} from "./setup-card";

export function App() {
  const loaded = useStore((store) => store.snapshot !== null);
  const failure = useStore((store) => store.failure);

  if (!loaded) {
    return (
      <main
        role={failure === null ? undefined : "alert"}
        className="flex h-full items-center justify-center p-6 text-sm text-fg-3">
        {failure ?? "Loading…"}
      </main>
    );
  }
  return (
    <TooltipProvider delay={400}>
      <Shell />
    </TooltipProvider>
  );
}

/**
 * Header, the two views (or the live preview setup) and the bottom bar. Both
 * views stay mounted, also behind the setup, so each keeps its scroll and its
 * own state, such as the font search.
 */
function Shell() {
  useGlobalKeys();
  const view = useStore((store) => store.view);
  const setup = useStore(showsSetup);

  return (
    <div className="flex h-full flex-col bg-app">
      <Header />
      <main className="relative flex min-h-0 flex-1 flex-col">
        <Activity mode={!setup && view === "customise" ? "visible" : "hidden"}>
          <CustomiseView />
        </Activity>
        <Activity mode={!setup && view === "themes" ? "visible" : "hidden"}>
          <ThemesView />
        </Activity>
        {setup && <SetupCard />}
        <NoticeLine />
      </main>
      <BottomBar />
      <CommandPalette />
      <SaveSheet />
      <SaveThemeDialog />
      <CloseDialog />
    </div>
  );
}
