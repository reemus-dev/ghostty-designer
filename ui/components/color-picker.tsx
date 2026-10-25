import {type CSSProperties, type ReactNode, useState} from "react";
import {CommitInput, NumberField} from "@/components/commit-input";
import {Button} from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {Slider} from "@/components/ui/slider";
import {
  type Channels,
  clampChroma,
  type ColorModel,
  fromChannels,
  FULL_HEX,
  inSrgbGamut,
  parseChannels,
  parseColor,
  toChannels,
} from "@/core/color";
import {setSlot, type SlotId} from "@/lib/slots";
import {send, sendLive, useSnapshot} from "@/lib/store";

const C_MAX = 0.37;

type Channel = {
  label: string;
  name: string;
  max: number;
  decimals: number;
  percent?: boolean;
};

const HUE: Channel = {label: "H", name: "Hue", max: 360, decimals: 1};
const percent = (label: string, name: string): Channel => ({
  label,
  name,
  max: 100,
  decimals: 1,
  percent: true,
});
const byte = (label: string, name: string): Channel => ({
  label,
  name,
  max: 255,
  decimals: 0,
});

const MODELS: Record<
  ColorModel,
  {label: string; channels: [Channel, Channel, Channel]}
> = {
  oklch: {
    label: "OKLCH",
    channels: [
      {label: "L", name: "Lightness", max: 1, decimals: 3},
      {label: "C", name: "Chroma", max: C_MAX, decimals: 3},
      HUE,
    ],
  },
  hsl: {
    label: "HSL",
    channels: [HUE, percent("S", "Saturation"), percent("L", "Lightness")],
  },
  hsv: {
    label: "HSV",
    channels: [HUE, percent("S", "Saturation"), percent("V", "Value")],
  },
  hwb: {
    label: "HWB",
    channels: [HUE, percent("W", "Whiteness"), percent("B", "Blackness")],
  },
  rgb: {
    label: "RGB",
    channels: [byte("R", "Red"), byte("G", "Green"), byte("B", "Blue")],
  },
};

/** `hsl(240 21.3% 14.9%)`, as CSS writes it, or hsv() shaped the same. */
function formatChannels(model: ColorModel, values: Channels) {
  const parts = MODELS[model].channels.map(
    (channel, i) =>
      `${values[i]!.toFixed(channel.decimals)}${channel.percent ? "%" : ""}`,
  );
  return `${model}(${parts.join(" ")})`;
}

/** Track backgrounds for L, C and H, with chroma hatched past sRGB. */
function oklchTracks(values: Channels) {
  const [l, c, h] = values;
  const edge = clampChroma({l, c: C_MAX, h}).c;
  const edgePct = (Math.min(edge, C_MAX) / C_MAX) * 100;
  const chroma = [
    edgePct < 100 &&
      `repeating-linear-gradient(-45deg, transparent 0 3px, rgb(255 255 255 / 55%) 3px 4.5px) right / ${100 - edgePct}% 100% no-repeat`,
    `linear-gradient(90deg, oklch(${l} 0 ${h}), oklch(${l} ${edge} ${h}) ${edgePct}%, oklch(${l} ${edge} ${h}))`,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `linear-gradient(90deg, oklch(0 ${c} ${h}), oklch(0.5 ${c} ${h}), oklch(1 ${c} ${h}))`,
    chroma,
    `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => `oklch(0.72 0.12 ${hue})`).join(", ")})`,
  ];
}

/**
 * Track backgrounds for an sRGB model. Every channel of these models is linear
 * in sRGB between sixths of its range, so seven stops draw it exactly.
 */
function srgbTracks(model: ColorModel, values: Channels) {
  return MODELS[model].channels.map((channel, i) => {
    const stops = [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const at: Channels = [...values];
      at[i] = (channel.max * k) / 6;
      return fromChannels(model, at);
    });
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  });
}

/**
 * Edits one colour: where it comes from, reset, and sliders in a chosen colour
 * model that preview while dragging (OKLCH chroma hatched past sRGB), with hex
 * and CSS fields.
 */
export function ColorPicker(props: {
  id: SlotId;
  title: string;
  hex: string;
  /** The saved colour, shown beside a changed one when it is a hex. */
  saved: string | undefined;
  model: ColorModel;
  onModelChange: (model: ColorModel) => void;
  /** Shown between the header and the sliders. */
  children?: ReactNode;
}) {
  const {id, title, hex, saved, model} = props;
  const provenance = useSnapshot(
    (snapshot) => snapshot.state.provenance[id] ?? "default",
  );
  const themeName = useSnapshot(
    (snapshot) => snapshot.state.themePair?.[snapshot.state.appearance],
  );
  const changed = provenance === "draft";
  const before = changed ? saved : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 overflow-hidden rounded-md inset-ring inset-ring-input">
          {before !== undefined && (
            <span className="flex-1" style={{background: before}} />
          )}
          <span className="flex-1" style={{background: hex}} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="truncate text-sm text-muted-foreground">
            {changed && "Changed"}
            {before !== undefined && (
              <>
                {" "}
                · was <code>{before}</code>
              </>
            )}
            {provenance === "config" && "From your config"}
            {provenance === "theme" && `From theme ${themeName ?? ""}`}
            {provenance === "default" && "Ghostty's default"}
          </p>
        </div>
        {changed && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void send({type: "reset", key: id})}>
            Reset
          </Button>
        )}
        <ModelSelect value={model} onChange={props.onModelChange} />
      </header>
      {props.children}
      <ChannelFields key={id} id={id} hex={hex} model={model} label={title} />
    </div>
  );
}

function ModelSelect(props: {
  value: ColorModel;
  onChange: (model: ColorModel) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(next) => next && props.onChange(next)}>
      <SelectTrigger aria-label="Colour model">
        <SelectValue>{(value: ColorModel) => MODELS[value].label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {(Object.keys(MODELS) as ColorModel[]).map((key) => (
          <SelectItem key={key} value={key}>
            {MODELS[key].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A colour's channels in one model as sliders that preview while dragging, with
 * hex and CSS fields that take any colour.
 */
function ChannelFields(props: {
  id: SlotId;
  hex: string;
  model: ColorModel;
  label: string;
}) {
  const {id, hex, model, label} = props;

  // The channels a drag asked for: greys lose their hue and clamped colours
  // their chroma in hex, so the sliders keep the request until Ghostty shows it.
  const [request, setRequest] = useState<{
    model: ColorModel;
    values: Channels;
    hex: string;
    pending: boolean;
  }>();
  if (request?.pending && request.hex === hex) {
    setRequest({...request, pending: false});
  }
  const values =
    request?.model === model && (request.pending || request.hex === hex)
      ? request.values
      : toChannels(hex, model);

  /**
   * Sliders and number fields send throttled while they move; the model's text
   * field sends once.
   */
  const commit = (next: Channels, live: boolean) => {
    const nextHex = fromChannels(model, next);
    setRequest({model, values: next, hex: nextHex, pending: true});
    const intent = setSlot(id, nextHex, label);
    if (live) sendLive(intent);
    else void send(intent);
  };
  const commitHex = (text: string) => {
    const next = parseColor(text);
    if (!next) return false;
    setRequest(undefined);
    sendLive(setSlot(id, next, label));
    return true;
  };
  const commitText = (text: string) => {
    const next = parseChannels(text, model);
    if (!next) return false;
    commit(next, false);
    return true;
  };

  const tracks =
    model === "oklch" ? oklchTracks(values) : srgbTracks(model, values);
  const outOfGamut =
    model === "oklch" &&
    !inSrgbGamut({l: values[0], c: values[1], h: values[2]});

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        {MODELS[model].channels.map((channel, i) => (
          <ChannelSlider
            key={`${model}-${channel.label}`}
            {...channel}
            value={values[i]!}
            track={tracks[i]!}
            onChange={(value) => {
              const next: Channels = [...values];
              next[i] = value;
              commit(next, true);
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CommitInput
          data-hex-field
          aria-label="Hex"
          reason="A colour such as #1e1e2e"
          value={hex}
          live={(text) => FULL_HEX.test(text.trim())}
          className="min-w-[92px] flex-1"
          onCommit={commitHex}
        />
        <CommitInput
          aria-label={MODELS[model].label}
          reason="A CSS colour, or hsv(h s% v%)"
          value={formatChannels(model, values)}
          className="min-w-46 flex-[3]"
          onCommit={commitText}
        />
      </div>
      {outOfGamut && (
        <p className="-mt-1 text-sm text-muted-foreground">
          Past the hatched edge, Ghostty gets the nearest colour it can show.
        </p>
      )}
    </div>
  );
}

type ChannelSliderProps = Channel & {
  value: number;
  /** CSS background of the track. */
  track: string;
  onChange: (value: number) => void;
};

function ChannelSlider(props: ChannelSliderProps) {
  const {label, name, value, max, decimals, track} = props;
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-3">
      <span aria-hidden className="text-sm font-semibold text-muted-foreground">
        {label}
      </span>
      <Slider
        data-edits
        aria-label={name}
        min={0}
        max={max}
        step={10 ** -decimals}
        largeStep={max / 10}
        value={Math.min(value, max)}
        className="**:data-[slot=slider-track]:h-2! **:data-[slot=slider-track]:[background:var(--track)]!"
        style={
          {"--track": track, "--slider-range": "transparent"} as CSSProperties
        }
        onValueChange={(next) =>
          typeof next === "number" && props.onChange(next)
        }
      />
      <NumberField
        aria-label={`${name} value`}
        value={value.toFixed(decimals)}
        min={0}
        max={max}
        // − / + move a whole unit, or a hundredth on OKLCH's 0-1 scales.
        step={max > 1 ? 1 : 0.01}
        className="w-12"
        onCommit={props.onChange}
      />
    </div>
  );
}
