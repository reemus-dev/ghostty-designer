import {useEffect} from "react";
import {isEditable} from "@/lib/keys";
import {
  getStore,
  revertAll,
  setPaletteOpen,
  setPeek,
  setSaveOpen,
  showsSetup,
  stepHistory,
} from "@/lib/store";
import {showView, VIEWS} from "@/lib/views";

const DOUBLE_ESC_MS = 500;

/** Dialogs, menus and select popups render in portals outside the app root. */
const inPopup = (target: EventTarget | null) =>
  target instanceof Element &&
  target !== document.body &&
  target !== document.documentElement &&
  target.closest("#root") === null;

/**
 * The app-wide keys. Views handle their own keys first: a handler that calls
 * preventDefault (such as Esc clearing a search) keeps the key from here.
 *
 * - ⌘K palette, ⌘S save sheet, ⌘Z undo, ⇧⌘Z redo, Esc Esc discard
 * - Hold \ compares with saved, / focuses the view's search, ⌥1 ⌥2 views
 */
export function useGlobalKeys() {
  useEffect(() => {
    let lastEsc = 0;

    // oxlint-disable-next-line complexity -- one handler for every global shortcut, each an early return
    const onKeyDown = (event: KeyboardEvent) => {
      // The setup takes the window until it is answered.
      if (event.defaultPrevented || showsSetup(getStore())) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const {snapshot, paletteOpen, saveOpen, saveTheme} = getStore();
      // A dialog, menu or popup is open: ⌘K and ⌘S never open over it.
      const covered =
        paletteOpen || saveOpen || saveTheme !== null || inPopup(event.target);

      if (mod && key === "k") {
        event.preventDefault();
        if (paletteOpen) setPaletteOpen(false);
        else if (!covered) setPaletteOpen(true);
        return;
      }
      if (mod && key === "s") {
        event.preventDefault();
        if (!covered && (snapshot?.state.changes ?? 0) > 0) setSaveOpen(true);
        return;
      }
      if (covered) return;

      if (mod && key === "z" && !isEditable(event.target)) {
        event.preventDefault();
        stepHistory(event.shiftKey ? "redo" : "undo");
        return;
      }
      const view = event.altKey
        ? /^Digit([12])$/.exec(event.code)?.[1]
        : undefined;
      if (view && !mod) {
        event.preventDefault();
        showView(VIEWS[Number(view) - 1]!);
        return;
      }
      if (mod || event.altKey) return;

      if (event.key === "Escape") {
        if (isEditable(event.target)) {
          (event.target as HTMLElement).blur();
          return;
        }
        const now = event.timeStamp;
        if (now - lastEsc < DOUBLE_ESC_MS) {
          lastEsc = 0;
          revertAll();
        } else {
          lastEsc = now;
        }
        return;
      }
      if (isEditable(event.target)) return;

      if (event.key === "\\") {
        event.preventDefault();
        if (!event.repeat) setPeek(true);
        return;
      }
      if (event.key !== "/") return;
      // The hidden view stays mounted, so its search is in the document too.
      const filter = [
        ...document.querySelectorAll<HTMLElement>("[data-page-filter]"),
      ].find((element) => element.checkVisibility());
      if (!filter) return;
      event.preventDefault();
      filter.focus();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "\\") setPeek(false);
    };
    const onBlur = () => setPeek(false);

    addEventListener("keydown", onKeyDown);
    addEventListener("keyup", onKeyUp);
    addEventListener("blur", onBlur);
    return () => {
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      removeEventListener("blur", onBlur);
    };
  }, []);
}
