import {useMemo, useState} from "react";
import {cn} from "cn";
import {ArchiveRestoreIcon, FileCogIcon, ShieldCheckIcon} from "lucide-react";
import {PaletteDots} from "@/components/palette-dots";
import {Button} from "@/components/ui/button";
import {PREVIEW_INCLUDE_LINES} from "@/core/save";
import {themeColors} from "@/core/theme";
import {tildePath} from "@/lib/paths";
import {send, setConfigOpen, useSnapshot} from "@/lib/store";
import {appName} from "@/lib/views";

/**
 * Live preview needs one include line in the config. The card asks for it while
 * live preview is on without the line: on first run, and when the user turns it
 * on later. "Not now" turns live preview off, so Ghostty updates only on save.
 */
export function SetupCard() {
  const configPath = useSnapshot((snapshot) => snapshot.ghostty.configPath);
  const match = useSnapshot((snapshot) => snapshot.state.colorMatch);
  const effective = useSnapshot((snapshot) => snapshot.state.effective);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const edited = useSnapshot((snapshot) => snapshot.ghostty.edited);
  const colors = useMemo(
    () => themeColors(effective, colorDefaults),
    [effective, colorDefaults],
  );
  const [busy, setBusy] = useState(false);

  const font = effective["font-family"]?.[0] ?? "Ghostty's default font";
  const size = effective["font-size"]?.[0];
  const summary = match?.exact ? `Theme: ${match.theme}` : "Your own colours";
  const whose =
    edited.type === "file" && edited.app === null
      ? configPath.slice(configPath.lastIndexOf("/") + 1)
      : `${appName(edited)}'s config`;

  return (
    // Centred in the window, not just under the title bar: the bottom padding
    // adds the bar's 48px. Auto margins give way to scrolling when it is short.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-10 pt-5 pb-17">
      <section
        aria-labelledby="setup-title"
        className="m-auto flex w-full max-w-[720px] flex-col gap-6 card p-6 sm:p-10 sm:text-lg">
        <div className="flex flex-col gap-3">
          <h1
            id="setup-title"
            className="text-xl leading-tight font-semibold tracking-[-0.02em]">
            Enable live preview
          </h1>
          <p className="text-muted-foreground">
            {edited.type === "ghostty"
              ? "To show your changes in your open Ghostty windows as you make them,"
              : `To show your changes in ${appName(edited)} whenever it reloads its config,`}{" "}
            Ghostty Designer adds these lines to the end of your config:
          </p>
        </div>

        <figure className="overflow-hidden rounded-xl bg-background inset-ring inset-ring-border">
          <figcaption className="flex flex-col gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
            <span className="flex items-center justify-between gap-3">
              <span className="text-base font-medium text-foreground">
                {whose}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfigOpen(true)}>
                <FileCogIcon />
                Edit another config…
              </Button>
            </span>
            <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <span className="font-mono wrap-anywhere">
                {tildePath(configPath)}
              </span>
              <span className="flex items-center gap-2">
                <PaletteDots
                  colors={colors.palette.slice(0, 8)}
                  className="flex shrink-0 gap-0.5 rounded-sm p-1 inset-ring inset-ring-border"
                  dotClassName="size-2.5 rounded-[2px]"
                  style={{background: colors.background}}
                />
                <span>
                  {summary} · {font}
                  {size && `, ${size} pt`}
                </span>
              </span>
            </span>
          </figcaption>
          <pre className="px-4 py-3 font-mono text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
            <span className="block text-muted-foreground">
              … end of your config
            </span>
            {PREVIEW_INCLUDE_LINES.map((line) => (
              <span
                key={line}
                className={cn(
                  "block pl-[2ch] -indent-[2ch]",
                  line.startsWith("#") ? "text-muted-foreground" : "text-added",
                )}>
                {line}
              </span>
            ))}
          </pre>
        </figure>

        <ul className="flex flex-col gap-3 text-base text-muted-foreground">
          <li className="flex gap-3">
            <ShieldCheckIcon aria-hidden className="mt-1 size-4 shrink-0" />
            <span>
              They load a preview file that Ghostty Designer manages. The{" "}
              <code className="text-foreground">?</code> tells {appName(edited)}{" "}
              to skip it if it's missing.
            </span>
          </li>
          <li className="flex gap-3">
            <ArchiveRestoreIcon aria-hidden className="mt-1 size-4 shrink-0" />
            <span>
              Your config is backed up first. You can remove the lines or
              restore the original any time.
            </span>
          </li>
        </ul>

        <div className="flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Without live preview, {appName(edited)} updates only when you save.
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              size="lg"
              variant="ghost"
              onClick={() => void send({type: "live-preview", on: false})}>
              Not now
            </Button>
            <Button
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
        </div>
      </section>
    </div>
  );
}
