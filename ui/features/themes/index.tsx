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
import {MOD} from "@/lib/keys";
import {pickTheme} from "@/lib/pick";
import {
  clearThemeFilters,
  setTheme,
  setThemeFilters,
  type ThemeFilters,
  useSnapshot,
  useStore,
} from "@/lib/store";
import {revealTheme} from "@/lib/views";
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
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const favorites = useSnapshot((snapshot) => snapshot.state.favorites);
  const recent = useSnapshot((snapshot) => snapshot.state.recentThemes);
  const themePair = useSnapshot((snapshot) => snapshot.state.themePair);
  const appearance = useSnapshot((snapshot) => snapshot.state.appearance);
  const own = useSnapshot((snapshot) => snapshot.state.own);
  // Ghostty shows the theme setting's half for the appearance, and the user's
  // own colours only when no theme is set.
  const currentShowing = themePair === null;
  const showingTheme = themePair?.[appearance] ?? null;
  const match = own.colorMatch;

  const filters = useStore((store) => store.themeFilters);
  const {query, starred} = filters;
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

  const withCurrent = query === "" && !starred;
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
      detail={detail}
      filter={
        <Filters
          total={themes.length}
          counts={counts}
          sort={sort}
          onSort={setSort}
        />
      }>
      <p className="flex items-center gap-1.5 pb-4 text-sm text-muted-foreground">
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> try themes in Ghostty · <Kbd>{`${MOD}Z`}</Kbd> back to
        where you started
      </p>
      {sections.length > 0 ? (
        <Gallery
          current={withCurrent ? own.colors : null}
          sections={sections}
          focused={focused}
          currentShowing={currentShowing}
          showingTheme={showingTheme}
          match={match}
          favorites={favorites}
          onFocus={setTheme}
        />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl p-6 text-sm text-muted-foreground inset-ring inset-ring-border">
          <p>
            {query
              ? `No themes match “${query}” with these filters.`
              : "No themes match these filters."}
          </p>
          <Button size="sm" variant="outline" onClick={clearThemeFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </Page>
  );
}

/** Search, dark or light, the filter chips and the sort. */
function Filters(props: {
  total: number;
  counts: FilterCounts;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const {total, counts, sort, onSort} = props;
  const {query, mode, readable, starred} = useStore(
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
      <ToggleGroup
        aria-label="Dark or light"
        variant="segmented"
        value={[mode]}
        onValueChange={(next) =>
          next[0] && setThemeFilters({mode: next[0] as ThemeFilters["mode"]})
        }>
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="dark">
          <MoonIcon aria-hidden className="size-3 text-muted-foreground" />
          Dark <Count>{counts.dark}</Count>
        </ToggleGroupItem>
        <ToggleGroupItem value="light">
          <SunIcon aria-hidden className="size-3 text-muted-foreground" />
          Light <Count>{counts.light}</Count>
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          pressed={readable}
          count={counts.readable}
          title="Only themes whose text and colours are all easy to read"
          onPressedChange={(next) => setThemeFilters({readable: next})}>
          {readable && <CheckIcon aria-hidden />}
          Readable only
        </Chip>
        <Chip
          pressed={starred}
          count={counts.starred}
          title="Only your starred themes. F stars the focused card."
          onPressedChange={(next) => setThemeFilters({starred: next})}>
          <StarIcon
            aria-hidden
            className={starred ? "fill-current" : undefined}
          />
          Favourites
        </Chip>
        <Select value={sort} onValueChange={(next) => next && onSort(next)}>
          <SelectTrigger
            size="sm"
            aria-label="Sort"
            className="border-0 px-1.5 text-muted-foreground dark:bg-transparent">
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
      </div>
    </>
  );
}

function Count(props: {children: number}) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {props.children}
    </span>
  );
}
