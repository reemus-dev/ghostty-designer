import {type KeyboardEvent, memo, useEffect, useRef} from "react";
import {cn} from "cn";
import {MoonIcon, StarIcon, SunIcon, UserIcon} from "lucide-react";
import {LiveDot} from "@/components/live-dot";
import {PaletteDots} from "@/components/palette-dots";
import {Truncate} from "@/components/truncate";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {whyNotShowing} from "@/core/preview";
import {THEME_PICK_KEYS} from "@/core/theme";
import type {ColorMatch, ThemeColors, ThemeSummary} from "@/core/types";
import {neighbour} from "@/lib/keys";
import {pickTheme, type ThemeChoice} from "@/lib/pick";
import {SPECIMEN_CARD} from "@/lib/specimen";
import {getStore, send, useSnapshot} from "@/lib/store";
import {NOT_SHOWING_TEXT} from "@/lib/views";
import {SpecimenLines} from "./specimen-lines";

const MOVES: Record<string, "left" | "right" | "up" | "down" | "home" | "end"> =
  {
    ArrowLeft: "left",
    h: "left",
    ArrowRight: "right",
    l: "right",
    ArrowUp: "up",
    k: "up",
    ArrowDown: "down",
    j: "down",
    Home: "home",
    End: "end",
  };

const choiceOf = (card: HTMLElement): ThemeChoice => card.dataset.theme ?? null;

type GallerySection = {label: string; themes: ThemeSummary[]};

type GalleryProps = {
  /** The user's own colours as the first card, or null to leave it out. */
  current: ThemeColors | null;
  sections: GallerySection[];
  /** The card the panel shows. */
  focused: ThemeChoice;
  currentShowing: boolean;
  showingTheme: string | null;
  /** The theme matching or closest to the user's own colours. */
  match: ColorMatch | null;
  favorites: string[];
  onFocus: (choice: ThemeChoice) => void;
};

/**
 * Theme cards in sections, with one roving tab stop. A click or the arrow keys
 * (and hjkl) pick the card's theme, F stars it.
 */
export function Gallery(props: GalleryProps) {
  const {current, sections, focused, onFocus} = props;
  const container = useRef<HTMLDivElement>(null);
  const themes = sections.flatMap((section) => section.themes);
  const focusedShown =
    focused === null
      ? current !== null
      : themes.some((theme) => theme.name === focused);
  const fallbackStop = current === null ? themes[0]?.name : null;
  const tabStop = focusedShown ? focused : fallbackStop;

  // The first time Themes shows, it scrolls to the focused card. Later visits
  // keep their scroll: the view stays mounted, and its effects rerun on each.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    container.current
      ?.querySelector("[tabindex='0']")
      ?.scrollIntoView({block: "center"});
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      !Object.hasOwn(target.dataset, "themeCard") ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const choice = choiceOf(target);
    if (event.key === "f") {
      if (choice === null) return;
      event.preventDefault();
      const on = !getStore().snapshot!.state.favorites.includes(choice);
      void send({type: "favorite", theme: choice, on});
      return;
    }

    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-theme-card]"),
    ];
    const index = cards.indexOf(target);
    const next = {
      left: () => cards[index - 1],
      right: () => cards[index + 1],
      up: () => neighbour(cards, target, "up"),
      down: () => neighbour(cards, target, "down"),
      home: () => cards[0],
      end: () => cards.at(-1),
    }[move]();
    if (!next || next === target) return;

    const nextChoice = choiceOf(next);
    onFocus(nextChoice);
    pickTheme(nextChoice);
    next.focus();
    next.scrollIntoView({block: "nearest"});
  };

  return (
    <div
      ref={container}
      role="group"
      aria-label="Themes"
      className="flex flex-col gap-8"
      onKeyDown={onKeyDown}>
      {sections.map((section, i) => (
        <section key={section.label} className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-2 font-medium text-muted-foreground">
            {section.label}
            {section.themes.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {section.themes.length}
              </span>
            )}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-4 gap-y-5">
            {i === 0 && current && (
              <ThemeCard
                choice={null}
                colors={current}
                tabbable={tabStop === null}
                selected={focused === null}
                showing={props.currentShowing}
                onFocus={onFocus}
              />
            )}
            {i === 0 && current && section.themes.length === 0 && (
              <p className="flex flex-col justify-center gap-1 rounded-2xl p-5 text-sm text-muted-foreground inset-ring inset-ring-border [background:repeating-linear-gradient(135deg,transparent_0_8px,rgb(255_255_255/1.5%)_8px_16px)]">
                <b className="font-medium text-muted-foreground">
                  Themes you save show here
                </b>
                Use “Save as theme…”, or keep your previous colours when you
                save.
              </p>
            )}
            {section.themes.map((theme) => (
              <ThemeCard
                key={theme.name}
                choice={theme.name}
                colors={theme.colors}
                dark={theme.dark}
                tabbable={tabStop === theme.name}
                selected={focused === theme.name}
                showing={props.showingTheme === theme.name}
                favorite={props.favorites.includes(theme.name)}
                match={
                  props.match?.theme === theme.name &&
                  props.showingTheme !== theme.name
                    ? props.match
                    : undefined
                }
                onFocus={onFocus}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type CardProps = {
  choice: ThemeChoice;
  colors: ThemeColors;
  /** Absent for the Your colours card. */
  dark?: boolean;
  tabbable: boolean;
  selected: boolean;
  showing: boolean;
  /** Set on the card of the theme matching or closest to the user's own colours. */
  match?: ColorMatch;
  favorite?: boolean;
  onFocus: (choice: ThemeChoice) => void;
};

/** Your own colours, or the theme's mode. */
function ModeIcon(props: {dark: boolean | undefined}) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  if (props.dark === undefined) {
    return <UserIcon aria-hidden className={className} />;
  }
  return props.dark ? (
    <MoonIcon aria-hidden className={className} />
  ) : (
    <SunIcon aria-hidden className={className} />
  );
}

/** A mini terminal in the theme's colours over its 16-colour band and name. */
const ThemeCard = memo(function ThemeCard(props: CardProps) {
  const {choice, colors, dark, selected, showing, onFocus} = props;

  return (
    <button
      type="button"
      data-theme-card=""
      data-theme={choice ?? undefined}
      tabIndex={props.tabbable ? 0 : -1}
      aria-current={showing || undefined}
      aria-label={choice ?? "Your colours"}
      className={cn(
        "group flex scroll-mt-40 scroll-mb-4 flex-col overflow-hidden card text-left transition-[box-shadow] duration-150 [contain-intrinsic-size:auto_190px] [content-visibility:auto] hover:shadow-[0_6px_20px_rgb(0_0_0/35%)] hover:inset-ring-input",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
      onFocus={() => onFocus(choice)}
      onClick={(event) => {
        event.currentTarget.focus();
        onFocus(choice);
        pickTheme(choice, 0);
      }}>
      <div className="relative">
        <SpecimenLines
          lines={SPECIMEN_CARD}
          colors={colors}
          className="px-3.5 pt-3 pb-[13px] text-[12.5px] leading-[18px]"
        />
        {props.match && (
          <span className="absolute right-2.5 bottom-2.5 inline-flex h-5 items-center rounded-full bg-card/90 px-2 text-xs font-medium text-foreground inset-ring inset-ring-input">
            {props.match.exact ? "Matches your colours" : "Closest to yours"}
          </span>
        )}
      </div>
      <PaletteDots
        colors={colors.palette.slice(0, 16)}
        className="grid h-[3px] grid-cols-16"
      />
      <span className="flex h-[42px] w-full items-center gap-2 px-4">
        <ModeIcon dark={dark} />
        <Truncate className="min-w-0 font-medium text-foreground">
          {choice ?? "Your colours"}{" "}
        </Truncate>
        {props.favorite && (
          <StarIcon
            role="img"
            aria-label="Favourite"
            className="size-3 shrink-0 fill-current text-star"
          />
        )}
        {showing && <ShowingBadge />}
      </span>
    </button>
  );
});

/**
 * "Showing", or a short "Not live" whose tooltip gives the reason, so the name
 * keeps its room.
 */
function ShowingBadge() {
  const notShowing = useSnapshot((snapshot) =>
    whyNotShowing(snapshot.state, THEME_PICK_KEYS),
  );
  if (notShowing) {
    const text = NOT_SHOWING_TEXT[notShowing];
    const shadowed = notShowing === "shadowed";
    return (
      <Tooltip disabled={shadowed}>
        <TooltipTrigger
          render={
            <span className="ml-auto shrink-0 text-xs text-muted-foreground" />
          }>
          {shadowed ? text : "Not live"}
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
      <LiveDot className="size-1.5" />
      Showing
    </span>
  );
}
