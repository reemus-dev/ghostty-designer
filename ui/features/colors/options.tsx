import {useMemo} from "react";
import {cn} from "cn";
import {Card} from "@/components/card";
import {Disclosure} from "@/components/disclosure";
import {OptionControl} from "@/components/option-control";
import {contrastRatio, extendedPalette} from "@/core/color";
import type {SlotColor} from "@/core/theme";
import {themeColors} from "@/core/theme";
import type {Provenance} from "@/core/types";
import {colorCards} from "@/lib/customise";
import {describeSlot, type SlotId, TERMINAL_SLOTS} from "@/lib/slots";
import {useSnapshot} from "@/lib/store";

const TEXT_SLOTS = ["foreground", ...TERMINAL_SLOTS];
const BACKGROUND_SLOTS = [
  "background",
  ...Array.from({length: 8}, (_, i) => `palette:${i}`),
];

type Colors = Record<SlotId, SlotColor>;

/** The contrast and 256-colour options, each with its reference view to open. */
export function ColorOptions(props: {
  colors: Colors;
  provenance: Record<string, Provenance>;
}) {
  const {colors, provenance} = props;
  const options = useSnapshot((snapshot) => snapshot.options);
  const platform = useSnapshot((snapshot) => snapshot.ghostty.platform);
  const effective = useSnapshot((snapshot) => snapshot.state.effective);
  const {contrast, extended} = colorCards(options, platform);
  const value = (key: string) =>
    effective[key]?.[0] ??
    options.find((item) => item.key === key)?.defaults[0];

  const minimum = Number(value("minimum-contrast")) || 1;
  const generate = value("palette-generate") === "true";
  const ratios = TEXT_SLOTS.flatMap((text) =>
    BACKGROUND_SLOTS.filter((bg) => bg !== text).map((bg) =>
      contrastRatio(colors[text]!.hex, colors[bg]!.hex),
    ),
  );
  const lifted = ratios.filter((ratio) => ratio < minimum).length;

  return (
    <div className="col-start-1 flex flex-col gap-5">
      <Card
        label={contrast.label}
        aside="Ghostty can lift text that is too faint to read.">
        <div className="-mt-2 flex flex-col">
          {contrast.options.map((option) => (
            <OptionControl key={option.key} option={option} />
          ))}
        </div>
        {minimum > 1 && (
          <p className="text-sm text-fg-3">
            Ghostty moves the text of {lifted} of the {ratios.length} pairs in
            the table toward black or white to reach {minimum}:1.
          </p>
        )}
        <Disclosure
          label="Contrast table"
          aside="Each text colour on each background">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-3">
              The contrast ratio of each pair. 4.5 and up reads well.
            </p>
            <ContrastTable colors={colors} />
          </div>
        </Disclosure>
      </Card>
      <Card
        label={extended.label}
        aside="Colours 16 to 255, which full-colour programs such as vim themes use.">
        <div className="-mt-2 flex flex-col">
          {extended.options.map((option) =>
            option.key === "palette-harmonious" ? (
              <div key={option.key} className={cn(!generate && "opacity-60")}>
                <OptionControl option={option} />
              </div>
            ) : (
              <OptionControl key={option.key} option={option} />
            ),
          )}
        </div>
        <Disclosure label="Show colours 16 to 255">
          <ExtendedPreview
            provenance={provenance}
            generate={generate}
            harmonious={value("palette-harmonious") === "true"}
          />
        </Disclosure>
      </Card>
    </div>
  );
}

/** Rows are text colours and columns backgrounds; each cell draws the pair. */
function ContrastTable(props: {colors: Colors}) {
  const {colors} = props;
  const hex = (id: SlotId) => colors[id]!.hex;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-0.5 text-2xs">
        <thead>
          <tr>
            <th className="w-28">
              <span className="sr-only">Text on</span>
            </th>
            {BACKGROUND_SLOTS.map((bg) => (
              <th
                key={bg}
                scope="col"
                title={describeSlot(bg).title}
                className="truncate pb-1 font-normal text-fg-3">
                {describeSlot(bg).title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {TEXT_SLOTS.map((text) => (
            <tr key={text}>
              <th
                scope="row"
                className="pr-2 text-left font-sans font-normal whitespace-nowrap text-fg-3">
                {describeSlot(text).title}
              </th>
              {BACKGROUND_SLOTS.map((bg) => {
                if (bg === text) {
                  return <td key={bg} className="rounded-[3px] bg-white/3" />;
                }
                const ratio = contrastRatio(hex(text), hex(bg));
                return (
                  <td
                    key={bg}
                    title={`${describeSlot(text).title} on ${describeSlot(bg).title.toLowerCase()}: ${ratio.toFixed(2)}:1`}
                    className="h-6 rounded-[3px] text-center tabular-nums shadow-[inset_0_0_0_1px_rgb(255_255_255/6%)]"
                    style={{background: hex(bg), color: hex(text)}}>
                    {ratio.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The 6×6×6 cube as six slices, then the 24-step grey ramp. */
function ExtendedPreview(props: {
  provenance: Record<string, Provenance>;
  generate: boolean;
  harmonious: boolean;
}) {
  const {provenance, generate, harmonious} = props;
  const effective = useSnapshot((snapshot) => snapshot.state.effective);
  const colorDefaults = useSnapshot((snapshot) => snapshot.colorDefaults);
  const extended = useMemo(
    () =>
      extendedPalette({
        ...themeColors(effective, colorDefaults),
        explicit: (i) =>
          (provenance[`palette:${i}`] ?? "default") !== "default",
        generate,
        harmonious,
      }),
    [effective, colorDefaults, provenance, generate, harmonious],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({length: 6}, (_, slice) => (
          <div
            key={slice}
            className="grid grid-cols-6 overflow-hidden rounded-[4px] shadow-[0_0_0_1px_rgb(255_255_255/8%)]">
            {extended.slice(slice * 36, slice * 36 + 36).map((hex, i) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- a cell's index is its palette slot
                key={i}
                title={`${16 + slice * 36 + i} ${hex}`}
                className="aspect-square"
                style={{background: hex}}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="grid h-4 grid-cols-24 overflow-hidden rounded-[4px] shadow-[0_0_0_1px_rgb(255_255_255/8%)]">
        {extended.slice(216).map((hex, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- a cell's index is its palette slot
          <span key={i} title={`${232 + i} ${hex}`} style={{background: hex}} />
        ))}
      </div>
    </div>
  );
}
