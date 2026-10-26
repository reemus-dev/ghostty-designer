import {resolveThemePair} from "@/core/theme";
import type {ThemeSummary} from "@/core/types";
import type {ThemeFilters} from "@/lib/store";

export type Sort = "name" | "recent" | "readability" | "hue";

const isReadable = (theme: ThemeSummary) => theme.warnings.length === 0;

function sortThemes(themes: ThemeSummary[], sort: Sort, recent: string[]) {
  switch (sort) {
    case "name": {
      return themes;
    }
    case "recent": {
      // A kept light/dark pair counts for both of its themes.
      const ranks = new Map<string, number>();
      for (const [index, setting] of recent.entries()) {
        const pair = resolveThemePair(setting);
        if (!pair) continue;
        for (const name of [pair.dark, pair.light]) {
          if (!ranks.has(name)) ranks.set(name, index);
        }
      }
      const rank = (name: string) => ranks.get(name) ?? Infinity;
      return themes.toSorted((a, b) => rank(a.name) - rank(b.name));
    }
    case "readability": {
      return themes.toSorted((a, b) => b.readability - a.readability);
    }
    case "hue": {
      return themes.toSorted((a, b) => (a.hue ?? 999) - (b.hue ?? 999));
    }
  }
}

/**
 * The themes the filters show, sorted, with ties in the order of `byName`. Each
 * count is what its filter would show with every other filter applied.
 */
export function filterThemes(
  byName: ThemeSummary[],
  view: {
    filters: ThemeFilters;
    sort: Sort;
    favorites: string[];
    recent: string[];
  },
) {
  const {filters, sort, favorites, recent} = view;
  const {query, mode, readable} = filters;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tests = {
    query: (theme: ThemeSummary) =>
      words.every((word) => theme.name.toLowerCase().includes(word)),
    mode: (theme: ThemeSummary) =>
      mode === "all" || theme.dark === (mode === "dark"),
    readable: (theme: ThemeSummary) => !readable || isReadable(theme),
    favorites: (theme: ThemeSummary) =>
      !filters.favorites || favorites.includes(theme.name),
  };
  type Test = keyof typeof tests;
  const passing = (skip: Test) =>
    byName.filter((theme) =>
      (Object.keys(tests) as Test[]).every(
        (test) => test === skip || tests[test](theme),
      ),
    );
  const byMode = passing("mode");
  return {
    shown: sortThemes(byMode.filter(tests.mode), sort, recent),
    counts: {
      dark: byMode.filter((theme) => theme.dark).length,
      light: byMode.filter((theme) => !theme.dark).length,
      readable: passing("readable").filter(isReadable).length,
      favorites: passing("favorites").filter((theme) =>
        favorites.includes(theme.name),
      ).length,
    },
  };
}

export type FilterCounts = ReturnType<typeof filterThemes>["counts"];
