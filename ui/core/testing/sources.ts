// Sources for unit tests of the session's rules: a small catalog, one config
// file, the values Ghostty reports for it, and bundled themes.
import {buildCatalog} from "@/core/catalog";
import {parseConfig} from "@/core/config-file";
import type {Sources} from "@/core/resolve";
import {themeLibrary} from "@/core/theme-library";
import type {Values} from "@/core/types";

/**
 * The base palette: Ghostty sets all 16 by default, and themeColors relies on
 * it.
 */
const PALETTE = ["#1d1f21", "#cc6666", "#b5bd68"].concat(
  Array.from(
    {length: 13},
    (_, i) => `#0000${(i + 3).toString(16).padStart(2, "0")}`,
  ),
);

/** A cut of `ghostty +show-config --default` with the keys the tests use. */
export const DEFAULTS = `
background = #282c34
foreground = #ffffff
cursor-color =
cursor-text =
selection-background =
selection-foreground =
${PALETTE.map((hex, i) => `palette = ${i}=${hex}`).join("\n")}
font-family =
font-feature =
font-size = 13
shell-integration-features = cursor,no-sudo,title
`;

export const CATALOG = buildCatalog(DEFAULTS);

/**
 * `saved` is what `+show-config` would report for `config`: tests that rely on
 * the saved values spell them out.
 */
export function sources({
  config = "",
  saved = {},
  themes = {},
}: {
  config?: string;
  saved?: Values;
  themes?: Record<string, string>;
}): Sources {
  return {
    catalog: CATALOG,
    files: [parseConfig("/config", config)],
    saved,
    library: themeLibrary(
      Object.entries(themes).map(([name, text]) => ({
        name,
        source: "bundled",
        text,
      })),
      CATALOG.colorDefaults,
    ),
  };
}
