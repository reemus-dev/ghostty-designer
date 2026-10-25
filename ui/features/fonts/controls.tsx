import {type ReactNode, useMemo} from "react";
import {ArrowDownIcon, ArrowUpIcon, RotateCcwIcon, XIcon} from "lucide-react";
import {Card} from "@/components/card";
import {Chip} from "@/components/chip";
import {NumberField} from "@/components/commit-input";
import {IconButton} from "@/components/icon-button";
import {
  OptionControl,
  OptionRow,
  SliderField,
} from "@/components/option-control";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {Switch} from "@/components/ui/switch";
import type {FontAxis, FontFamily} from "@/core/bindings";
import {
  choosableFeatures,
  featureOn,
  ligatureTag,
  parseFeatures,
  parseVariations,
  toggledFeature,
} from "@/core/font-settings";
import type {Intent, OptionMeta} from "@/core/types";
import {parseMetric} from "@/core/values";
import {fontCards} from "@/lib/customise";
import {useFontStack} from "@/lib/fonts";
import {MOD} from "@/lib/keys";
import {send, sendLive, useEffective, useSnapshot} from "@/lib/store";

const EMPTY: string[] = [];

/** The font section's cards for the platform and the thicken setting. */
function useFontCards() {
  const options = useSnapshot((snapshot) => snapshot.options);
  const platform = useSnapshot((snapshot) => snapshot.ghostty.platform);
  const thicken = useEffective("font-thicken")?.[0];
  return useMemo(
    () => fontCards(options, platform, thicken),
    [options, platform, thicken],
  );
}

/**
 * The settings beside the font list. Features and axes follow the selected
 * font.
 */
export function FontControls(props: {family: FontFamily | undefined}) {
  const {family} = props;
  const {size} = useFontCards();

  return (
    <>
      <Group label="Size and spacing">
        {size.options.map((option) => (
          <SizeOption key={option.key} option={option} />
        ))}
      </Group>
      {family && choosableFeatures(family).length > 0 && (
        <Features family={family} />
      )}
      {family && family.axes.length > 0 && (
        <Group label="Variable axes">
          {family.axes.map((axis) => (
            <Axis key={axis.tag} axis={axis} />
          ))}
        </Group>
      )}
    </>
  );
}

const rows = (options: OptionMeta[]) =>
  options.map((option) =>
    option.key === "font-synthetic-style" ? (
      <SyntheticStyles key={option.key} option={option} />
    ) : (
      <OptionControl key={option.key} option={option} />
    ),
  );

/**
 * Metrics, rendering, fallback fonts and per-style fonts, under the list and
 * the settings.
 */
export function FontMetricsAndStyles() {
  const {metrics, rendering, fallback, styles} = useFontCards();
  return (
    <div className="mt-6 flex flex-col gap-3">
      <h3 className="px-1 text-sm text-muted-foreground">More font settings</h3>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card
            label={metrics.label}
            aside="Whole pixels, or a percentage such as 12.5%">
            <div className="-mt-2 flex flex-col">{rows(metrics.options)}</div>
          </Card>
          <Card label={rendering.label}>
            <div className="-mt-2 flex flex-col">{rows(rendering.options)}</div>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card label={fallback.label} aside="For characters the font lacks">
            <div className="-mt-2 flex flex-col">
              <FallbackFonts />
              {rows(fallback.options)}
            </div>
          </Card>
          <Card label={styles.label}>
            <div className="-mt-2 flex flex-col">{rows(styles.options)}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A captioned run of setting rows. */
function Group(props: {label: string; aside?: string; children: ReactNode}) {
  return (
    <div className="flex flex-col">
      <h3 className="flex items-baseline gap-2 pb-1 text-sm text-muted-foreground">
        {props.label}
        {props.aside && <span className="text-xs">{props.aside}</span>}
      </h3>
      <div className="flex flex-col">{props.children}</div>
    </div>
  );
}

// ─── Numbers ───

/** The rows beside the font list. */
function SizeOption(props: {option: OptionMeta}) {
  const {option} = props;
  switch (option.key) {
    case "font-size": {
      return <FontSize option={option} />;
    }
    case "adjust-cell-height": {
      return <SpacingRow option={option} unit="%" min={0} max={50} />;
    }
    case "adjust-cell-width": {
      return <SpacingRow option={option} unit="px" min={-2} max={8} />;
    }
    default: {
      return <OptionControl option={option} />;
    }
  }
}

/** Font size in steps of one point; typed sizes may be fractional. */
function FontSize(props: {option: OptionMeta}) {
  const {option} = props;
  // The zoom reset runs through macOS automation.
  const resetsZoom = useSnapshot(
    (snapshot) => snapshot.ghostty.platform === "macos",
  );
  const value = useEffective(option.key)?.[0] ?? option.defaults[0] ?? "13";
  const {min = -Infinity, max = Infinity} =
    option.control.kind === "number" ? option.control : {};
  return (
    <OptionRow
      option={option}
      note={
        resetsZoom ? `Resets each window's zoom (${MOD}+ / ${MOD}−)` : undefined
      }>
      <span className="flex items-center gap-1.5">
        <NumberField
          aria-label="Font size"
          value={value}
          min={min}
          max={max}
          onCommit={(next) =>
            sendLive({type: "set", key: option.key, values: [String(next)]})
          }
        />
        <span className="text-xs text-muted-foreground">pt</span>
      </span>
    </OptionRow>
  );
}

/**
 * Line height or letter spacing: an adjust-cell-* metric in one unit. A value
 * in the other unit shows as written and the slider rests at zero.
 */
function SpacingRow(props: {
  option: OptionMeta;
  unit: "%" | "px";
  min: number;
  max: number;
}) {
  const {option, unit} = props;
  const value = useEffective(option.key)?.[0] ?? "";
  const amount = Number(value.replace(/%$/, "")) || 0;
  const inUnit = amount === 0 || value.endsWith("%") === (unit === "%");
  const set = (next: string) =>
    sendLive({type: "set", key: option.key, values: [next]});
  return (
    <OptionRow option={option}>
      <SliderField
        label={option.label}
        min={props.min}
        max={props.max}
        step={1}
        value={inUnit ? amount : 0}
        unit={inUnit ? unit : undefined}
        onSlide={(next) => set(unit === "%" ? `${next}%` : String(next))}>
        <NumberField
          aria-label={`${option.label} value`}
          placeholder="0"
          whole={unit === "px"}
          value={inUnit && value !== "" ? String(amount) : value}
          reason={
            unit === "%"
              ? "A percentage such as 12.5%, or whole pixels such as 2px"
              : "Whole pixels, or a percentage such as 5.5%"
          }
          onCommit={(next) => set(unit === "%" ? `${next}%` : String(next))}
          onCommitText={(text) => {
            const next = parseMetric(text, unit);
            if (next === null) return false;
            set(next);
          }}
        />
      </SliderField>
    </OptionRow>
  );
}

// ─── Features and axes ───

const FEATURE_NAMES: Record<string, string> = {
  calt: "Contextual alternates",
  liga: "Standard ligatures",
  clig: "Contextual ligatures",
  dlig: "Discretionary ligatures",
  zero: "Slashed zero",
  salt: "Stylistic alternates",
  case: "Case-sensitive forms",
  frac: "Fractions",
  sups: "Superscript",
  subs: "Subscript",
  sinf: "Scientific inferiors",
  numr: "Numerators",
  dnom: "Denominators",
  ordn: "Ordinals",
  onum: "Oldstyle figures",
  lnum: "Lining figures",
  tnum: "Tabular figures",
  pnum: "Proportional figures",
  smcp: "Small capitals",
};

function featureName(tag: string) {
  const numbered = /^(ss|cv)(\d\d)$/.exec(tag);
  if (!numbered) return FEATURE_NAMES[tag] ?? tag;
  const kind = numbered[1] === "ss" ? "Stylistic set" : "Character variant";
  return `${kind} ${Number(numbered[2])}`;
}

const FEATURE_GROUPS = [
  {label: "Stylistic sets", test: (tag: string) => /^ss\d\d$/.test(tag)},
  {label: "Character variants", test: (tag: string) => /^cv\d\d$/.test(tag)},
  {label: "Other features", test: (tag: string) => !/^(ss|cv)\d\d$/.test(tag)},
];

/** The ligature switch, then the font's other features as chips grouped by kind. */
function Features(props: {family: FontFamily}) {
  const {family} = props;
  const features = parseFeatures(useEffective("font-feature") ?? EMPTY);
  const ligatures = ligatureTag(family);
  const toggle = (tag: string) =>
    void send({
      type: "set-tag",
      key: "font-feature",
      tag,
      value: toggledFeature(features, tag),
    });
  const groups = FEATURE_GROUPS.map((group) => ({
    label: group.label,
    tags: choosableFeatures(family).filter(
      (tag) => tag !== ligatures && group.test(tag),
    ),
  })).filter((group) => group.tags.length > 0);

  const chips = (tags: string[]) => (
    <div className="flex flex-wrap gap-1.5 pb-3">
      {tags.map((tag) => (
        <Chip
          key={tag}
          title={featureName(tag)}
          pressed={featureOn(features, tag)}
          className="h-6 rounded-md px-2 font-mono text-xs"
          onPressedChange={() => toggle(tag)}>
          {tag}
        </Chip>
      ))}
    </div>
  );

  return (
    <Group label="Features">
      {ligatures && (
        <div className="flex min-h-11 items-center gap-4 py-1.5">
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="font-medium">Ligatures</span>
            <small className="text-sm text-muted-foreground">
              Joins symbols like -&gt; and != into one shape
            </small>
          </span>
          {/* The margin lines it up with the reset buttons of the rows above. */}
          <Switch
            className="mr-[30px]"
            aria-label="Ligatures"
            checked={featureOn(features, ligatures)}
            onCheckedChange={() => toggle(ligatures)}
          />
        </div>
      )}
      {groups.map((group) => {
        const on = group.tags.filter((tag) => featureOn(features, tag)).length;
        return (
          <div
            key={group.label}
            className="flex flex-col gap-1.5 border-t pt-2.5 first:border-t-0">
            <h4 className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {group.label}
              <span className="text-2xs">
                {on > 0 ? `${on} on · ${group.tags.length}` : group.tags.length}
              </span>
            </h4>
            {chips(group.tags)}
          </div>
        );
      })}
    </Group>
  );
}

function Axis(props: {axis: FontAxis}) {
  const {axis} = props;
  const axes = parseVariations(useEffective("font-variation") ?? EMPTY);
  const value = axes.get(axis.tag) ?? axis.default;
  const fine = axis.max - axis.min <= 20;

  const commit = (next: number | null, live: boolean) => {
    const intent: Intent = {
      type: "set-tag",
      key: "font-variation",
      tag: axis.tag,
      value: next === null ? null : `${axis.tag}=${next}`,
    };
    if (live) sendLive(intent);
    else void send(intent);
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 not-first:border-t">
      <span className="flex min-w-28 flex-1 items-center gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5 font-medium">
          <span className="truncate">{axis.name}</span>
          <code className="text-xs font-normal text-muted-foreground">
            {axis.tag}
          </code>
        </span>
        {axes.has(axis.tag) && (
          <IconButton
            label={`Reset ${axis.name} to ${axis.default}`}
            className="-m-1"
            onClick={() => commit(null, false)}>
            <RotateCcwIcon />
          </IconButton>
        )}
      </span>
      <div className="ml-auto shrink-0">
        <SliderField
          label={axis.name}
          min={axis.min}
          max={axis.max}
          step={fine ? 0.1 : 1}
          value={value}
          onSlide={(next) =>
            commit(fine ? Math.round(next * 10) / 10 : Math.round(next), true)
          }>
          <NumberField
            aria-label={`${axis.name} value`}
            value={String(value)}
            min={axis.min}
            max={axis.max}
            step={fine ? 0.1 : 1}
            className="w-12"
            onCommit={(next) => commit(next, true)}
          />
        </SliderField>
      </div>
    </div>
  );
}

// ─── More ───

/** The styles Ghostty may synthesize when a family lacks the face. */
const SYNTHETIC = {
  bold: "Bold",
  italic: "Italic",
  "bold-italic": "Bold italic",
};

function SyntheticStyles(props: {option: OptionMeta}) {
  const {option} = props;
  const value = useEffective(option.key)?.[0];
  const flags = new Set((value ?? "").split(","));
  return (
    <OptionRow option={option}>
      <div
        role="group"
        aria-label="Synthetic styles"
        className="flex flex-wrap gap-1.5">
        {Object.entries(SYNTHETIC).map(([style, label]) => (
          <Chip
            key={style}
            pressed={!flags.has(`no-${style}`)}
            onPressedChange={(on) =>
              void send({
                type: "set-flag",
                key: option.key,
                flag: style,
                on,
              })
            }>
            {label}
          </Chip>
        ))}
      </div>
    </OptionRow>
  );
}

/** Font-family's values after the first, in the order Ghostty tries them. */
function FallbackFonts() {
  const chain = useEffective("font-family") ?? EMPTY;
  const fonts = useSnapshot((snapshot) => snapshot.fonts);
  const [primary, ...fallbacks] = chain;
  if (primary === undefined) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Choose a font first. Fallbacks follow it.
      </p>
    );
  }

  const candidates =
    fonts?.map((font) => font.family).filter((name) => !chain.includes(name)) ??
    EMPTY;
  const commit = (next: string[], label: string) =>
    void send({
      type: "set",
      key: "font-family",
      values: [primary, ...next],
      label,
    });
  const move = (from: number, to: number) => {
    const next = fallbacks.toSpliced(from, 1);
    next.splice(to, 0, fallbacks[from]!);
    commit(next, "Reorder fallback fonts");
  };

  return (
    <div className="flex flex-col gap-2 pb-3">
      {fallbacks.length > 0 && (
        <ol className="flex flex-col">
          {fallbacks.map((family, i) => (
            <FallbackRow key={family} family={family}>
              <IconButton
                label="Try earlier"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}>
                <ArrowUpIcon />
              </IconButton>
              <IconButton
                label="Try later"
                disabled={i === fallbacks.length - 1}
                onClick={() => move(i, i + 1)}>
                <ArrowDownIcon />
              </IconButton>
              <IconButton
                label={`Remove ${family}`}
                onClick={() =>
                  commit(
                    fallbacks.filter((name) => name !== family),
                    `Remove fallback ${family}`,
                  )
                }>
                <XIcon />
              </IconButton>
            </FallbackRow>
          ))}
        </ol>
      )}
      <Combobox
        items={candidates}
        value={null}
        onValueChange={(next: string | null) =>
          next && commit([...fallbacks, next], `Add fallback ${next}`)
        }>
        <ComboboxInput
          aria-label="Add a fallback font"
          className="h-8"
          placeholder={fonts ? "Add a fallback font…" : "Scanning fonts…"}
        />
        <ComboboxContent>
          <ComboboxEmpty>No installed font matches.</ComboboxEmpty>
          <ComboboxList>
            {(family: string) => (
              <ComboboxItem key={family} value={family}>
                {family}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function FallbackRow(props: {family: string; children: ReactNode}) {
  const fontFamily = useFontStack([props.family]);
  return (
    <li className="flex h-9 items-center gap-2.5 not-first:border-t">
      <span className="min-w-0 flex-1 truncate text-base" style={{fontFamily}}>
        {props.family}
      </span>
      <span className="flex">{props.children}</span>
    </li>
  );
}
