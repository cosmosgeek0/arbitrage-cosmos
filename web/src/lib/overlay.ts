// Tiny global controller for the big on-demand overlays (news, calendar) so any
// trigger — sidebar button or top-bar icon — can open them, while the overlay
// itself renders at the app root (outside the sidebar's backdrop-filter box).
import { useEffect, useState } from 'react';

export type OverlayKind = 'news' | 'calendar' | null;

let current: OverlayKind = null;
const subs = new Set<(o: OverlayKind) => void>();

export function openOverlay(o: OverlayKind): void {
  current = o;
  for (const fn of subs) fn(current);
}

export function useOverlay(): [OverlayKind, (o: OverlayKind) => void] {
  const [o, setO] = useState<OverlayKind>(current);
  useEffect(() => {
    const fn = (v: OverlayKind) => setO(v);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return [o, openOverlay];
}
