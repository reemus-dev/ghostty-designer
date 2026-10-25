import type {ReactNode} from "react";
import {Truncate} from "@/components/truncate";
import {Button} from "@/components/ui/button";
import {Kbd} from "@/components/ui/kbd";
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
 * colours · closest theme: …", and what hides a theme picked in the draft.
 */
export function ColorSummary(props: {state: SessionState}) {
  const {colorMatch, draft, themePair, appearance, provenance} = props.state;
  const named = themePair?.[appearance];
  const sources = COLOUR_SLOTS.map((id) => provenance[id]);
  const hidden = sources.filter((source) => source === "config").length;

  let colours: ReactNode;
  if (colorMatch?.exact) {
    colours = `Theme: ${colorMatch.theme}`;
  } else if (
    named &&
    sources.includes("theme") &&
    sources.some((source) => source === "config" || source === "draft")
  ) {
    colours = `${named}, with some of your own colours`;
  } else {
    colours = (
      <>
        Your own colours
        {colorMatch && (
          <>
            {" "}
            · closest theme:{" "}
            <button
              type="button"
              title="Show it in Ghostty and on Themes"
              className="rounded-sm underline decoration-input underline-offset-[3px] hover:decoration-muted-foreground"
              onClick={() => {
                revealTheme(colorMatch.theme)?.focus({preventScroll: true});
                pickTheme(colorMatch.theme, 0);
              }}>
              {colorMatch.theme}
            </button>
          </>
        )}
      </>
    );
  }

  const hide =
    draft.theme !== null && named && hidden > 0
      ? `Colours set in your config hide ${hidden === COLOUR_SLOTS.length ? named : `some of ${named}`}. Saving comments them out.`
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
 * drag them. It keeps one height either way, so the swatches never move.
 */
export function SwatchHint(props: {warnings: ReadabilityWarning[]}) {
  const {warnings} = props;
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
    </div>
  );
}
