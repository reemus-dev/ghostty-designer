// oxlint-disable max-lines -- the curated options table
import type {Control, OptionMeta} from "./types";

/**
 * The curated appearance options, and the whitelist of keys a draft may set.
 * Omitted fields default to non-repeatable, live reload, both platforms. Reload
 * classes were verified against the Ghostty 1.4.0 source.
 */
type OptionDef = Pick<OptionMeta, "key" | "group" | "label" | "control"> &
  Partial<
    Pick<OptionMeta, "repeatable" | "reload" | "reloadNote" | "platforms">
  >;

const CELL_COLOR: Control = {
  kind: "color",
  keywords: ["cell-foreground", "cell-background"],
};
const OSC_COLORS_NOTE =
  "A program that changes colours while running (OSC 4, 10, 11) keeps them until it resets them.";
const UNFOCUSED_CURSOR_NOTE = "Unfocused windows show a hollow block.";
const CURSOR_SHAPE_NOTE = `${UNFOCUSED_CURSOR_NOTE} At the prompt, shell integration shows a bar unless “Use this cursor at the shell prompt” is on. Programs can change the shape until they reset it.`;
const GHOSTTY_THEME_NOTE = "Only used with window-theme = ghostty.";
const PADDING_NOTE =
  "Applies to new tabs and splits, or right away with Balance padding on.";

export const OPTIONS: readonly OptionDef[] = [
  {
    key: "background",
    group: "colors",
    label: "Background",
    control: {kind: "color"},
    reloadNote: OSC_COLORS_NOTE,
  },
  {
    key: "foreground",
    group: "colors",
    label: "Text",
    control: {kind: "color"},
    reloadNote: OSC_COLORS_NOTE,
  },
  {
    key: "palette",
    group: "palette",
    label: "Palette",
    control: {kind: "color"},
    repeatable: true,
    reloadNote: OSC_COLORS_NOTE,
  },
  {
    key: "palette-generate",
    group: "palette",
    label: "Generate 256-colour palette",
    control: {kind: "bool"},
  },
  {
    key: "palette-harmonious",
    group: "palette",
    label: "Harmonious palette",
    control: {kind: "bool"},
  },
  {
    key: "bold-color",
    group: "colors",
    label: "Bold",
    control: {kind: "color", keywords: ["bright"]},
  },
  {
    key: "faint-opacity",
    group: "colors",
    label: "Faint opacity",
    control: {kind: "number", min: 0, max: 1, step: 0.01},
  },
  {
    key: "minimum-contrast",
    group: "colors",
    label: "Minimum contrast",
    control: {kind: "number", min: 1, max: 21, step: 0.1},
  },
  {
    key: "selection-foreground",
    group: "colors",
    label: "Selection text",
    control: CELL_COLOR,
  },
  {
    key: "selection-background",
    group: "colors",
    label: "Selection",
    control: CELL_COLOR,
  },
  {
    key: "search-foreground",
    group: "colors",
    label: "Search text",
    control: CELL_COLOR,
  },
  {
    key: "search-background",
    group: "colors",
    label: "Search background",
    control: CELL_COLOR,
  },
  {
    key: "search-selected-foreground",
    group: "colors",
    label: "Selected search text",
    control: CELL_COLOR,
  },
  {
    key: "search-selected-background",
    group: "colors",
    label: "Selected search background",
    control: CELL_COLOR,
  },
  {
    key: "cursor-color",
    group: "cursor",
    label: "Cursor",
    control: CELL_COLOR,
    reloadNote:
      "A program that sets the cursor colour (OSC 12) keeps it until it resets it.",
  },
  {
    key: "cursor-text",
    group: "cursor",
    label: "Cursor text",
    control: CELL_COLOR,
    reloadNote: UNFOCUSED_CURSOR_NOTE,
  },
  {
    key: "cursor-opacity",
    group: "cursor",
    label: "Cursor opacity",
    control: {kind: "number", min: 0, max: 1, step: 0.01},
    reloadNote: UNFOCUSED_CURSOR_NOTE,
  },
  {
    key: "cursor-style",
    group: "cursor",
    label: "Cursor style",
    control: {
      kind: "enum",
      values: ["block", "bar", "underline", "block_hollow"],
    },
    reload: "special",
    reloadNote: CURSOR_SHAPE_NOTE,
  },
  {
    key: "cursor-style-blink",
    group: "cursor",
    label: "Cursor blink",
    // Blank blinks too, but follows DEC mode 12, which true and false ignore
    // (src/config/Config.zig:885-902).
    control: {kind: "enum", values: ["", "true", "false"]},
    reload: "special",
    reloadNote: CURSOR_SHAPE_NOTE,
  },
  {
    key: "shell-integration-features",
    group: "cursor",
    label: "Cursor at the shell prompt",
    control: {kind: "flags"},
    // Shells read the features when they start (src/termio/Exec.zig:773-777).
    reload: "new-surface",
  },
  {
    key: "adjust-cursor-thickness",
    group: "cursor",
    label: "Cursor thickness",
    control: {kind: "metric"},
  },
  {
    key: "adjust-cursor-height",
    group: "cursor",
    label: "Cursor height",
    control: {kind: "metric"},
  },
  {
    key: "font-family",
    group: "fonts",
    label: "Font family",
    control: {kind: "font-family"},
    repeatable: true,
  },
  {
    key: "font-family-bold",
    group: "fonts",
    label: "Bold font family",
    control: {kind: "font-family"},
    repeatable: true,
  },
  {
    key: "font-family-italic",
    group: "fonts",
    label: "Italic font family",
    control: {kind: "font-family"},
    repeatable: true,
  },
  {
    key: "font-family-bold-italic",
    group: "fonts",
    label: "Bold italic font family",
    control: {kind: "font-family"},
    repeatable: true,
  },
  {
    key: "font-style",
    group: "fonts",
    label: "Font style",
    control: {kind: "text"},
  },
  {
    key: "font-style-bold",
    group: "fonts",
    label: "Bold font style",
    control: {kind: "text"},
  },
  {
    key: "font-style-italic",
    group: "fonts",
    label: "Italic font style",
    control: {kind: "text"},
  },
  {
    key: "font-style-bold-italic",
    group: "fonts",
    label: "Bold italic font style",
    control: {kind: "text"},
  },
  {
    key: "font-synthetic-style",
    group: "fonts",
    label: "Synthetic styles",
    control: {kind: "flags"},
  },
  {
    key: "font-size",
    group: "fonts",
    label: "Font size",
    control: {kind: "number", min: 4, max: 96, step: 0.5, unit: "pt"},
    reload: "special",
    reloadNote: "Applies to every terminal and resets per-window zoom.",
  },
  {
    key: "font-feature",
    group: "fonts",
    label: "Font feature",
    control: {kind: "text"},
    repeatable: true,
  },
  {
    key: "font-variation",
    group: "fonts",
    label: "Font variation",
    control: {kind: "text"},
    repeatable: true,
  },
  {
    key: "font-variation-bold",
    group: "fonts",
    label: "Bold font variation",
    control: {kind: "text", placeholder: "wght=700"},
    repeatable: true,
  },
  {
    key: "font-variation-italic",
    group: "fonts",
    label: "Italic font variation",
    control: {kind: "text", placeholder: "wght=700"},
    repeatable: true,
  },
  {
    key: "font-variation-bold-italic",
    group: "fonts",
    label: "Bold italic font variation",
    control: {kind: "text", placeholder: "wght=700"},
    repeatable: true,
  },
  {
    key: "font-codepoint-map",
    group: "fonts",
    label: "Codepoint font map",
    control: {kind: "text"},
    repeatable: true,
  },
  {
    key: "font-thicken",
    group: "fonts",
    label: "Thicken",
    control: {kind: "bool"},
    platforms: ["macos"],
  },
  {
    key: "font-thicken-strength",
    group: "fonts",
    label: "Thicken strength",
    control: {kind: "number", min: 0, max: 255, step: 1},
    platforms: ["macos"],
  },
  {
    key: "font-shaping-break",
    group: "fonts",
    label: "Shaping break",
    control: {kind: "text"},
  },
  {
    key: "alpha-blending",
    group: "fonts",
    label: "Alpha blending",
    control: {kind: "enum", values: ["native", "linear", "linear-corrected"]},
  },
  {
    key: "freetype-load-flags",
    group: "fonts",
    label: "FreeType load flags",
    control: {kind: "text"},
    platforms: ["linux"],
  },
  {
    key: "grapheme-width-method",
    group: "fonts",
    label: "Grapheme width method",
    control: {kind: "enum", values: ["legacy", "unicode"]},
    reload: "new-surface",
  },
  {
    key: "adjust-cell-width",
    group: "font-metrics",
    label: "Letter spacing",
    control: {kind: "metric"},
  },
  {
    key: "adjust-cell-height",
    group: "font-metrics",
    label: "Line height",
    control: {kind: "metric"},
  },
  {
    key: "adjust-font-baseline",
    group: "font-metrics",
    label: "Font baseline",
    control: {kind: "metric"},
  },
  {
    key: "adjust-underline-position",
    group: "font-metrics",
    label: "Underline position",
    control: {kind: "metric"},
  },
  {
    key: "adjust-underline-thickness",
    group: "font-metrics",
    label: "Underline thickness",
    control: {kind: "metric"},
  },
  {
    key: "adjust-strikethrough-position",
    group: "font-metrics",
    label: "Strikethrough position",
    control: {kind: "metric"},
  },
  {
    key: "adjust-strikethrough-thickness",
    group: "font-metrics",
    label: "Strikethrough thickness",
    control: {kind: "metric"},
  },
  {
    key: "adjust-overline-position",
    group: "font-metrics",
    label: "Overline position",
    control: {kind: "metric"},
  },
  {
    key: "adjust-overline-thickness",
    group: "font-metrics",
    label: "Overline thickness",
    control: {kind: "metric"},
  },
  {
    key: "adjust-box-thickness",
    group: "font-metrics",
    label: "Box thickness",
    control: {kind: "metric"},
  },
  {
    key: "adjust-icon-height",
    group: "font-metrics",
    label: "Icon height",
    control: {kind: "metric"},
  },
  {
    key: "background-opacity",
    group: "background",
    label: "Background opacity",
    control: {kind: "number", min: 0, max: 1, step: 0.01},
    reloadNote:
      "On macOS, a change may show only in a new window or after a Ghostty restart.",
  },
  {
    key: "background-opacity-cells",
    group: "background",
    label: "Opacity applies to cell backgrounds",
    control: {kind: "bool"},
  },
  {
    key: "background-blur",
    group: "background",
    label: "Background blur",
    control: {kind: "text"},
    reloadNote:
      "Glass needs macOS 26 or later. A transparent or tabs titlebar changes only in new windows.",
  },
  {
    key: "window-padding-x",
    group: "window",
    label: "Horizontal padding",
    control: {kind: "text"},
    reload: "new-surface",
    reloadNote: PADDING_NOTE,
  },
  {
    key: "window-padding-y",
    group: "window",
    label: "Vertical padding",
    control: {kind: "text"},
    reload: "new-surface",
    reloadNote: PADDING_NOTE,
  },
  {
    key: "window-padding-balance",
    group: "window",
    label: "Balance padding",
    control: {kind: "enum", values: ["false", "true", "equal"]},
    reload: "special",
    reloadNote:
      "Equal centres the grid and needs Ghostty 1.4. Turning it off keeps the balanced padding until a new tab or split opens.",
  },
  {
    key: "window-padding-color",
    group: "window",
    label: "Padding colour",
    control: {kind: "enum", values: ["background", "extend", "extend-always"]},
  },
  {
    key: "unfocused-split-opacity",
    group: "splits",
    label: "Unfocused split opacity",
    control: {kind: "number", min: 0.15, max: 1, step: 0.01},
  },
  {
    key: "unfocused-split-fill",
    group: "splits",
    label: "Unfocused split fill",
    control: {kind: "color"},
  },
  {
    key: "split-divider-color",
    group: "splits",
    label: "Split divider colour",
    control: {kind: "color"},
  },
  {
    key: "drag-handle",
    group: "splits",
    label: "Split drag handle",
    control: {kind: "enum", values: ["always", "auto", "never"]},
  },
  {
    key: "window-theme",
    group: "window",
    label: "Window theme",
    control: {
      kind: "enum",
      values: ["auto", "system", "light", "dark", "ghostty"],
    },
  },
  {
    key: "window-colorspace",
    group: "window",
    label: "Colour space",
    control: {kind: "enum", values: ["srgb", "display-p3"]},
    platforms: ["macos"],
  },
  {
    key: "window-decoration",
    group: "window",
    label: "Decoration",
    control: {kind: "enum", values: ["auto", "client", "server", "none"]},
    reload: "new-window",
  },
  {
    key: "window-title-font-family",
    group: "window",
    label: "Title font family",
    control: {kind: "font-family"},
  },
  {
    key: "window-subtitle",
    group: "window",
    label: "Subtitle",
    control: {kind: "enum", values: ["false", "working-directory"]},
    platforms: ["linux"],
  },
  {
    key: "window-titlebar-background",
    group: "window",
    label: "Titlebar background",
    control: {kind: "color"},
    reloadNote: GHOSTTY_THEME_NOTE,
    platforms: ["linux"],
  },
  {
    key: "window-titlebar-foreground",
    group: "window",
    label: "Titlebar text",
    control: {kind: "color"},
    reloadNote: GHOSTTY_THEME_NOTE,
    platforms: ["linux"],
  },
  {
    key: "window-vsync",
    group: "window",
    label: "VSync",
    control: {kind: "bool"},
    reload: "new-surface",
    platforms: ["macos"],
  },
  {
    key: "window-show-tab-bar",
    group: "window",
    label: "Show tab bar",
    control: {kind: "enum", values: ["always", "auto", "never"]},
    platforms: ["linux"],
  },
  {
    key: "window-height",
    group: "window",
    label: "Initial height",
    control: {kind: "number", min: 0, step: 1, unit: "cells"},
    reload: "new-window",
  },
  {
    key: "window-width",
    group: "window",
    label: "Initial width",
    control: {kind: "number", min: 0, step: 1, unit: "cells"},
    reload: "new-window",
  },
  {
    key: "scrollbar",
    group: "window",
    label: "Scrollbar",
    control: {kind: "enum", values: ["system", "never"]},
  },
  {
    key: "resize-overlay",
    group: "window",
    label: "Resize overlay",
    control: {kind: "enum", values: ["always", "never", "after-first"]},
  },
  {
    key: "resize-overlay-position",
    group: "window",
    label: "Resize overlay position",
    control: {
      kind: "enum",
      values: [
        "center",
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ],
    },
  },
  {
    key: "resize-overlay-duration",
    group: "window",
    label: "Resize overlay duration",
    control: {kind: "text"},
  },
  {
    key: "macos-titlebar-style",
    group: "window",
    label: "Titlebar style",
    control: {
      kind: "enum",
      values: ["native", "transparent", "tabs", "hidden"],
    },
    reload: "new-window",
    platforms: ["macos"],
  },
  {
    key: "macos-window-buttons",
    group: "window",
    label: "Window buttons",
    control: {kind: "enum", values: ["visible", "hidden"]},
    reload: "new-window",
    platforms: ["macos"],
  },
  {
    key: "macos-titlebar-proxy-icon",
    group: "window",
    label: "Titlebar proxy icon",
    control: {kind: "enum", values: ["visible", "hidden"]},
    reload: "special",
    reloadNote: "Applies when the working directory next changes.",
    platforms: ["macos"],
  },
  {
    key: "macos-window-shadow",
    group: "window",
    label: "Window shadow",
    control: {kind: "bool"},
    platforms: ["macos"],
  },
  {
    key: "macos-non-native-fullscreen",
    group: "window",
    label: "Non-native fullscreen",
    control: {
      kind: "enum",
      values: ["false", "true", "visible-menu", "padded-notch"],
    },
    reload: "special",
    reloadNote: "Applies on the next fullscreen toggle.",
    platforms: ["macos"],
  },
  {
    key: "macos-icon",
    group: "window",
    label: "Icon",
    control: {
      kind: "enum",
      values: [
        "official",
        "blueprint",
        "chalkboard",
        "glass",
        "holographic",
        "microchip",
        "paper",
        "retro",
        "xray",
        "custom",
        "custom-style",
      ],
    },
    reloadNote:
      "Custom style needs a ghost and a screen colour. Without them, the official icon shows.",
    platforms: ["macos"],
  },
  {
    key: "macos-custom-icon",
    group: "window",
    label: "Icon file",
    control: {kind: "text", placeholder: "~/.config/ghostty/Ghostty.icns"},
    platforms: ["macos"],
  },
  {
    key: "macos-icon-frame",
    group: "window",
    label: "Frame",
    control: {
      kind: "enum",
      values: ["aluminum", "beige", "plastic", "chrome"],
    },
    platforms: ["macos"],
  },
  {
    key: "macos-icon-ghost-color",
    group: "window",
    label: "Ghost colour",
    control: {kind: "color"},
    reloadNote:
      "Ghostty keeps the ghost light, so a colour shows as a pale tint.",
    platforms: ["macos"],
  },
  {
    key: "macos-icon-screen-color",
    group: "window",
    label: "Screen colours",
    control: {kind: "text", placeholder: "#1c1c1c,#3a6ea5"},
    platforms: ["macos"],
  },
  {
    key: "gtk-titlebar",
    group: "window",
    label: "Titlebar",
    control: {kind: "bool"},
    platforms: ["linux"],
  },
  {
    key: "gtk-tabs-location",
    group: "window",
    label: "Tab bar position",
    control: {kind: "enum", values: ["top", "bottom"]},
    platforms: ["linux"],
  },
  {
    key: "gtk-titlebar-hide-when-maximized",
    group: "window",
    label: "Hide titlebar when maximised",
    control: {kind: "bool"},
    platforms: ["linux"],
  },
  {
    key: "gtk-toolbar-style",
    group: "window",
    label: "Toolbar style",
    control: {kind: "enum", values: ["flat", "raised", "raised-border"]},
    platforms: ["linux"],
  },
  {
    key: "gtk-titlebar-style",
    group: "window",
    // Not "(Linux)": it sits in the "Linux only" card on macOS.
    label: "GTK titlebar style",
    control: {kind: "enum", values: ["native", "tabs"]},
    platforms: ["linux"],
  },
  {
    key: "gtk-wide-tabs",
    group: "window",
    label: "Wide tabs",
    control: {kind: "bool"},
    platforms: ["linux"],
  },
  {
    key: "gtk-tabs-inverted",
    group: "window",
    label: "Close button at tab start",
    control: {kind: "bool"},
    platforms: ["linux"],
  },
];

/** Listed values that capitalising alone would misspell. */
const VALUE_LABELS: Record<string, string> = {
  srgb: "sRGB",
  "display-p3": "Display P3",
};

/**
 * How an enum value reads: Ghostty's own words, capitalised, with spaces for
 * dashes and underscores. A value the option doesn't list shows as written.
 */
export function enumLabel(values: readonly string[], value: string) {
  if (!values.includes(value)) return value;
  return (
    VALUE_LABELS[value] ??
    value.charAt(0).toUpperCase() + value.slice(1).replaceAll(/[-_]/g, " ")
  );
}
