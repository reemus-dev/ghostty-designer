import {Fragment} from "react";
import {cn} from "cn";
import {Truncate} from "@/components/truncate";
import {tildePath} from "@/lib/paths";

/**
 * A path with the home folder as ~, which wraps only after a slash so each name
 * stays whole.
 */
export function Path(props: {path: string}) {
  const parts = tildePath(props.path).split("/");
  return parts.map((part, i) => {
    const slash = i < parts.length - 1;
    return (
      // oxlint-disable-next-line react/no-array-index-key -- a part's index is its place in the path
      <Fragment key={i}>
        <span className="whitespace-nowrap">
          {part}
          {slash && "/"}
        </span>
        {slash && <wbr />}
      </Fragment>
    );
  });
}

/**
 * A path on one line, cut at its start so the file name stays in view. The
 * right-to-left box puts the ellipsis first, and the isolate keeps the path's
 * own order.
 */
export function TruncatedPath(props: {path: string; className?: string}) {
  return (
    <Truncate className={cn("text-left [direction:rtl]", props.className)}>
      <bdi>{tildePath(props.path)}</bdi>
    </Truncate>
  );
}
