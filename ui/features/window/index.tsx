import {type ReactNode, useMemo} from "react";
import {MousePointerClickIcon} from "lucide-react";
import {Card} from "@/components/card";
import {NumberField} from "@/components/commit-input";
import {
  OptionControl,
  OptionRow,
  SliderField,
} from "@/components/option-control";
import {PageSection} from "@/components/page";
import {Switch} from "@/components/ui/switch";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import type {OptionMeta} from "@/core/types";
import {PLATFORM_LABEL, windowCards} from "@/lib/customise";
import {send, sendLive, useEffective, useSnapshot} from "@/lib/store";
import {useAppName} from "@/lib/views";

/**
 * Window and cursor options in cards, then every option only for the other
 * platform in a card of its own.
 */
export function WindowSection() {
  const options = useSnapshot((snapshot) => snapshot.options);
  const platform = useSnapshot((snapshot) => snapshot.ghostty.platform);

  const layout = useMemo(
    () => windowCards(options, platform),
    [options, platform],
  );

  return (
    <PageSection id="window">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {layout.columns.map((column) => (
            <div key={column[0]!.label} className="flex flex-col gap-5">
              {column.map((section) => (
                <Card key={section.label} label={section.label}>
                  <div className="-mt-2 flex flex-col">
                    {section.options.map((option) => (
                      <Option key={option.key} option={option} />
                    ))}
                    {section.label === "Cursor" && <FocusNote />}
                  </div>
                </Card>
              ))}
            </div>
          ))}
        </div>
        {layout.elsewhere.options.length > 0 && (
          <Card
            label={layout.elsewhere.label}
            aside={`For a config shared with ${PLATFORM_LABEL[layout.elsewhere.platform]}`}>
            <OptionList options={layout.elsewhere.options} />
          </Card>
        )}
      </div>
    </PageSection>
  );
}

/** Rows in two columns when wide. */
function OptionList(props: {options: OptionMeta[]}) {
  const {options} = props;
  const half = Math.ceil(options.length / 2);
  return (
    <div className="-mt-2 grid grid-cols-1 gap-x-10 lg:grid-cols-2">
      {[options.slice(0, half), options.slice(half)].map((column) => (
        <div key={column[0]?.key} className="flex flex-col">
          {column.map((option) => (
            <OptionControl key={option.key} option={option} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Option(props: {option: OptionMeta}) {
  const {option} = props;
  switch (option.key) {
    case "background-blur": {
      return <BlurOption option={option} />;
    }
    case "cursor-style": {
      return (
        <OptionRow option={option}>
          <CursorShapeToggle />
        </OptionRow>
      );
    }
    case "cursor-style-blink": {
      return <BlinkOption option={option} />;
    }
    case "shell-integration-features": {
      return <PromptCursorOption option={option} />;
    }
    case "window-padding-x":
    case "window-padding-y": {
      return <PaddingOption option={option} />;
    }
    default: {
      return <OptionControl option={option} />;
    }
  }
}

function useFirstValue(option: OptionMeta) {
  return useEffective(option.key)?.[0] ?? option.defaults[0] ?? "";
}

function FocusNote() {
  const app = useAppName();
  return (
    <p className="flex items-start gap-2 border-t pt-3 text-sm text-muted-foreground">
      <MousePointerClickIcon
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      Unfocused windows show a hollow block. Click into {app} to see your
      cursor.
    </p>
  );
}

/**
 * Shell integration's cursor feature, inverted: off lets the cursor style and
 * blink above show at the prompt.
 */
function PromptCursorOption(props: {option: OptionMeta}) {
  const {option} = props;
  const flags = useFirstValue(option).split(",");
  const label = "Use this cursor at the shell prompt";
  return (
    <OptionRow option={{...option, label}}>
      <Switch
        aria-label={label}
        checked={flags.includes("no-cursor")}
        onCheckedChange={(checked) =>
          void send({
            type: "set-flag",
            key: option.key,
            flag: "cursor",
            on: !checked,
          })
        }
      />
    </OptionRow>
  );
}

const PADDING_MAX = 40;

/**
 * Padding as "2", or "2,4" for the start and end sides, in whole points. The
 * slider sets both sides; the field takes either form.
 */
function PaddingOption(props: {option: OptionMeta}) {
  const {option} = props;
  const value = useFirstValue(option).replaceAll(" ", "");
  const [firstSide = ""] = value.split(",");
  const set = (next: string) =>
    sendLive({type: "set", key: option.key, values: [next]});
  return (
    <OptionRow option={option}>
      <SliderField
        label={option.label}
        min={0}
        max={PADDING_MAX}
        step={1}
        value={Math.trunc(Number(firstSide)) || 0}
        unit="pt"
        onSlide={(next) => set(String(next))}>
        <NumberField
          whole
          aria-label={`${option.label} value`}
          reason={`Whole points, or two for ${option.key.endsWith("-x") ? "left and right" : "top and bottom"}, such as 2,4`}
          value={value}
          min={0}
          onCommit={(next) => set(String(next))}
          onCommitText={(text) => {
            const sides = text.replaceAll(" ", "").split(",");
            if (sides.length > 2 || sides.some((side) => !/^\d+$/.test(side)))
              return false;
            set(sides.map(Number).join(","));
          }}
        />
      </SliderField>
    </OptionRow>
  );
}

/**
 * `write` is the config value. Toggle values are never empty: Base UI replaces
 * an empty one with a generated id.
 */
const BLINK = [
  {
    value: "default",
    write: "",
    label: "Default",
    title: "Blinks, unless a program asks it to stop",
  },
  {value: "true", write: "true", label: "True", title: "Always blinks"},
  {value: "false", write: "false", label: "False", title: "Never blinks"},
];

function BlinkOption(props: {option: OptionMeta}) {
  const {option} = props;
  const value = useFirstValue(option);
  const pressed = BLINK.find((choice) => choice.write === value)?.value;
  return (
    <OptionRow option={option}>
      <ToggleGroup
        aria-label={option.label}
        value={pressed ? [pressed] : []}
        onValueChange={(next) => {
          const choice = BLINK.find((item) => item.value === next[0]);
          if (choice) {
            void send({type: "set", key: option.key, values: [choice.write]});
          }
        }}>
        {BLINK.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            title={choice.title}>
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </OptionRow>
  );
}

/** Ghostty's radius for `background-blur = true`. */
const DEFAULT_BLUR = 20;
/** Ghostty reads the radius as one byte. */
const BLUR_MAX = 255;
const GLASS = new Set(["macos-glass-regular", "macos-glass-clear"]);
/** What choosing each blur mode writes. */
const BLUR_MODES: Record<string, string> = {
  off: "false",
  on: "true",
  glass: "macos-glass-regular",
};

/**
 * `background-blur` as Off / On / Glass, with the radius or the glass style on
 * a second row. Glass is offered on macOS only.
 */
function blurMode(value: string, radius: number) {
  if (GLASS.has(value)) return "glass";
  return radius > 0 ? "on" : "off";
}

function BlurOption(props: {option: OptionMeta}) {
  const {option} = props;
  const value = useFirstValue(option);
  const macos = useSnapshot(
    (snapshot) => snapshot.ghostty.platform === "macos",
  );
  const set = (next: string) =>
    void send({type: "set", key: option.key, values: [next]});

  const radius = value === "true" ? DEFAULT_BLUR : Number(value) || 0;
  const mode = blurMode(value, radius);

  return (
    <>
      <OptionRow option={option}>
        <ToggleGroup
          aria-label={option.label}
          value={[mode]}
          onValueChange={(next) => {
            const write = next[0] && BLUR_MODES[next[0]];
            if (write) set(write);
          }}>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          {macos && <ToggleGroupItem value="glass">Glass</ToggleGroupItem>}
        </ToggleGroup>
      </OptionRow>
      {mode === "on" && (
        <SubRow label="Radius">
          <SliderField
            label="Blur radius"
            min={1}
            max={60}
            step={1}
            value={radius}
            onSlide={(next) =>
              sendLive({type: "set", key: option.key, values: [String(next)]})
            }>
            <NumberField
              whole
              aria-label="Blur radius value"
              value={String(radius)}
              min={1}
              max={BLUR_MAX}
              onCommit={(next) =>
                sendLive({type: "set", key: option.key, values: [String(next)]})
              }
            />
          </SliderField>
        </SubRow>
      )}
      {mode === "glass" && (
        <SubRow
          label="Glass"
          note="macOS 26 and later · the titlebar changes in new windows">
          <ToggleGroup
            aria-label="Glass style"
            value={[value]}
            onValueChange={(next) => next[0] && set(next[0])}>
            <ToggleGroupItem value="macos-glass-regular">
              Regular
            </ToggleGroupItem>
            <ToggleGroupItem value="macos-glass-clear">Clear</ToggleGroupItem>
          </ToggleGroup>
        </SubRow>
      )}
    </>
  );
}

/** A follow-up control for the row above, without its own reset. */
function SubRow(props: {label: string; note?: string; children: ReactNode}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 pb-1.5 pl-4">
      <div className="flex flex-1 flex-col gap-px text-pretty">
        <span className="text-muted-foreground">{props.label}</span>
        {props.note && (
          <small className="text-sm text-muted-foreground">{props.note}</small>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1.5">{props.children}</div>
    </div>
  );
}

const CURSOR_SHAPES = [
  {
    value: "block",
    label: "Block",
    icon: <rect x="4.5" y="2.5" width="7" height="11" rx="1" />,
  },
  {
    value: "bar",
    label: "Bar",
    icon: <rect x="5" y="2.5" width="2" height="11" rx="1" />,
  },
  {
    value: "underline",
    label: "Underline",
    icon: <rect x="3" y="11.5" width="10" height="2" rx="1" />,
  },
  {
    value: "block_hollow",
    label: "Block hollow",
    icon: (
      <rect
        x="5.25"
        y="3.25"
        width="5.5"
        height="9.5"
        rx="0.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ),
  },
];

/** Cursor-style as icons, each named in its tooltip. */
function CursorShapeToggle() {
  const value = useEffective("cursor-style")?.[0] ?? "block";
  return (
    <ToggleGroup
      aria-label="Cursor shape"
      value={[value]}
      onValueChange={(next) =>
        next[0] &&
        void send({type: "set", key: "cursor-style", values: [next[0]]})
      }>
      {CURSOR_SHAPES.map((shape) => (
        <ToggleGroupItem
          key={shape.value}
          value={shape.value}
          aria-label={shape.label}
          title={shape.label}
          className="w-9 px-0">
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 fill-current">
            {shape.icon}
          </svg>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
