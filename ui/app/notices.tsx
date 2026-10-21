import {cn} from "cn";
import {useStore} from "@/lib/store";

/** The transient notice: undo feedback, request errors, one-time explanations. */
export function NoticeLine() {
  const notice = useStore((store) => store.notice);
  if (!notice) return null;
  return (
    <div
      key={notice.id}
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-none absolute bottom-4 left-1/2 z-20 w-max max-w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2 animate-in rounded-2xl bg-raised px-4 py-2.5 text-base shadow-[inset_0_0_0_1px_var(--color-line-2),0_16px_40px_rgb(0_0_0/50%)] fade-in-0 slide-in-from-bottom-1",
        notice.tone === "error" ? "text-warn" : "text-fg",
      )}>
      {notice.text}
    </div>
  );
}
