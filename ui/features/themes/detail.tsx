import {type ReactNode, useMemo, useState} from "react";
import {cn} from "cn";
import {
  MoonIcon,
  PinIcon,
  PinOffIcon,
  StarIcon,
  SunIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import {LiveDot} from "@/components/live-dot";
import {PaletteDots} from "@/components/palette-dots";
import {HexChip, Swatch} from "@/components/swatch";
import {Button} from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {Switch} from "@/components/ui/switch";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {whyNotShowing} from "@/core/preview";
import {formatThemePair, THEME_PICK_KEYS} from "@/core/theme";
import {siblingOf} from "@/core/theme-library";
import type {
  ColorMatch,
  ReadabilityWarning,
  SaveThemeSource,
  ThemeColors,
  ThemeSummary,
} from "@/core/types";
import {describeSlot} from "@/lib/slots";
import {notify, openSaveTheme, send, useSnapshot} from "@/lib/store";
import {NOT_SHOWING_TEXT} from "@/lib/views";

const listWords = (words: string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

function ReadabilityWarnings(props: {warnings: ReadabilityWarning[]}) {
  const {warnings} = props;
  if (warnings.length === 0) return null;
  const text = warnings.some((warning) => warning.key === "foreground");
  const slots = warnings.flatMap((warning) => warning.slot ?? []);
  const comments = slots.includes(8);
  const accents = slots
    .filter((slot) => slot !== 8)
    .map((slot) => describeSlot(`palette:${slot}`).title.toLowerCase());
  const lines = [
    text && "Text is faint on this background.",
    comments && "Comments and suggestions (bright black) are faint.",
    accents.length > 0 &&
      `${listWords(accents).replace(/^./, (c) => c.toUpperCase())} ${accents.length === 1 ? "is" : "are"} hard to read.`,
  ].filter(Boolean);

  return (
    <div
      role="note"
      className="flex gap-2.5 rounded-xl bg-warn/12 p-3 text-sm inset-ring inset-ring-warn/28">
      <TriangleAlertIcon
        aria-hidden
        className="mt-px size-3.5 shrink-0 text-warn"
      />
      <div className="flex flex-col gap-0.5">
        <b className="font-medium text-foreground">
          Some text may be hard to read
        </b>
        <span className="text-muted-foreground">{lines.join(" ")}</span>
      </div>
    </div>
  );
}

// ─── Shared parts ───

function Showing() {
  const notShowing = useSnapshot((snapshot) =>
    whyNotShowing(snapshot.state, THEME_PICK_KEYS),
  );
  if (notShowing) {
    return (
      <p className="text-sm text-muted-foreground">
        {NOT_SHOWING_TEXT[notShowing]}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LiveDot />
      Showing in Ghostty
    </p>
  );
}

function Colors(props: {colors: ThemeColors; warnings: ReadabilityWarning[]}) {
  const {colors, warnings} = props;
  const slots = new Set(warnings.map((warning) => warning.slot));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          Background <HexChip color={colors.background} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          Text <HexChip color={colors.foreground} />
        </span>
      </div>
      <div className="grid grid-cols-8 gap-x-1 gap-y-2">
        {colors.palette.slice(0, 16).map((color, i) => (
          <Swatch
            // oxlint-disable-next-line react/no-array-index-key -- a swatch's index is its palette slot
            key={i}
            color={color}
            warning={slots.has(i)}
            title={`${describeSlot(`palette:${i}`).title} ${color}`}
            className="h-[22px]"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Pins the theme as the reference whose colours line up under the user's own in
 * Customise.
 */
function PinButton(props: {theme: string}) {
  const {theme} = props;
  const pinned = useSnapshot((snapshot) => snapshot.state.reference === theme);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={pinned}
      className="-my-2 -ml-2.5 self-start text-muted-foreground"
      onClick={() => {
        void send({type: "reference", theme: pinned ? null : theme});
        if (!pinned) {
          notify(`Pinned ${theme} · its colours show under yours in Customise`);
        }
      }}>
      {pinned ? <PinOffIcon /> : <PinIcon />}
      {pinned ? "Unpin reference" : "Pin as reference"}
    </Button>
  );
}

function Action(props: {note?: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-2 [&>button]:w-full">
      {props.children}
      {props.note && (
        <p className="text-sm text-muted-foreground">{props.note}</p>
      )}
    </div>
  );
}

function SaveThemeButton(props: {source: SaveThemeSource}) {
  return (
    <Button variant="outline" onClick={() => openSaveTheme(props.source)}>
      Save as theme…
    </Button>
  );
}

// ─── Panels ───

type ThemeDetailProps = {
  theme: ThemeSummary;
  showing: boolean;
  favorite: boolean;
};

/** The focused theme: what it is, its colours, and how to copy or pair it. */
export function ThemeDetail(props: ThemeDetailProps) {
  const {theme, showing, favorite} = props;
  const ModeIcon = theme.dark ? MoonIcon : SunIcon;
  const favoriteLabel = favorite
    ? "Remove from favourites"
    : "Add to favourites";

  return (
    <>
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ModeIcon aria-hidden className="size-3.5 text-muted-foreground" />
            {theme.dark ? "Dark theme" : "Light theme"}
            {theme.source === "user" && " · My theme"}
          </p>
          <h2 className="text-xl leading-tight font-semibold tracking-[-0.015em] break-words">
            {theme.name}
          </h2>
          {showing && <Showing />}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={favorite}
          aria-label={favoriteLabel}
          title={`${favoriteLabel} (F)`}
          onClick={() =>
            void send({type: "favorite", theme: theme.name, on: !favorite})
          }>
          <StarIcon
            className={cn("size-4", favorite && "fill-current text-star!")}
          />
        </Button>
      </header>

      <Colors colors={theme.colors} warnings={theme.warnings} />
      <PinButton theme={theme.name} />
      <ReadabilityWarnings warnings={theme.warnings} />

      <Action
        note={
          theme.source === "bundled"
            ? "Makes an editable copy. Built-in themes never change."
            : undefined
        }>
        <SaveThemeButton source={{theme: theme.name}} />
      </Action>

      <hr className="border-border" />
      <PairBuilder key={theme.name} theme={theme} />
    </>
  );
}

/** The Current card: the user's own colours and saving them as a theme. */
export function CurrentDetail(props: {
  colors: ThemeColors;
  /** Readability of the colours, known while Ghostty shows them. */
  warnings: ReadabilityWarning[];
  showing: boolean;
  /** The theme matching or closest to these colours. */
  match: ColorMatch | null;
  onPick: (theme: string) => void;
}) {
  const {colors, warnings, showing, match} = props;
  return (
    <>
      <header className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <UserIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Your colours
        </p>
        <h2 className="text-xl leading-tight font-semibold tracking-[-0.015em]">
          Current
        </h2>
        {showing && <Showing />}
        {match && (
          <p className="text-sm text-muted-foreground">
            {match.exact ? "Same colours as" : "Closest theme:"}{" "}
            <button
              type="button"
              className="rounded-sm text-foreground underline decoration-input underline-offset-[3px] hover:decoration-muted-foreground"
              onClick={() => props.onPick(match.theme)}>
              {match.theme}
            </button>
          </p>
        )}
      </header>

      <Colors colors={colors} warnings={warnings} />
      <ReadabilityWarnings warnings={warnings} />

      <Action note="Keeps these colours under My themes, to come back to any time.">
        <SaveThemeButton source="own" />
      </Action>
    </>
  );
}

// ─── Light/dark pair ───

/**
 * "Use a different theme when your system is in light mode": picks the other
 * half and sends `light:A,dark:B`. While a pair is in use, chooses which half
 * Ghostty shows. The switch and the other half follow the theme setting through
 * undo, redo and changes from elsewhere.
 */
function PairBuilder(props: {theme: ThemeSummary}) {
  const {theme} = props;
  const themes = useSnapshot((snapshot) => snapshot.themes);
  const setting = useSnapshot((snapshot) => snapshot.state.themeSetting);
  const appearance = useSnapshot((snapshot) => snapshot.state.appearance);
  const active = useSnapshot((snapshot) => snapshot.state.themePair);
  const inPair =
    active !== null &&
    active.light !== active.dark &&
    (active.light === theme.name || active.dark === theme.name);
  const otherMode = theme.dark ? "light" : "dark";

  const options = useMemo(
    () =>
      themes
        .filter((item) => item.dark !== theme.dark)
        .map((item) => item.name),
    [theme, themes],
  );
  const partnerNow = () =>
    (inPair && active[otherMode] !== theme.name
      ? active[otherMode]
      : siblingOf(theme, themes)?.name) ?? null;
  const [on, setOn] = useState(inPair);
  const [partner, setPartner] = useState(partnerNow);
  const [synced, setSynced] = useState(setting);
  if (setting !== synced) {
    setSynced(setting);
    setOn(inPair);
    setPartner(partnerNow());
  }
  const other = themes.find((item) => item.name === partner);
  const pair =
    other &&
    formatThemePair(
      theme.dark
        ? {light: other.name, dark: theme.name}
        : {light: theme.name, dark: other.name},
    );

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-4">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium">
            Use a different theme when your system is in {otherMode} mode
          </span>
          <span className="text-sm text-muted-foreground">
            Ghostty switches by itself when your system does.
          </span>
        </span>
        <Switch
          className="mt-0.5"
          checked={on}
          onCheckedChange={(checked) => {
            setOn(checked);
            if (!checked && inPair) {
              void send({type: "theme", theme: theme.name});
            }
          }}
        />
      </label>
      {on && (
        <>
          <div className="flex items-center gap-2">
            <PairSwatch theme={other} />
            <Combobox
              items={options}
              value={partner}
              onValueChange={(next: string | null) => setPartner(next)}>
              <ComboboxInput
                aria-label={`Theme in ${otherMode} mode`}
                className="h-[30px] min-w-0 flex-1"
                placeholder={`Choose a ${otherMode} theme`}
              />
              <ComboboxContent>
                <ComboboxEmpty>No {otherMode} theme matches.</ComboboxEmpty>
                <ComboboxList>
                  {(name: string) => (
                    <ComboboxItem key={name} value={name}>
                      {name}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Button
              variant="outline"
              disabled={!pair || pair === setting}
              onClick={() => pair && void send({type: "theme", theme: pair})}>
              Use pair
            </Button>
          </div>
          {inPair && (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              Show in Ghostty now
              <ToggleGroup
                aria-label="Half of the pair Ghostty shows"
                value={[appearance]}
                onValueChange={(next) =>
                  next[0] &&
                  void send({
                    type: "appearance",
                    appearance: next[0] as "light" | "dark",
                  })
                }>
                <ToggleGroupItem value="light">
                  <SunIcon aria-hidden />
                  Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark">
                  <MoonIcon aria-hidden />
                  Dark
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PairSwatch(props: {theme: ThemeSummary | undefined}) {
  const colors = props.theme?.colors;
  return (
    <span
      aria-hidden
      className="flex h-[30px] w-11 shrink-0 flex-col justify-between rounded-lg px-1.5 py-1 font-mono text-[10px] leading-none inset-ring inset-ring-border"
      style={{background: colors?.background, color: colors?.foreground}}>
      {colors && (
        <>
          Aa
          <PaletteDots
            colors={colors.palette.slice(1, 6)}
            className="flex gap-0.5"
            dotClassName="size-1 rounded-[1px]"
          />
        </>
      )}
    </span>
  );
}
