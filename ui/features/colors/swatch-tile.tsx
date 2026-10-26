import {cn} from "cn";
import {Swatch} from "@/components/swatch";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import type {ThemeSummary} from "@/core/types";
import {describeSlot, setSlot, type SlotId, themeSlot} from "@/lib/slots";
import {send, setColor} from "@/lib/store";
import type {SlotDragProps} from "./slot-drag";

const CORNERS = {top: "rounded-b-none", bottom: "rounded-t-none"};

/**
 * One colour: its swatch, which grows to fill the tile, and the reference
 * theme's colour under it. `half` joins it to the other colour of its column.
 */
export function SwatchTile(props: {
  id: SlotId;
  half?: "top" | "bottom";
  hex: string;
  selected: boolean;
  changed: boolean;
  warning: boolean;
  dropTarget: boolean;
  reference: ThemeSummary | undefined;
  dragProps: SlotDragProps;
}) {
  const {id, half, hex, selected, reference} = props;
  const title = describeSlot(id).title;
  return (
    <div
      {...props.dragProps}
      className="flex min-w-0 cursor-pointer flex-col gap-[3px]"
      onClick={() => setColor(id)}>
      <button
        type="button"
        data-color={id}
        aria-pressed={selected}
        aria-label={`${title} ${hex}`}
        tabIndex={selected ? 0 : -1}
        className={cn(
          "flex flex-1 flex-col rounded-md",
          half && CORNERS[half],
        )}>
        <Swatch
          color={hex}
          changed={props.changed}
          warning={props.warning}
          selected={selected}
          className={cn(
            "h-auto min-h-7 flex-1",
            half && CORNERS[half],
            selected && "z-10",
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
  const name = title.toLowerCase();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          hex === undefined ? (
            <span className="h-2 rounded-[3px] inset-ring inset-ring-border" />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              className="h-2 cursor-pointer rounded-[3px] inset-ring inset-ring-border outline-none hover:ring-[1.5px] hover:ring-muted-foreground"
              style={{background: hex}}
              onClick={() =>
                void send(setSlot(id, hex, `${title} from ${reference.name}`))
              }
            />
          )
        }
      />
      <TooltipContent>
        {hex === undefined
          ? `${reference.name} leaves ${name} unset`
          : `Use ${reference.name}'s ${name}, ${hex}`}
      </TooltipContent>
    </Tooltip>
  );
}
