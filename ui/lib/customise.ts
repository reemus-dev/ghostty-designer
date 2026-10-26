// Customise's layout: each section's swatches and setting rows, by card in
// page order. The sections render from it and ⌘K lists it, so both show the
// same rows on the same conditions. Keys the platform lacks drop out of every
// card but Window's card for the other platform.

import type {Platform} from "@/core/bindings";
import type {OptionGroup, OptionMeta, Snapshot} from "@/core/types";
import {BASE_SLOTS, type SlotId, TERMINAL_SLOTS} from "./slots";

export const SECTION_TITLE = {
  colors: "Colours",
  font: "Font",
  window: "Window & cursor",
};

export type SectionId = keyof typeof SECTION_TITLE;

export const PLATFORM_LABEL: Record<Platform, string> = {
  macos: "macOS",
  linux: "Linux",
};

/** The keys' options the platform has, in the keys' order. */
function own(options: OptionMeta[], platform: Platform, keys: string[]) {
  return keys.flatMap((key) => {
    const option = options.find((item) => item.key === key);
    return option?.platforms.includes(platform) ? [option] : [];
  });
}

// ─── Colours ───

/** The swatches in page order: the basics, then the terminal colours. */
export const SWATCH_ORDER: SlotId[] = [
  ...BASE_SLOTS.map((slot) => slot.key),
  ...TERMINAL_SLOTS,
];

/** The option cards under the swatches. */
export const colorCards = (options: OptionMeta[], platform: Platform) => ({
  contrast: {
    label: "Contrast",
    options: own(options, platform, ["minimum-contrast", "faint-opacity"]),
  },
  extended: {
    label: "256 colours",
    options: own(options, platform, ["palette-generate", "palette-harmonious"]),
  },
});

// ─── Font ───

/**
 * Line height and letter spacing sit with the size, so they stay out of the
 * metrics card.
 */
const SIZE_KEYS = [
  "font-size",
  "adjust-cell-height",
  "adjust-cell-width",
  "font-thicken",
  "font-thicken-strength",
];
const RENDERING_KEYS = [
  "alpha-blending",
  "grapheme-width-method",
  "font-shaping-break",
  "freetype-load-flags",
];
const STYLE_KEYS = [
  "font-family-bold",
  "font-family-italic",
  "font-family-bold-italic",
  "font-style",
  "font-style-bold",
  "font-style-italic",
  "font-style-bold-italic",
  "font-variation-bold",
  "font-variation-italic",
  "font-variation-bold-italic",
  "font-synthetic-style",
];

/**
 * The size rows beside the font list, which have no card title, then the cards
 * under both. `thicken` is font-thicken's value: the strength shows only with
 * it on.
 */
export function fontCards(
  options: OptionMeta[],
  platform: Platform,
  thicken: string | undefined,
) {
  return {
    size: {
      label: null,
      options: own(
        options,
        platform,
        SIZE_KEYS.filter(
          (key) => key !== "font-thicken-strength" || thicken === "true",
        ),
      ),
    },
    metrics: {
      label: "Metrics",
      options: options.filter(
        (option) =>
          option.group === "font-metrics" &&
          !SIZE_KEYS.includes(option.key) &&
          option.platforms.includes(platform),
      ),
    },
    rendering: {
      label: "Rendering",
      options: own(options, platform, RENDERING_KEYS),
    },
    fallback: {
      label: "Fallback fonts",
      options: own(options, platform, ["font-codepoint-map"]),
    },
    styles: {
      label: "Per-style fonts",
      options: own(options, platform, STYLE_KEYS),
    },
  };
}

// ─── Window & cursor ───

const WINDOW_GROUPS = new Set<OptionGroup>([
  "window",
  "background",
  "cursor",
  "splits",
]);

/** The cards in two columns: the window's body, then cursor and chrome. */
const COLUMNS = [
  [
    {
      label: "Background",
      keys: [
        "background-opacity",
        "background-opacity-cells",
        "background-blur",
      ],
    },
    {
      label: "Padding",
      keys: [
        "window-padding-x",
        "window-padding-y",
        "window-padding-balance",
        "window-padding-color",
      ],
    },
    {
      label: "Window",
      keys: [
        "window-width",
        "window-height",
        "scrollbar",
        "window-show-tab-bar",
        "gtk-tabs-location",
        "gtk-wide-tabs",
        "macos-window-shadow",
        "macos-non-native-fullscreen",
        "window-colorspace",
        "window-vsync",
      ],
    },
    {
      label: "Resize overlay",
      keys: [
        "resize-overlay",
        "resize-overlay-position",
        "resize-overlay-duration",
      ],
    },
  ],
  [
    {
      label: "Cursor",
      keys: [
        "cursor-style",
        "cursor-style-blink",
        "shell-integration-features",
        "cursor-color",
        "cursor-text",
        "cursor-opacity",
        "adjust-cursor-thickness",
        "adjust-cursor-height",
      ],
    },
    {
      label: "Titlebar",
      keys: [
        "window-theme",
        "macos-titlebar-style",
        "gtk-titlebar",
        "gtk-titlebar-style",
        "gtk-toolbar-style",
        "gtk-titlebar-hide-when-maximized",
        "window-decoration",
        "window-title-font-family",
        "window-subtitle",
        "window-titlebar-background",
        "window-titlebar-foreground",
        "macos-window-buttons",
        "macos-titlebar-proxy-icon",
      ],
    },
    {
      label: "Splits",
      keys: [
        "unfocused-split-opacity",
        "unfocused-split-fill",
        "split-divider-color",
      ],
    },
  ],
];

/**
 * The window and cursor cards by column, then every option only for the other
 * platform in a card of its own.
 */
export function windowCards(options: OptionMeta[], platform: Platform) {
  const grouped = options.filter((option) => WINDOW_GROUPS.has(option.group));
  const other: Platform = platform === "macos" ? "linux" : "macos";
  return {
    columns: COLUMNS.map((column) =>
      column.map((card) => ({
        label: card.label,
        options: own(grouped, platform, card.keys),
      })),
    ),
    elsewhere: {
      label: `${PLATFORM_LABEL[other]} only`,
      platform: other,
      options: options.filter((option) => !option.platforms.includes(platform)),
    },
  };
}

// ─── ⌘K ───

/** A section as ⌘K lists it. */
type CustomiseSection = {
  id: SectionId;
  colors: SlotId[];
  cards: {label: string | null; options: OptionMeta[]}[];
};

/** The sections in page order. */
export function customiseSections(snapshot: Snapshot): CustomiseSection[] {
  const {options, platform, state} = snapshot;
  const window = windowCards(options, platform);
  return [
    {
      id: "colors",
      colors: SWATCH_ORDER,
      cards: Object.values(colorCards(options, platform)),
    },
    {
      id: "font",
      colors: [],
      cards: Object.values(
        fontCards(options, platform, state.effective["font-thicken"]?.[0]),
      ),
    },
    {
      id: "window",
      colors: [],
      cards: [...window.columns.flat(), window.elsewhere],
    },
  ];
}
