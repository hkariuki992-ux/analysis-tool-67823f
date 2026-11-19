import { useEffect, useSyncExternalStore } from "react";
import { feed } from "./feed";

/** Re-renders the caller whenever the feed publishes (throttled to ~4 fps). */
export function useFeed() {
  useEffect(() => feed.start(), []);
  useSyncExternalStore(
    (cb) => feed.subscribe(cb),
    () => feed.version,
  );
  return feed;
}
