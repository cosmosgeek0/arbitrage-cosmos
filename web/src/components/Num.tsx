import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Number-only flash on change (Signal Lab rule: flash the value, never the
 * row/box). Compares the numeric `value` between renders and pulses the
 * green/red color animation once.
 */
export function Num({
  value,
  className,
  children,
}: {
  value: number | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === undefined || p === null || value === null || value === undefined || p === value) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // restart animation
    el.classList.add(value > p ? 'flash-up' : 'flash-down');
    // Under the app's :root zoom, color keyframes can freeze at their final
    // frame instead of reverting — remove the class once the pulse is over so
    // the value returns to neutral ink (static class changes always repaint).
    const t = window.setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 950);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <span ref={ref} className={`num ${className ?? ''}`}>
      {children}
    </span>
  );
}
