import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Category } from '../db/schema';

export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ' +
  'dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 dark:bg-transparent dark:border-red-800 dark:hover:bg-red-950',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Labelled form field. Use `group` when it wraps several controls (renders a labelled group, not a <label>). */
export function Field({
  label,
  children,
  className = '',
  group = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  group?: boolean;
}) {
  const caption = (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
  );
  if (group) {
    return (
      <div role="group" aria-label={label} className={`block ${className}`}>
        {caption}
        {children}
      </div>
    );
  }
  return (
    <label className={`block ${className}`}>
      {caption}
      {children}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[95vh] w-full ${width} flex-col rounded-t-xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function CategoryBadge({ category }: { category?: Category }) {
  if (!category) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: category.color + '22', color: category.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: category.color }} />
      {category.name}
    </span>
  );
}

export function ProgressBar({ ratio, color = '#4f46e5' }: { ratio: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: color }} />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  color = '#4f46e5',
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] text-white transition"
      style={{ borderColor: color, backgroundColor: checked ? color : 'transparent' }}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {children}
    </p>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
