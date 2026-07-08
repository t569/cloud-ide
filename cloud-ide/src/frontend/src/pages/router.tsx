// Minimal History-API router — zero deps, enough for a handful of top-level
// endpoints (/environments, /editor/:sandboxId, /sandboxes). Upgrade to
// react-router only when routes nest or need loaders. ponytail: no dependency
// for a flat route table.
//
// useLocation() re-renders on back/forward (popstate) and on our own navigate()
// (a synthetic 'locationchange' event, since pushState fires no event).
import { useSyncExternalStore } from 'react';

const LOCATION_CHANGE = 'locationchange';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(LOCATION_CHANGE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(LOCATION_CHANGE, onChange);
  };
}

const getSnapshot = () => window.location.pathname + window.location.search;

/** Current `pathname + search`, kept in sync with the browser history. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Push a new URL and notify subscribers. No-op if already there. */
export function navigate(to: string): void {
  if (to === getSnapshot()) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(LOCATION_CHANGE));
}
