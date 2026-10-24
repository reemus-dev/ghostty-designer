import {useMemo, useState} from "react";
import {ShieldCheckIcon} from "lucide-react";
import {PaletteDots} from "@/components/palette-dots";
import {Button} from "@/components/ui/button";
import {PREVIEW_INCLUDE_LINES} from "@/core/save";
import {themeColors} from "@/core/theme";
import {tildePath} from "@/lib/paths";
import {send, setSetupLater, useSnapshot} from "@/lib/store";

/**
 * Live preview needs one include line in the config: shown on first run and
 * from the live status. "Not now" still allows changing and saving; Ghostty
 * then updates only on save.
 */
export function SetupCard() {
  const configPath = useSnapshot((snapshot) => snapshot.ghostty.configPath);
  const match = useSnapshot((snapshot) => snapshot.state.colorMatch);
  const effective = useSnapshot((snapshot) => snapshot.state.effective);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const colors = useMemo(
    () => themeColors(effective, colorDefaults),
    [effective, colorDefaults],
  );
  const [busy, setBusy] = useState(false);

  const font = effective["font-family"]?.[0] ?? "Ghostty's default font";
  const size = effective["font-size"]?.[0];
  const summary = match?.exact ? `Theme: ${match.theme}` : "Your own colours";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10">
      <section
        aria-labelledby="setup-title"
        className="mx-auto flex max-w-[720px] flex-col gap-6 card p-10 text-lg">
        <div className="flex items-center gap-3 text-base text-muted-foreground">
          <PaletteDots
            colors={colors.palette.slice(0, 8)}
            className="flex shrink-0 gap-0.5 rounded-md p-1.5 inset-ring inset-ring-border"
            dotClassName="size-3 rounded-xs"
            style={{background: colors.background}}
          />
          <span>
            <b className="font-medium text-foreground">Found your config</b>
            <br />
            {summary} · {font}
            {size && `, ${size} pt`}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <h1
            id="setup-title"
            className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
            See your changes live in Ghostty
          </h1>
          <p className="text-muted-foreground">
            To update your open Ghostty windows as you try things, Ghostty
            Designer adds these lines to the end of your config:
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <figure className="overflow-hidden rounded-xl bg-background inset-ring inset-ring-border">
            <figcaption className="border-b px-4 py-2 font-mono text-sm wrap-anywhere text-muted-foreground">
              {tildePath(configPath)}
            </figcaption>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-relaxed">
              <span className="text-muted-foreground">
                … end of your config{"\n"}
              </span>
              {PREVIEW_INCLUDE_LINES.map((line) => (
                <span
                  key={line}
                  className={
                    line.startsWith("#")
                      ? "text-muted-foreground"
                      : "text-added"
                  }>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          </figure>
          <p className="text-base text-muted-foreground">
            They point Ghostty at a small file that Ghostty Designer looks
            after. The <code className="text-foreground">?</code> tells Ghostty
            to skip that file if it's ever missing, so the lines can't break
            anything.
          </p>
        </div>

        <p className="flex gap-3 text-base text-muted-foreground">
          <ShieldCheckIcon
            aria-hidden
            className="mt-1 size-4 shrink-0 text-muted-foreground"
          />
          A backup of your config is kept first. Remove the lines or restore the
          original any time.
        </p>

        <div className="flex flex-col gap-3 border-t pt-6">
          <div className="flex justify-end gap-2">
            <Button
              size="lg"
              variant="ghost"
              onClick={() => setSetupLater(true)}>
              Not now
            </Button>
            <Button
              id="setup-enable"
              size="lg"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void send({type: "install-preview"}).finally(() =>
                  setBusy(false),
                );
              }}>
              Enable live preview
            </Button>
          </div>
          <p className="text-right text-base text-muted-foreground">
            With “Not now” you can still change and save settings. Ghostty then
            updates only when you save.
          </p>
        </div>
      </section>
    </div>
  );
}
