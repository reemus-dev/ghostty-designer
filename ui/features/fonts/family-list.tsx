import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import {CheckIcon} from "lucide-react";
import {Truncate} from "@/components/truncate";
import type {FontFamily} from "@/core/bindings";
import {fontFace} from "@/lib/fonts";

const SAMPLE = "if (cell != 0) return a->b; // O0 1lI";
const SKELETON_ROWS = 8;
export const DEFAULT_NAME = "Ghostty's default font";
export const DEFAULT_FONT = "JetBrains Mono";

type FamilyListProps = {
  /** In display order, the saved font first. null while the font scan runs. */
  families: FontFamily[] | null;
  /** Lists Ghostty's default font, the family "", above the installed ones. */
  withDefault: boolean;
  /** The font in the saved config. */
  saved: string | undefined;
  cursor: string;
  listRef: RefObject<HTMLDivElement | null>;
  /** Shows in place of the rows when nothing matches. */
  empty: ReactNode;
  /** `dwell` is true for keyboard moves, which pick after a pause. */
  onMove: (family: string, dwell: boolean) => void;
};

/**
 * Installed fonts, each drawn in its own face with a sample line. A click or
 * the arrows (and j/k) pick a font.
 */
export function FamilyList(props: FamilyListProps) {
  const {families, withDefault, saved = "", cursor, listRef} = props;
  const id = useId();
  /** Null is Ghostty's default font. */
  const rows = families && [...(withDefault ? [null] : []), ...families];
  const names = rows?.map((font) => font?.family ?? "") ?? [];
  const index = names.indexOf(cursor);
  const listedFirst = (name: string | undefined) =>
    name === "" || name === saved;

  // Follows the cursor when it moves, not when the view shows again and
  // reruns effects. Scrolls only the list's own box: scrollIntoView would
  // scroll the page too.
  const scrolledTo = useRef(cursor);
  useEffect(() => {
    if (scrolledTo.current === cursor) return;
    scrolledTo.current = cursor;
    const box = listRef.current?.parentElement;
    const row = listRef.current?.querySelector("[aria-selected=true]");
    if (!box || !row) return;
    const rowRect = row.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const above = Math.min(0, rowRect.top - boxRect.top);
    const below = Math.max(0, rowRect.bottom - boxRect.bottom);
    box.scrollBy({top: above || below});
  }, [cursor, listRef]);

  if (rows === null) {
    return (
      <div aria-busy className="flex flex-col gap-1">
        <p className="px-4 py-2 text-sm text-muted-foreground">
          Scanning installed fonts…
        </p>
        {Array.from({length: SKELETON_ROWS}, (_, i) => (
          <div
            key={i}
            className="flex h-[60px] flex-col justify-center gap-2.5 px-4">
            <span
              className="h-3.5 rounded-sm bg-accent motion-safe:animate-pulse"
              style={{width: `${25 + ((i * 37) % 30)}%`}}
            />
            <span className="h-2.5 w-1/2 rounded-sm bg-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) return props.empty;

  const move = (to: number) => {
    const next = names[Math.max(0, Math.min(names.length - 1, to))];
    if (next !== undefined) props.onMove(next, true);
  };
  const keys: Record<string, () => void> = {
    ArrowDown: () => move(index + 1),
    j: () => move(index + 1),
    ArrowUp: () => move(index - 1),
    k: () => move(index - 1),
    Home: () => move(0),
    End: () => move(names.length - 1),
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label="Installed fonts"
      aria-activedescendant={index === -1 ? undefined : `${id}-${index}`}
      className="flex flex-col gap-0.5 outline-none"
      onKeyDown={onKeyDown}>
      {rows.map((font, i) => {
        const name = names[i]!;
        const fontFamily = font
          ? `"${fontFace(font)}", ui-monospace, monospace`
          : "ui-monospace, monospace";
        const selected = name === cursor;
        const tags = font
          ? [
              font.nerd && "Nerd Font",
              font.ligatures !== null && "Ligatures",
              font.axes.length > 0 && "Variable",
            ]
              .filter(Boolean)
              .join(" · ")
          : `${DEFAULT_FONT}, built in`;
        return (
          <div key={name} className="contents">
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={selected}
              className="group flex shrink-0 cursor-default scroll-my-2 items-center gap-4 rounded-md px-4 py-2 hover:bg-accent aria-selected:bg-selected in-focus-visible:aria-selected:outline-2 in-focus-visible:aria-selected:-outline-offset-2 in-focus-visible:aria-selected:outline-ring"
              style={{
                contentVisibility: "auto",
                containIntrinsicSize: "auto 60px",
              }}
              onClick={() => props.onMove(name, false)}>
              <span
                className="flex min-w-0 flex-1 flex-col gap-[3px]"
                style={{fontFamily}}>
                <span className="flex min-w-0 items-baseline gap-3">
                  <Truncate className="text-[19px] leading-[1.3] text-foreground">
                    {font?.family ?? DEFAULT_NAME}
                  </Truncate>
                  <span className="shrink-0 font-sans text-xs text-muted-foreground">
                    {tags}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="truncate text-base leading-[1.4] text-muted-foreground group-aria-selected:text-foreground">
                  {SAMPLE}
                </span>
              </span>
              {name === saved && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CheckIcon aria-hidden className="size-3" />
                  In your config
                </span>
              )}
            </div>
            {listedFirst(name) &&
              i < names.length - 1 &&
              !listedFirst(names[i + 1]) && (
                <div role="presentation" className="mx-4 my-2 h-px bg-border" />
              )}
          </div>
        );
      })}
    </div>
  );
}
