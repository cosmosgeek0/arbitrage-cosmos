import { useEffect, useState, type ReactNode } from 'react';

export function ConfirmModal({
  title,
  children,
  requireText,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  requireText?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ready = !requireText || typed.trim() === requireText;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">{title}</h2>
        <div>{children}</div>
        {requireText && (
          <div className="confirm-input">
            <label>
              Type <b className="mono">{requireText}</b> to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
        <div className="dialog-actions">
          <button className="mini-btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`cta-pill ${danger ? 'danger' : ''}`} disabled={!ready || busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
