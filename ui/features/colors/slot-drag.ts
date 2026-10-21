import {type DragEvent, useState} from "react";
import {colorValues} from "@/core/values";
import {SWATCH_ORDER} from "@/lib/customise";
import {describeSlot, type SlotId} from "@/lib/slots";
import {send, setColor} from "@/lib/store";

const DRAG_TYPE = "application/x-color-slot";

/**
 * Dragging a swatch onto another swaps the two colours, or copies onto the
 * target with ⌥ held. `over` is the swatch a drag is over.
 */
export function useSlotDrag(hexOf: (id: SlotId) => string) {
  const [over, setOver] = useState<SlotId | null>(null);

  const drop = (event: DragEvent, to: SlotId) => {
    event.preventDefault();
    setOver(null);
    const from = event.dataTransfer.getData(DRAG_TYPE);
    if (from === to || !SWATCH_ORDER.includes(from)) return;
    const copy = event.altKey || event.dataTransfer.dropEffect === "copy";
    const writes: [SlotId, string][] = copy
      ? [[to, hexOf(from)]]
      : [
          [from, hexOf(to)],
          [to, hexOf(from)],
        ];
    const [a, b] = [describeSlot(from).title, describeSlot(to).title];
    void send({
      type: "set-many",
      values: colorValues(writes),
      label: copy ? `Copy ${a} to ${b}` : `Swap ${a} and ${b}`,
    });
    setColor(to);
  };

  const dragProps = (id: SlotId) => ({
    draggable: true,
    onDragLeave: () => setOver(null),
    onDrop: (event: DragEvent) => drop(event, id),
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = "copyMove";
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
      setOver(id);
    },
  });

  return {over, dragProps};
}

export type SlotDragProps = ReturnType<
  ReturnType<typeof useSlotDrag>["dragProps"]
>;
