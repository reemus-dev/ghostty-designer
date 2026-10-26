import type {ReactNode} from "react";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {THEME_COLOR_KEYS} from "@/core/theme";
import type {ReadabilityWarning, SessionState} from "@/core/types";
import {colorValues} from "@/core/values";
import {ALT_KEY} from "@/lib/keys";
import {pickTheme} from "@/lib/pick";
import {describeSlot, TERMINAL_SLOTS, warningSlot} from "@/lib/slots";
import {send, setColor} from "@/lib/store";
import {revealTheme} from "@/lib/views";

const COLOUR_SLOTS = [...THEME_COLOR_KEYS, ...TERMINAL_SLOTS];

/**
 * "Theme: Rose Pine", "Rose Pine, with some of your own colours", or "Your own
 * colours" with the theme they match or come closest to, and whether they hide
 * all of the config's theme.
 */
export function ColorSummary(props: {state: SessionState}) {
  const {colorMatch, themePair, themeHidden, appearance, provenance} =
    props.state;
  const named = themePair?.[appearance];
  const sources = COLOUR_SLOTS.map((id) => provenance[id]);
  const fromTheme = sources.includes("theme");
  const own = sources.some(
    (source) => source === "config" || source === "draft",
  );

  let colours: ReactNode;
  if (named && fromTheme && !own) {
    colours = `Theme: ${named}`;
  } else if (named && fromTheme) {
    colours = `${named}, with some of your own colours`;
  } else {
    colours = (
      <>
        Your own colours
        {colorMatch && (
          <>
            {colorMatch.exact ? " · same as " : " · closest theme: "}
            <Tooltip>
              <TooltipTrigger
                className="rounded-sm underline decoration-input underline-offset-[3px] hover:decoration-muted-foreground"
                onClick={() => {
                  revealTheme(colorMatch.theme)?.focus({preventScroll: true});
                  pickTheme(colorMatch.theme, 0);
                }}>
                {colorMatch.theme}
              </TooltipTrigger>
              <TooltipContent>Try this theme</TooltipContent>
            </Tooltip>
          </>
        )}
      </>
    );
  }

  const hide =
    themeHidden === "all" && named
      ? `These colours hide all of ${named}, your config's theme.`
      : null;

  return (
    <div className="flex flex-col gap-0.5">
      <span>{colours}</span>
      {hide && <span className="text-muted-foreground">{hide}</span>}
    </div>
  );
}

/**
 * The line over the swatches: which colours are hard to read, or else how to
 * drag them, and whose colours the strips under them show. It keeps one height
 * either way, so the swatches never move.
 */
export function SwatchHint(props: {
  warnings: ReadabilityWarning[];
  /** The pinned theme. */
  reference: string | undefined;
}) {
  const {warnings, reference} = props;
  const first = warnings[0];
  const makeReadable = () => {
    const values = colorValues(
      warnings.map((warning) => [warningSlot(warning), warning.fix] as const),
    );
    void send({type: "set-many", values, label: "Make colours readable"});
  };

  return (
    <div className="-my-1 flex h-6 items-center gap-2 text-2xs whitespace-nowrap text-muted-foreground">
      {first ? (
        <>
          <span
            aria-hidden
            className="grid size-[15px] shrink-0 place-items-center rounded-full bg-warn text-[10px] leading-none font-bold text-background">
            !
          </span>
          {warnings.length === 1 ? (
            <span className="flex min-w-0 gap-1">
              <button
                type="button"
                className="shrink-0 rounded-sm underline decoration-input underline-offset-[3px] hover:decoration-muted-foreground"
                onClick={() => setColor(warningSlot(first))}>
                {describeSlot(warningSlot(first)).title}
              </button>
              <Truncate>is hard to read</Truncate>
            </span>
          ) : (
            <Truncate className="min-w-0">
              {warnings.length} colours are hard to read
            </Truncate>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="text-warn"
            onClick={makeReadable}>
            Make readable
          </Button>
        </>
      ) : (
        <span>
          Drag to swap · hold <Kbd>{ALT_KEY}</Kbd> to copy
        </span>
      )}
      {reference !== undefined && (
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="flex w-2.5 shrink-0 flex-col gap-px">
            <span className="h-2 rounded-[2px] inset-ring inset-ring-input" />
            <span className="h-1 rounded-[1px] bg-muted-foreground" />
          </span>
          <Truncate className="max-w-40">Strips: {reference}</Truncate>
        </span>
      )}
    </div>
  );
}
