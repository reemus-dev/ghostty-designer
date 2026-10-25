import {flushSync} from "react-dom";
import type {NotShowing} from "@/core/preview";
import type {SlotId} from "./slots";
import {
  clearThemeFilters,
  getStore,
  setColor,
  setSetupLater,
  setTheme,
  setView,
  showsSetup,
} from "./store";

export const VIEWS = ["customise", "themes"] as const;

export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  customise: "Customise",
  themes: "Themes",
};

/** Why the draft does not show, in the views' words. */
export const NOT_SHOWING_TEXT: Record<NotShowing, string> = {
  "not-installed": "Shows in Ghostty after you save",
  paused: "Ghostty shows your saved config",
  rejected: "Ghostty didn't accept this",
  shadowed: "Partly hidden",
};

/**
 * Shows a view, putting off the setup card if it shows. It renders before this
 * returns, so callers can scroll to and focus elements in it.
 */
export function showView(view: View) {
  const store = getStore();
  const setup = showsSetup(store);
  if (!setup && store.view === view) return;
  flushSync(() => {
    if (setup) setSetupLater(true);
    setView(view);
  });
}

/**
 * Shows Customise and scrolls one of its sections to the top. Returns it to
 * focus.
 */
export function revealSection(id: string) {
  showView("customise");
  const section = document.querySelector<HTMLElement>(
    `[data-customise] #${CSS.escape(id)}`,
  );
  section?.scrollIntoView({block: "start"});
  return section;
}

/**
 * Shows Customise and scrolls a setting's row (its `data-option` key) into
 * view. Returns its control to focus. The colours and font-family have no row:
 * they go to their swatch and to the font list.
 */
export function revealOption(key: string) {
  showView("customise");
  const row = document.querySelector<HTMLElement>(
    `[data-customise] [data-option="${CSS.escape(key)}"]`,
  );
  if (row) {
    row.scrollIntoView({block: "center"});
    // The label before the control is focusable too, for its tooltip. A value
    // field beats the − / + buttons around it.
    const control = row.querySelector("[data-option-control]");
    return (
      control?.querySelector<HTMLElement>("input, [role=slider]") ??
      control?.querySelector<HTMLElement>(
        "button:not(:disabled), [tabindex='0']",
      ) ??
      row
    );
  }
  if (key === "font-family") {
    const list = document.querySelector<HTMLElement>(
      "[data-customise] #font [role=listbox]",
    );
    list?.scrollIntoView({block: "center"});
    return list ?? revealSection("font");
  }
  return revealColor(key === "palette" ? "palette:0" : key);
}

/**
 * Shows Customise, selects a colour's swatch (its `data-color` slot, such as
 * "palette:1") and scrolls it into view. Returns the colour editor's hex field
 * to focus.
 */
export function revealColor(id: SlotId) {
  showView("customise");
  const swatch = document.querySelector<HTMLElement>(
    `[data-customise] [data-color="${CSS.escape(id)}"]`,
  );
  if (!swatch) return null;
  // The editor renders new fields for the colour, so render before returning one.
  flushSync(() => setColor(id));
  swatch.scrollIntoView({block: "center"});
  return (
    document.querySelector<HTMLElement>(
      "[data-customise] #colors [data-hex-field]",
    ) ?? swatch
  );
}

const themeCard = (name: string) =>
  document.querySelector<HTMLElement>(
    `[data-theme-card][data-theme="${CSS.escape(name)}"]`,
  );

/**
 * Shows Themes with a theme in its detail panel, clearing a search or filters
 * that hide its card, and scrolls the card into view. Returns the card to
 * focus.
 */
export function revealTheme(name: string) {
  showView("themes");
  flushSync(() => {
    if (!themeCard(name)) clearThemeFilters();
    setTheme(name);
  });
  const card = themeCard(name);
  card?.scrollIntoView({block: "center"});
  return card;
}
