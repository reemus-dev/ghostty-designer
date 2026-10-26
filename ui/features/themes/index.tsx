import {useMemo, useState} from "react";
import {
  ArrowUpDownIcon,
  CheckIcon,
  MoonIcon,
  StarIcon,
  SunIcon,
} from "lucide-react";
import {Chip} from "@/components/chip";
import {PageFilter} from "@/components/page";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {pickTheme} from "@/lib/pick";
import {
  clearThemeFilters,
  setTheme,
  setThemeFilters,
  type ThemeFilters,
  useSnapshot,
  useStore,
} from "@/lib/store";
import {revealTheme, useAppName} from "@/lib/views";
import {CurrentDetail, ThemeDetail} from "./detail";
import {type FilterCounts, filterThemes, type Sort} from "./filter";
import {Gallery} from "./gallery";
import {Page} from "./page";

const SORT_LABEL: Record<Sort, string> = {
  name: "Name",
  recent: "Recently used",
  readability: "Readability",
  hue: "Hue",
};

export function ThemesView() {
  const app = useAppName();
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const favorites = useSnapshot((snapshot) => snapshot.state.favorites);
  const recent = useSnapshot((snapshot) => snapshot.state.recentThemes);
  const themePair = useSnapshot((snapshot) => snapshot.state.themePair);
  const appearance = useSnapshot((snapshot) => snapshot.state.appearance);
  const own = useSnapshot((snapshot) => snapshot.state.own);
  const hidden = useSnapshot((snapshot) => snapshot.state.themeHidden);
  // Ghostty shows the theme setting's half for the appearance, unless the
  // config's own colour lines hide some of it. The user's own colours show
  // then, with the theme as their base.
  const named = themePair?.[appearance] ?? null;
  const currentShowing = named === null || hidden !== null;
  const showingTheme = currentShowing ? null : named;
  const baseTheme = hidden === null ? null : named;
  const match = own.colorMatch;

  const filters = useStore((store) => store.themeFilters);
  const {query} = filters;
  const [sort, setSort] = useState<Sort>("name");
  const focused = useStore((store) => store.theme);

  // The base order of every sort, so ties keep name order.
  const byName = useMemo(
    () => themes.toSorted((a, b) => a.name.localeCompare(b.name)),
    [themes],
  );

  const {shown, counts} = useMemo(
    () => filterThemes(byName, {filters, sort, favorites, recent}),
    [byName, filters, sort, favorites, recent],
  );

  const withCurrent = query === "" && !filters.favorites;
  const filtered =
    filters.mode !== "all" || filters.readable || filters.favorites;
  const mine = shown.filter((theme) => theme.source === "user");
  const sections = [
    {label: "My themes", themes: mine},
    {
      label: "Built-in",
      themes: shown.filter((theme) => theme.source !== "user"),
    },
  ].filter(
    (section, i) => section.themes.length > 0 || (i === 0 && withCurrent),
  );

  const theme =
    focused === null ? undefined : themes.find((item) => item.name === focused);
  const detail = theme ? (
    <ThemeDetail
      theme={theme}
      showing={theme.name === showingTheme}
      base={theme.name === baseTheme}
      favorite={favorites.includes(theme.name)}
    />
  ) : (
    <CurrentDetail
      colors={own.colors}
      warnings={own.warnings}
      showing={currentShowing}
      match={match}
      onPick={(name) => {
        pickTheme(name, 0);
        revealTheme(name)?.focus({preventScroll: true});
      }}
    />
  );

  return (
    <Page
      focused={theme?.name ?? "Your colours"}
      detail={detail}
      filter={
        <Filters
          total={themes.length}
          counts={counts}
          sort={sort}
          onSort={setSort}
        />
      }>
      {sections.length > 0 ? (
        <>
          <p className="flex items-center gap-1.5 pb-4 text-sm text-muted-foreground">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> try themes in {app}
          </p>
          <Gallery
            current={withCurrent ? own.colors : null}
            sections={sections}
            focused={focused}
            currentShowing={currentShowing}
            showingTheme={showingTheme}
            baseTheme={baseTheme}
            match={match}
            favorites={favorites}
            onFocus={setTheme}
          />
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl p-6 text-sm text-muted-foreground inset-ring inset-ring-border">
          <p>
            {query
              ? `No themes match “${query}”${filtered ? " with these filters" : ""}.`
              : "No themes match these filters."}
          </p>
          <Button size="sm" variant="outline" onClick={clearThemeFilters}>
            {filtered ? "Clear filters" : "Clear search"}
          </Button>
        </div>
      )}
    </Page>
  );
}

/** Search and the sort, then dark or light and the filter chips under them. */
function Filters(props: {
  total: number;
  counts: FilterCounts;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const {total, counts, sort, onSort} = props;
  const {query, mode, readable, favorites} = useStore(
    (store) => store.themeFilters,
  );
  return (
    <>
      <PageFilter
        aria-label="Search themes"
        placeholder={`Search ${total} themes`}
        value={query}
        onValueChange={(next) => setThemeFilters({query: next})}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "Enter") return;
          event.preventDefault();
          const card = document.querySelector<HTMLElement>(
            "[data-theme-card][tabindex='0']",
          );
          if (!card) return;
          card.focus();
          pickTheme(card.dataset.theme ?? null);
        }}
      />
      <Select value={sort} onValueChange={(next) => next && onSort(next)}>
        <SelectTrigger
          aria-label="Sort"
          className="border-0 bg-transparent px-1.5 text-muted-foreground">
          <ArrowUpDownIcon
            aria-hidden
            className="size-3.5 text-muted-foreground"
          />
          <SelectValue>{(value: Sort) => SORT_LABEL[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
            <SelectItem key={key} value={key}>
              {SORT_LABEL[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex basis-full flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="Dark or light"
          value={[mode]}
          onValueChange={(next) =>
            next[0] && setThemeFilters({mode: next[0] as ThemeFilters["mode"]})
          }>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <MoonIcon aria-hidden className="size-3" />
            Dark <Count>{counts.dark}</Count>
          </ToggleGroupItem>
          <ToggleGroupItem value="light">
            <SunIcon aria-hidden className="size-3" />
            Light <Count>{counts.light}</Count>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Chip
                  pressed={readable}
                  count={counts.readable}
                  onPressedChange={(next) => setThemeFilters({readable: next})}
                />
              }>
              {readable && <CheckIcon aria-hidden />}
              Readable only
            </TooltipTrigger>
            <TooltipContent>
              Only themes without readability warnings
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Chip
                  pressed={favorites}
                  count={counts.favorites}
                  onPressedChange={(next) => setThemeFilters({favorites: next})}
                />
              }>
              <StarIcon
                aria-hidden
                className={favorites ? "fill-current" : undefined}
              />
              Favourites
            </TooltipTrigger>
            <TooltipContent>
              Only your favourites. F adds or removes the focused theme.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </>
  );
}

function Count(props: {children: number}) {
  return (
    <span className="text-xs text-muted-foreground">{props.children}</span>
  );
}
