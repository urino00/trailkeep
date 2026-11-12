// Small shared UI pieces: top bar, bottom sheet, dialogs, toasts, toggles.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconBack, IconClose } from './icons';
import { goBack } from './router';

export function TopBar({ title, onBack, right }: { title: string; onBack?: (() => void) | false; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack !== false ? (
        <button className="icon-btn" onClick={onBack ?? goBack} aria-label="Back">
          <IconBack />
        </button>
      ) : (
        <span className="topbar-spacer" />
      )}
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

/** Modal bottom sheet. Closes on backdrop tap or Escape. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export interface ActionItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  hint?: string;
}

/** A list of large tap targets in a bottom sheet (the "⋯" menus). */
export function ActionSheet({ title, items, onClose }: { title: string; items: ActionItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="action-list">
        {items.map((item) => (
          <button
            key={item.label}
            className={`action-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <span className="action-icon">{item.icon}</span>}
            <span className="action-text">
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row${disabled ? ' disabled' : ''}`}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function ProgressBar({ fraction, tone }: { fraction: number; tone?: 'accent' | 'trail' }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className={`bar ${tone ?? 'accent'}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Text prompt in a sheet (used for rename and area names). */
export function PromptSheet({
  title,
  label,
  initial,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ok = value.trim().length > 0;
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onClose();
          onConfirm(value.trim());
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus enterKeyHint="done" />
        </label>
        <button className="btn primary" type="submit" disabled={!ok}>
          {confirmLabel}
        </button>
      </form>
    </Sheet>
  );
}

// --- toasts ----------------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  tone: 'info' | 'error';
}
let toasts: ToastItem[] = [];
let nextToastId = 1;
const toastListeners = new Set<() => void>();

export function toast(text: string, tone: 'info' | 'error' = 'info'): void {
  const item = { id: nextToastId++, text, tone };
  toasts = [...toasts, item];
  toastListeners.forEach((fn) => fn());
  window.setTimeout(
    () => {
      toasts = toasts.filter((t) => t !== item);
      toastListeners.forEach((fn) => fn());
    },
    tone === 'error' ? 7000 : 4000,
  );
}

export function ToastHost() {
  const items = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
  );
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
