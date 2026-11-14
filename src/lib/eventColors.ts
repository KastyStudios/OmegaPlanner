import { useSyncExternalStore } from 'react';

/** Suggested item background colors (light enough for readable dark text, or dark enough for white). */
export const ITEM_COLOR_PRESETS = [
  '#e0e7ff', // indigo
  '#dbeafe', // blue
  '#ccfbf1', // teal
  '#dcfce7', // green
  '#fef9c3', // yellow
  '#ffedd5', // orange
  '#fee2e2', // red
  '#fce7f3', // pink
  '#f3e8ff', // purple
  '#e2e8f0', // slate
  '#4f46e5', // strong indigo
  '#0f766e', // strong teal
  '#b91c1c', // strong red
  '#334155', // strong slate
];

/* ---------------- default background (per browser, like the theme) ---------------- */

const KEY = 'omegaplanner.eventBg';
const EVENT = 'omegaplanner:eventBg';

export function getDefaultItemColor(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** `null` = follow the theme (light/dark neutral). */
export function setDefaultItemColor(color: string | null): void {
  try {
    if (color) localStorage.setItem(KEY, color);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: setting lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useDefaultItemColor(): string | null {
  return useSyncExternalStore(subscribe, getDefaultItemColor, () => null);
}

/* ---------------- color math ---------------- */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or white text, whichever contrasts more with `bg`. */
export function textOn(bg: string): string {
  const l = luminance(bg);
  const dark = (l + 0.05) / (luminance('#0f172a') + 0.05);
  const light = 1.05 / (l + 0.05);
  return dark >= light ? '#0f172a' : '#ffffff';
}

/** Mix a color towards black by `amount` (0..1). */
export function darken(hex: string, amount: number): string {
  return '#' + rgb(hex).map((v) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0')).join('');
}

export interface ItemColors {
  bg: string;
  fg: string;
  border: string;
}

/**
 * Colors for a calendar item. Without an item or default color, CSS variables give a
 * neutral background that follows light/dark mode (see index.css).
 */
export function itemColors(itemColor: string | undefined, defaultColor: string | null): ItemColors {
  const c = itemColor ?? defaultColor;
  if (!c) return { bg: 'var(--op-event-bg)', fg: 'var(--op-event-fg)', border: 'var(--op-event-border)' };
  return { bg: c, fg: textOn(c), border: darken(c, 0.18) };
}
