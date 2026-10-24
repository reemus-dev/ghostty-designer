import {cn} from "cn";
import {Swatch} from "@/components/swatch";
import type {ThemeSummary} from "@/core/types";
import {describeSlot, setSlot, type SlotId, themeSlot} from "@/lib/slots";
import {send, setColor} from "@/lib/store";
import type {SlotDragProps} from "./slot-drag";

/**
 * One colour: its swatch, the reference theme's colour under it, and its hex.
 * `named` lays it out as a row with its name, for the basics.
 */
export function SwatchTile(props: {
  id: SlotId;
  named: boolean;
  hex: string;
  selected: boolean;
  changed: boolean;
  warning: boolean;
  dropTarget: boolean;
  reference: ThemeSummary | undefined;
  dragProps: SlotDragProps;
}) {
  const {id, named, hex, selected, reference} = props;
  const title = describeSlot(id).title;
  return (
    <div
      {...props.dragProps}
      title={named ? undefined : title}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-1.5",
        named && "flex-row items-center gap-2.5",
      )}
      onClick={() => setColor(id)}>
      <span className={cn("flex flex-col gap-[3px]", named && "w-8 shrink-0")}>
        <button
          type="button"
          data-color={id}
          aria-pressed={selected}
          aria-label={`${title} ${hex}`}
          tabIndex={selected ? 0 : -1}
          className="block rounded-md">
          <Swatch
            color={hex}
            changed={props.changed}
            warning={props.warning}
            selected={selected}
            className={cn(
              named && "size-8",
              props.dropTarget &&
                !selected &&
                "ring-2 ring-muted-foreground ring-offset-2 ring-offset-card",
            )}
          />
        </button>
        {reference && (
          <ReferenceStrip
            reference={reference}
            id={id}
            hex={themeSlot(reference.colors, id)}
            title={title}
          />
        )}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-col items-center leading-tight",
          named && "items-start",
        )}>
        {named && (
          <span
            className={cn(
              "max-w-full truncate text-base",
              selected ? "text-foreground" : "text-muted-foreground",
            )}>
            {title}
          </span>
        )}
        <code
          className={cn(
            "px-px text-2xs",
            selected ? "text-foreground" : "text-muted-foreground",
          )}>
          {hex.slice(1)}
        </code>
      </span>
    </div>
  );
}

/**
 * The reference theme's colour under the user's: a click uses it. Mouse only:
 * the colour editor offers the same for the selected colour from the keyboard.
 */
function ReferenceStrip(props: {
  reference: ThemeSummary;
  id: SlotId;
  hex: string | undefined;
  title: string;
}) {
  const {reference, id, hex, title} = props;
  if (hex === undefined) {
    return (
      <span
        title={`${reference.name} leaves ${title.toLowerCase()} unset`}
        className="h-2 rounded-[3px] inset-ring inset-ring-border"
      />
    );
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      title={`Use ${reference.name}'s ${title.toLowerCase()}, ${hex}`}
      className="h-2 cursor-pointer rounded-[3px] inset-ring inset-ring-border outline-none hover:ring-[1.5px] hover:ring-muted-foreground"
      style={{background: hex}}
      onClick={() =>
        void send(setSlot(id, hex, `${title} from ${reference.name}`))
      }
    />
  );
}
