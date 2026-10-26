import {type ReactNode, useEffect, useRef, useState} from "react";
import {RotateCwIcon} from "lucide-react";
import {Chip} from "@/components/chip";
import {IconButton} from "@/components/icon-button";
import {LiveDot} from "@/components/live-dot";
import {PageFilter, PageSection} from "@/components/page";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
import type {FontFamily} from "@/core/bindings";
import {whyNotShowing} from "@/core/preview";
import {withPrimary} from "@/core/values";
import {fontFace} from "@/lib/fonts";
import {cancelPick, DWELL_MS, schedulePick} from "@/lib/pick";
import {
  getStore,
  onHistoryMove,
  send,
  useEffective,
  useSnapshot,
} from "@/lib/store";
import {NOT_SHOWING_TEXT, useAppName} from "@/lib/views";
import {FontControls, FontMetricsAndStyles} from "./controls";
import {DEFAULT_FONT, DEFAULT_NAME, FamilyList} from "./family-list";

const EMPTY: string[] = [];
const FONT_KEYS = ["font-family"];

const FILTERS = {
  nerd: {label: "Nerd Font", test: (font: FontFamily) => font.nerd},
  ligatures: {
    label: "Ligatures",
    test: (font: FontFamily) => font.ligatures !== null,
  },
  variable: {
    label: "Variable",
    test: (font: FontFamily) => font.axes.length > 0,
  },
};

type Filter = keyof typeof FILTERS;

const ghosttyChain = () =>
  getStore().snapshot?.state.effective["font-family"] ?? EMPTY;

/**
 * The installed fonts, each drawn in its face, in a scroll box of their own
 * beside the selected font's settings. Ghostty's default font and the font in
 * the saved config are pinned first; the selected row is the font Ghostty
 * shows. Picking a font is a draft change, and picks one after another are one
 * undo step.
 */
export function FontSection() {
  const fonts = useSnapshot((snapshot) => snapshot.fonts);
  const chain = useEffective("font-family") ?? EMPTY;
  const savedFont = useSnapshot(
    (snapshot) => snapshot.state.saved["font-family"]?.[0],
  );

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  /** The row moved to whose pick Ghostty does not show yet. */
  const [cursor, setCursor] = useState<string | null>(null);
  /** The list a rescan started from: the icon spins until a new one arrives. */
  const [rescanFrom, setRescanFrom] = useState<FontFamily[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Undo, redo and discard drop a pick still waiting out its dwell.
  useEffect(() => onHistoryMove(() => setCursor(null)), []);

  const selected = cursor ?? chain[0] ?? "";
  const family = fonts?.find((font) => font.family === selected);
  const rescanning = rescanFrom !== null && rescanFrom === fonts;

  const needle = query.trim().toLowerCase();
  const matches = fonts?.filter(
    (font) =>
      font.family.toLowerCase().includes(needle) &&
      filters.every((filter) => FILTERS[filter].test(font)),
  );
  const pinned = matches?.find((font) => font.family === savedFont);
  const visible = matches
    ? [
        ...(pinned ? [pinned] : []),
        ...matches.filter((font) => font !== pinned),
      ]
    : null;
  const withDefault =
    filters.length === 0 &&
    [DEFAULT_NAME, DEFAULT_FONT].some((name) =>
      name.toLowerCase().includes(needle),
    );

  const move = (name: string, dwell: boolean) => {
    if (name === (ghosttyChain()[0] ?? "")) {
      cancelPick();
      setCursor(null);
      return;
    }
    setCursor(name);
    const pick = () => {
      void send({
        type: "set",
        key: "font-family",
        values: name ? withPrimary(getStore().snapshot!.state, name) : [],
        label: name ? `Font: ${name}` : DEFAULT_NAME,
        pick: true,
      }).then(() => setCursor((at) => (at === name ? null : at)));
    };
    schedulePick(pick, dwell ? DWELL_MS : 0);
  };

  return (
    <PageSection id="font">
      <div className="grid grid-cols-1 items-start gap-5 lg:editor-columns">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PageFilter
              aria-label="Search fonts"
              value={query}
              placeholder={
                fonts ? `Search ${fonts.length} fonts` : "Search fonts"
              }
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "Enter") return;
                event.preventDefault();
                listRef.current?.focus({preventScroll: true});
                const names = [
                  ...(withDefault ? [""] : []),
                  ...(visible ?? []).map((font) => font.family),
                ];
                const first = names[0];
                if (first !== undefined && !names.includes(selected))
                  move(first, event.key === "ArrowDown");
              }}
            />
            {/* The filters wrap as one group, under the search field. */}
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(FILTERS).map(([key, filter]) => (
                <Chip
                  key={key}
                  pressed={filters.includes(key as Filter)}
                  count={fonts?.filter(filter.test).length}
                  onPressedChange={(on) =>
                    setFilters(
                      on
                        ? [...filters, key as Filter]
                        : filters.filter((item) => item !== key),
                    )
                  }>
                  {filter.label}
                </Chip>
              ))}
              <IconButton
                label="Rescan fonts"
                disabled={fonts === null || rescanning}
                onClick={() => {
                  setRescanFrom(fonts);
                  void send({type: "rescan-fonts"});
                }}>
                <RotateCwIcon
                  className={
                    rescanning || fonts === null
                      ? "motion-safe:animate-spin"
                      : undefined
                  }
                />
              </IconButton>
            </div>
          </div>
          <FontCount shown={visible} fonts={fonts} withDefault={withDefault} />
          {/* About ten rows, or half the height when stacked so the page can
              scroll past it. The card's edge is an inset ring, which scrolled
              rows would paint over, so the rows scroll inside its padding. */}
          <div className="h-[min(420px,45vh)] card p-1.5 lg:h-[min(640px,68vh)]">
            <div className="h-full overflow-y-auto">
              <FamilyList
                families={visible}
                withDefault={withDefault}
                saved={savedFont}
                cursor={selected}
                listRef={listRef}
                empty={
                  <NoFonts
                    query={query.trim()}
                    filtered={filters.length > 0}
                    onClear={() => {
                      setQuery("");
                      setFilters([]);
                    }}
                  />
                }
                onMove={move}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-5 card p-4 sm:p-6">
          <FontHeader
            family={family}
            name={selected || DEFAULT_NAME}
            saved={selected === (savedFont ?? "")}
          />
          <FontControls family={family} />
        </div>
      </div>
      <FontMetricsAndStyles />
    </PageSection>
  );
}

/** How many fonts match, and the keys that try them while any is listed. */
function FontCount(props: {
  /** The fonts that match, null while the font scan runs. */
  shown: FontFamily[] | null;
  fonts: FontFamily[] | null;
  withDefault: boolean;
}) {
  const {shown, fonts} = props;
  const app = useAppName();
  const listed = props.withDefault || shown?.length !== 0;
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 text-sm text-muted-foreground">
      {shown
        ? `${shown.length} of ${fonts?.length ?? 0} fonts`
        : "Scanning fonts…"}
      {listed && (
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> try fonts in {app}
        </span>
      )}
    </p>
  );
}

/** The font list when nothing matches, and how to clear what hides the rest. */
function NoFonts(props: {
  query: string;
  filtered: boolean;
  onClear: () => void;
}) {
  const {query, filtered} = props;
  const withFilters = filtered ? " with these filters" : "";
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm text-muted-foreground">
      <p>
        {query
          ? `No installed font matches “${query}”${withFilters}.`
          : "No installed font matches these filters."}
      </p>
      <Button size="sm" variant="outline" onClick={props.onClear}>
        {filtered ? "Clear filters" : "Clear search"}
      </Button>
    </div>
  );
}
function FontHeader(props: {
  family: FontFamily | undefined;
  name: string;
  /** The font is the one in the saved config. */
  saved: boolean;
}) {
  const {family, name, saved} = props;
  const app = useAppName();
  const scanning = useSnapshot((snapshot) => snapshot.fonts === null);
  const notShowing = useSnapshot((snapshot) =>
    whyNotShowing(snapshot.state, FONT_KEYS),
  );
  let facts = "Not installed";
  if (family) {
    facts = [
      family.nerd && "Nerd Font",
      family.ligatures !== null && "Ligatures",
      family.axes.length > 0 && "Variable",
      `${family.faces.length} ${family.faces.length === 1 ? "style" : "styles"}`,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (scanning) {
    facts = "Scanning installed fonts…";
  } else if (name === DEFAULT_NAME) {
    facts = `${DEFAULT_FONT}, built into Ghostty`;
  }

  let status: ReactNode = (
    <>
      <LiveDot />
      Showing in {app}
    </>
  );
  if (saved) {
    status = "In your config";
  } else if (notShowing) {
    status = NOT_SHOWING_TEXT[notShowing];
  }

  return (
    <header className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {status}
        </span>
        <h3
          className="text-xl leading-tight tracking-[-0.01em] wrap-break-word"
          style={
            family
              ? {fontFamily: `"${fontFace(family)}", ui-monospace`}
              : undefined
          }>
          {name}
        </h3>
        <Truncate className="text-sm text-muted-foreground">{facts}</Truncate>
      </div>
    </header>
  );
}
