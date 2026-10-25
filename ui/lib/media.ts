import {useCallback, useSyncExternalStore} from "react";

/** Tailwind's `md` breakpoint, for layouts that change in script. */
export const MD = "(min-width: 48rem)";

/** Whether the window matches a media query, following it as it resizes. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
