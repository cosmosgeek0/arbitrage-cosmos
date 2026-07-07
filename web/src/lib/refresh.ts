// A global "refresh now" signal. The top-bar refresh button fires it after it
// has re-pulled the shared state/markets and forced a server-side resync; any
// page that fetches its own data can subscribe to also re-pull immediately,
// without a full page reload.
import { useEffect, useRef } from 'react';

const REFRESH_EVT = 'cosmos:refresh';

export function fireRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVT));
}

/** Run `fn` whenever a global refresh is requested. `fn` may change freely. */
export function useRefreshSignal(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(REFRESH_EVT, h);
    return () => window.removeEventListener(REFRESH_EVT, h);
  }, []);
}
