/* Shared screener chrome (extracted from Markets): the Coinbase pill dropdown,
   its chevron, and the numbered-page window. One implementation, every page. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const Chev = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function PillSelect<T extends string>({
  icon,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  icon?: ReactNode;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const cur = options.find((o) => o.id === value);
  return (
    <div className="mkx-pillwrap" ref={ref}>
      <button type="button" className="mkx-pill" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((x) => !x)}>
        {icon}
        <span>{cur?.label ?? value}</span>
        <span className={`mkx-chev ${open ? 'up' : ''}`}><Chev /></span>
      </button>
      {open && (
        <div className="mkx-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={o.id === value ? 'sel' : ''}
              onClick={() => { onChange(o.id); setOpen(false); }}
            >
              {o.label}
              {o.id === value && (
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                  <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Coinbase page list: 1 2 3 … last with a sliding window around the page. */
export function pageList(current: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  if (current <= 2) return [0, 1, 2, '…', pages - 1];
  if (current >= pages - 3) return [0, '…', pages - 3, pages - 2, pages - 1];
  return [0, '…', current - 1, current, current + 1, '…', pages - 1];
}

/** The Markets watchlist star — one implementation for every asset table. */
export function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={`mkx-star ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
      aria-label={on ? 'Remove from watchlist' : 'Add to watchlist'}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <polygon points="12 2.5 15 8.8 22 9.7 17 14.5 18.2 21.2 12 18 5.8 21.2 7 14.5 2 9.7 9 8.8 12 2.5" />
      </svg>
    </button>
  );
}
