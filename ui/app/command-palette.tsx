import {type ReactNode, useMemo, useRef} from "react";
import {MoonIcon, SearchIcon, SunIcon} from "lucide-react";
import {Autocomplete} from "@base-ui/react/autocomplete";
import {Dialog} from "@base-ui/react/dialog";
import {PaletteDots} from "@/components/palette-dots";
import {Truncate} from "@/components/truncate";
import {Kbd} from "@/components/ui/kbd";
import type {FontFamily} from "@/core/bindings";
import type {SessionState, Snapshot, ThemeSummary} from "@/core/types";
import {withPrimary} from "@/core/values";
import {customiseSections, SECTION_TITLE} from "@/lib/customise";
import {ALT, MOD, SHIFT_MOD} from "@/lib/keys";
import {pickTheme} from "@/lib/pick";
import {describeSlot} from "@/lib/slots";
import {
  getStore,
  openSaveTheme,
  type Pin,
  revertAll,
  send,
  setConfigOpen,
  setPaletteOpen,
  setSaveOpen,
  stepHistory,
  togglePin,
  useStore,
} from "@/lib/store";
import {
  revealColor,
  revealOption,
  revealSection,
  revealTheme,
  showView,
  VIEW_LABEL,
  VIEWS,
} from "@/lib/views";

type Item = {
  value: string;
  label: string;
  /** Returns the element to focus once the palette closes. */
  run: () => HTMLElement | null | void;
  icon?: ReactNode;
  hint?: ReactNode;
};

type Group = {value: string; items: Item[]};

const LIMIT = 80;

/** What to do now, by the session's state and the pin. */
function actionItems(state: SessionState, pin: Pin): Item[] {
  const dirty = state.changes > 0;
  const actions: Item[] = [];
  if (dirty) {
    actions.push({
      value: "action:save",
      label: "Save to config…",
      hint: <Kbd>{MOD}S</Kbd>,
      run: () => setSaveOpen(true),
    });
  }
  actions.push({
    value: "action:save-theme",
    label: "Save as theme…",
    run: () => openSaveTheme("shown"),
  });
  if (state.history.undo.length > 0) {
    actions.push({
      value: "action:undo",
      label: "Undo",
      hint: <Kbd>{MOD}Z</Kbd>,
      run: () => stepHistory("undo"),
    });
  }
  if (state.history.redo.length > 0) {
    actions.push({
      value: "action:redo",
      label: "Redo",
      hint: <Kbd>{SHIFT_MOD}Z</Kbd>,
      run: () => stepHistory("redo"),
    });
  }
  if (dirty) {
    actions.push({
      value: "action:discard",
      label: "Discard all changes",
      hint: <Kbd>esc esc</Kbd>,
      run: revertAll,
    });
  }
  const pair = state.themePair;
  if (pair && pair.light !== pair.dark) {
    const other = state.appearance === "dark" ? "light" : "dark";
    actions.push({
      value: "action:appearance",
      label: `Show the pair's ${other} theme`,
      run: () => void send({type: "appearance", appearance: other}),
    });
  }
  actions.push(
    {
      value: "action:live-preview",
      label: "Live preview",
      hint: state.livePreview ? (
        <span className="text-xs text-muted-foreground">On</span>
      ) : undefined,
      run: () => void send({type: "live-preview", on: !state.livePreview}),
    },
    {
      value: "action:switch-config",
      label: "Switch config…",
      run: () => setConfigOpen(true),
    },
  );
  if (pin !== "unsupported") {
    actions.push({
      value: "action:pin",
      label: "Keep window on top",
      hint:
        pin === "on" ? (
          <span className="text-xs text-muted-foreground">On</span>
        ) : undefined,
      run: togglePin,
    });
  }
  return actions;
}

/** Customise's sections, and each colour and setting in them. */
function placeItems(snapshot: Snapshot) {
  const {options} = snapshot;
  const sections: Item[] = [];
  const settings: Item[] = [];
  for (const section of customiseSections(snapshot)) {
    const title = SECTION_TITLE[section.id];
    sections.push({
      value: `section:${section.id}`,
      label: title,
      hint: <span className="text-xs text-muted-foreground">Section</span>,
      run: () => revealSection(section.id),
    });
    const hint = (card: string | null) => (
      <span className="text-xs text-muted-foreground">
        {card ? `${title} · ${card}` : title}
      </span>
    );
    for (const id of section.colors) {
      settings.push({
        value: `colour:${id}`,
        label: describeSlot(id).title,
        hint: hint(null),
        run: () => revealColor(id),
      });
    }
    if (section.id === "font") {
      settings.push({
        value: "setting:font-family",
        label:
          options.find((option) => option.key === "font-family")?.label ??
          "font-family",
        hint: hint(null),
        run: () => revealOption("font-family"),
      });
    }
    for (const card of section.cards) {
      for (const option of card.options) {
        settings.push({
          value: `setting:${option.key}`,
          label: option.label,
          hint: hint(card.label),
          run: () => revealOption(option.key),
        });
      }
    }
  }
  return {sections, settings};
}

const themeItems = (themes: ThemeSummary[]): Item[] =>
  themes.map((theme) => ({
    value: `theme:${theme.name}`,
    label: theme.name,
    icon: theme.dark ? (
      <MoonIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ) : (
      <SunIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ),
    hint: (
      <PaletteDots
        colors={theme.colors.palette.slice(1, 7)}
        className="flex h-4 shrink-0 items-center gap-px rounded-sm px-1 ring-1 ring-border"
        dotClassName="size-1.5 rounded-[1px]"
        style={{background: theme.colors.background}}
      />
    ),
    run: () => {
      pickTheme(theme.name, 0);
      return revealTheme(theme.name);
    },
  }));

const fontItems = (fonts: FontFamily[] | null): Item[] =>
  (fonts ?? []).map((font) => ({
    value: `font:${font.family}`,
    label: font.family,
    hint: font.nerd ? (
      <span className="text-xs text-muted-foreground">Nerd Font</span>
    ) : undefined,
    run: () =>
      void send({
        type: "set",
        key: "font-family",
        values: withPrimary(getStore().snapshot!.state, font.family),
        label: `Font: ${font.family}`,
        pick: true,
      }),
  }));

/** Built when the palette opens, so state pushes keep the list stable. */
function buildGroups(): Group[] {
  const store = getStore();
  const snapshot = store.snapshot!;
  const views: Item[] = VIEWS.map((view, i) => ({
    value: `view:${view}`,
    label: `Go to ${VIEW_LABEL[view]}`,
    hint: <Kbd>{`${ALT}${i + 1}`}</Kbd>,
    run: () => showView(view),
  }));

  const {sections, settings} = placeItems(snapshot);
  return [
    {value: "Actions", items: actionItems(snapshot.state, store.pin)},
    {value: "Go to", items: [...views, ...sections]},
    {value: "Settings", items: settings},
    {value: "Themes", items: themeItems(snapshot.themes)},
    {value: "Fonts", items: fontItems(snapshot.fonts)},
  ].filter((group) => group.items.length > 0);
}

/** ⌘K: views, sections, settings, themes, fonts and actions in one list. */
export function CommandPalette() {
  const open = useStore((store) => store.paletteOpen);
  const groups = useMemo(() => (open ? buildGroups() : []), [open]);
  /**
   * The chosen item's focus target, or null when the palette closed without a
   * choice.
   */
  const chosen = useRef<{focus: HTMLElement | null} | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]">
          <Dialog.Popup
            aria-label="Command palette"
            className="flex max-h-[min(34rem,calc(100dvh-6rem))] w-full max-w-[540px] popup-motion flex-col overflow-hidden rounded-3xl bg-card popup outline-none"
            finalFocus={() => {
              const target = chosen.current?.focus;
              chosen.current = null;
              return target ?? true;
            }}>
            <Autocomplete.Root
              open
              inline
              keepHighlight
              items={groups}
              limit={LIMIT}
              autoHighlight="always">
              <label className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
                <SearchIcon
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
                <Autocomplete.Input
                  aria-label="Search settings, themes, fonts and actions"
                  placeholder="Search settings, themes, fonts, actions…"
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                />
                <Kbd>esc</Kbd>
              </label>
              <div className="min-h-0 flex-1 [scroll-padding-block:6px] overflow-y-auto overscroll-contain p-1.5">
                <Autocomplete.Empty>
                  <p className="px-3 py-6 text-sm text-muted-foreground">
                    Nothing matches. Try a setting such as “padding”, a theme
                    such as “gruvbox”, or a font.
                  </p>
                </Autocomplete.Empty>
                <Autocomplete.List>
                  {(group: Group) => (
                    <Autocomplete.Group
                      key={group.value}
                      items={group.items}
                      className="not-last:mb-1.5">
                      <Autocomplete.GroupLabel className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
                        {group.value}
                      </Autocomplete.GroupLabel>
                      <Autocomplete.Collection>
                        {(item: Item) => (
                          <Autocomplete.Item
                            key={item.value}
                            value={item}
                            className="flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-base text-muted-foreground outline-none select-none data-highlighted:bg-accent data-highlighted:text-foreground"
                            onClick={() => {
                              chosen.current = {focus: item.run() ?? null};
                              setPaletteOpen(false);
                            }}>
                            {item.icon}
                            <Truncate className="min-w-0 flex-1">
                              {item.label}
                            </Truncate>
                            {item.hint}
                          </Autocomplete.Item>
                        )}
                      </Autocomplete.Collection>
                    </Autocomplete.Group>
                  )}
                </Autocomplete.List>
              </div>
            </Autocomplete.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
