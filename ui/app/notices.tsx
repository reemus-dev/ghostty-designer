import {TriangleAlertIcon} from "lucide-react";
import {useStore} from "@/lib/store";

/** The transient notice: undo feedback, request errors, one-time explanations. */
export function NoticeLine() {
  const notice = useStore((store) => store.notice);
  if (!notice) return null;
  const error = notice.tone === "error";
  return (
    <div
      key={notice.id}
      role={error ? "alert" : "status"}
      className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex w-max max-w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2 animate-in gap-2 rounded-2xl bg-popover px-4 py-2.5 text-base text-foreground popup fade-in-0 slide-in-from-bottom-1">
      {error && (
        <TriangleAlertIcon
          aria-hidden
          className="mt-[3px] size-4 shrink-0 text-warn"
        />
      )}
      {notice.text}
    </div>
  );
}
