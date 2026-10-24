import {Button} from "@/components/ui/button";
import {THEME_COLOR_KEYS} from "@/core/theme";
import type {ReadabilityWarning, SessionState} from "@/core/types";
import {colorValues} from "@/core/values";
import {pickTheme} from "@/lib/pick";
import {
  describeSlot,
  formatRatio,
  TERMINAL_SLOTS,
  warningSlot,
} from "@/lib/slots";
import {send} from "@/lib/store";
import {revealTheme} from "@/lib/views";

const COLOUR_SLOTS = [...THEME_COLOR_KEYS, ...TERMINAL_SLOTS];

/**
 * "Theme: Rose Pine", or "Your own colours · closest theme: …", and what hides
 * a named theme.
 */
export function ColorSummary(props: {state: SessionState}) {
  const {colorMatch, draft, themePair, appearance, provenance} = props.state;
  const named = themePair?.[appearance];
  const hidden = COLOUR_SLOTS.filter((id) => provenance[id] === "config");
  const part =
    hidden.length === COLOUR_SLOTS.length ? "it" : "some of its colours";

  let hide: string | null = null;
  if (named && hidden.length > 0) {
    hide =
      draft.theme === null
        ? `Your config also names ${named}, but your own colours replace ${part}.`
        : `Colours set in your config hide ${part === "it" ? named : `some of ${named}`}. Saving comments them out.`;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span>
        {colorMatch?.exact ? (
          `Theme: ${colorMatch.theme}`
        ) : (
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
                    revealTheme(colorMatch.theme)?.focus({
                      preventScroll: true,
                    });
                    pickTheme(colorMatch.theme, 0);
                  }}>
                  {colorMatch.theme}
                </button>
              </>
            )}
          </>
        )}
      </span>
      {hide && <span className="text-muted-foreground">{hide}</span>}
    </div>
  );
}

export function Warnings(props: {warnings: ReadabilityWarning[]}) {
  const {warnings} = props;
  if (warnings.length === 0) return null;

  const names = warnings.map(
    (warning) => describeSlot(warningSlot(warning)).title,
  );
  const first = warnings[0]!;
  const text =
    warnings.length === 1
      ? `${names[0]} is hard to read on the background (${formatRatio(first.ratio)}:1, needs ${first.target}:1).`
      : `${warnings.length} colours are hard to read on the background: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}.`;
  const makeReadable = () => {
    const values = colorValues(
      warnings.map((warning) => [warningSlot(warning), warning.fix] as const),
    );
    void send({type: "set-many", values, label: "Make colours readable"});
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-warn/12 py-3 pr-3 pl-4 inset-ring inset-ring-warn/28">
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span>{text}</span>
        <small className="text-sm text-muted-foreground">
          Make readable changes only their lightness.
        </small>
      </div>
      <Button
        variant="outline"
        className="text-warn inset-ring inset-ring-warn/28"
        onClick={makeReadable}>
        Make readable
      </Button>
    </div>
  );
}
