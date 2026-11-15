import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Category } from '../db/schema';

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-300';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-300 dark:text-slate-950 dark:hover:bg-indigo-200',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 dark:bg-transparent dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
  danger: 'text-red-700 border border-red-200 hover:bg-red-50 dark:text-red-300 dark:border-red-900 dark:hover:bg-red-950',
  ghost: 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${variants[variant]} ${className}`}
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
    <span className="mb-1 block text-[13px] font-medium text-slate-600 dark:text-slate-400">{label}</span>
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[95vh] w-full ${width} flex-col rounded-t-2xl bg-white shadow-[0_24px_60px_-20px_rgb(18_22_32/0.45)] dark:bg-slate-900 dark:ring-1 dark:ring-slate-800 sm:rounded-2xl`}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4 pt-2">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** A category as a highlighter mark: ink text on a translucent stroke of the category color. */
export function CategoryBadge({ category }: { category?: Category }) {
  if (!category) return null;
  return (
    <span
      className="op-mark inline-block whitespace-nowrap text-[13px] font-medium text-slate-800 dark:text-slate-100"
      style={{ ['--mark' as string]: category.color }}
    >
      {category.name}
    </span>
  );
}

export function ProgressBar({ ratio, color = '#2340C8' }: { ratio: number; color?: string }) {
  const pct = Math.round(Math.min(1, ratio) * 100);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-[3px_6px_4px_7px] bg-slate-200/70 dark:bg-slate-800">
      <div
        className="h-full rounded-[3px_6px_4px_7px] transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: `color-mix(in srgb, ${color} 70%, transparent)` }}
      />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  color = '#2340C8',
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
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.6px] border-slate-400 text-slate-900 transition-colors hover:border-slate-700 dark:border-slate-500 dark:text-slate-50 dark:hover:border-slate-300"
      style={checked ? { borderColor: 'transparent', backgroundColor: `color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
    >
      {checked && (
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 10.5l3.2 3L15 6.5" />
        </svg>
      )}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

/** Rows separated by hairline rules, like lines on a page. */
export function List({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">{children}</div>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-9">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------------- icons (1.6px line, 20px box) ---------------- */

const ICONS = {
  today: 'M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5 5l1 1M14 14l1 1M5 15l1-1M14 6l1-1M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  calendar: 'M3.5 6.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-8ZM3.5 8.5h13M7 3v3M13 3v3',
  todos: 'M4 6.5l1.5 1.5L8 5.5M4 13l1.5 1.5L8 12M11 7h5M11 13.5h5',
  goals: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10 10h.01',
  settings: 'M4 6h7M15 6h1M4 14h1M9 14h7M13 4v4M7 12v4',
  plus: 'M10 4v12M4 10h12',
  repeat: 'M4 9a5 5 0 0 1 9-3l1.5 1.5M15.5 4v3.5H12M16 11a5 5 0 0 1-9 3L5.5 12.5M4.5 16v-3.5H8',
  flag: 'M5 17V4M5 4h9l-2 3.5 2 3.5H5',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}
