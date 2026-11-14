import type { Occurrence } from './recurrence';

export interface DueReminder {
  key: string;
  occurrence: Occurrence;
  minutesBefore: number;
}

/** Reminders whose time has come (within `graceMs`) and that haven't fired yet. */
export function dueReminders(
  occurrences: Occurrence[],
  now: Date,
  fired: Set<string>,
  graceMs = 10 * 60_000,
): DueReminder[] {
  const out: DueReminder[] = [];
  const t = now.getTime();
  for (const occ of occurrences) {
    if (occ.done) continue;
    for (const m of occ.item.reminders ?? []) {
      const key = `${occ.key}|${m}`;
      const fireAt = Date.parse(occ.start) - m * 60_000;
      if (fireAt <= t && t - fireAt <= graceMs && !fired.has(key)) {
        out.push({ key, occurrence: occ, minutesBefore: m });
      }
    }
  }
  return out;
}

export function reminderLabel(m: number): string {
  if (m === 0) return 'At start';
  if (m < 60) return `${m} min before`;
  if (m < 1440) return `${m / 60} h before`;
  return `${m / 1440} day${m === 1440 ? '' : 's'} before`;
}
