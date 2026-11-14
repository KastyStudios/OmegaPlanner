import { format } from 'date-fns';
import { db } from '../db/db';
import { expandOccurrences } from '../domain/recurrence';
import { dueReminders, reminderLabel } from '../domain/reminders';

const FIRED_KEY = 'omegaplanner.firedReminders';
const CHECK_MS = 30_000;
const MAX_REMINDER_MS = 7 * 24 * 3_600_000;

function loadFired(): Map<string, number> {
  try {
    return new Map(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]'));
  } catch {
    return new Map();
  }
}

function saveFired(m: Map<string, number>) {
  // Forget entries older than 2 days to keep storage small.
  const cutoff = Date.now() - 2 * 24 * 3_600_000;
  for (const [k, t] of m) if (t < cutoff) m.delete(k);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...m]));
  } catch {
    /* storage unavailable: duplicates possible after reload, acceptable */
  }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function checkReminders(now = new Date()): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const [items, overrides, completions] = await Promise.all([
    db.items.filter((i) => i.reminders?.length > 0 && !!i.start).toArray(),
    db.overrides.toArray(),
    db.completions.toArray(),
  ]);
  if (!items.length) return;
  const occ = expandOccurrences(items, overrides, completions, {
    start: new Date(now.getTime() - 3_600_000),
    end: new Date(now.getTime() + MAX_REMINDER_MS),
  });
  const fired = loadFired();
  const due = dueReminders(occ, now, new Set(fired.keys()));
  for (const r of due) {
    const o = r.occurrence;
    const when = o.allDay ? 'today' : format(new Date(o.start), 'HH:mm');
    new Notification(o.title, {
      body: `${o.item.kind === 'deadline' ? 'Due' : 'Starts'} ${when} · ${reminderLabel(r.minutesBefore)}`,
      tag: r.key,
      icon: '/favicon.svg',
    });
    fired.set(r.key, now.getTime());
  }
  if (due.length) saveFired(fired);
}

/** Starts polling for due reminders; returns a stop function. */
export function startReminderService(): () => void {
  void checkReminders();
  const id = window.setInterval(() => void checkReminders(), CHECK_MS);
  return () => window.clearInterval(id);
}
