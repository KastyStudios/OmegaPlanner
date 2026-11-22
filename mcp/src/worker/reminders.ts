/*
 * Which reminders to push in one run of the minute-by-minute cron. Each run owns the window
 * [t - 30 s, t + 30 s) around its scheduled time, so consecutive runs neither miss nor repeat a
 * reminder and no "already sent" state has to be stored.
 */
import { format } from 'date-fns';
import { expandOccurrences } from '../../../src/domain/recurrence';
import { reminderLabel } from '../../../src/domain/reminders';
import { local } from '../../../src/lib/zone';
import type { Data } from '../planner';
import type { PushMessage } from './webpush';

const HALF_MINUTE = 30_000;
/** Longest reminder offset the app offers (1 week), so the expansion window covers it. */
const MAX_OFFSET = 7 * 24 * 3_600_000;

export function remindersDue(data: Data, scheduledTime: number): PushMessage[] {
  const from = scheduledTime - HALF_MINUTE;
  const to = scheduledTime + HALF_MINUTE;
  const items = data.items.filter((i) => i.start && i.reminders?.length);
  if (!items.length) return [];
  const occurrences = expandOccurrences(items, data.overrides, data.completions, {
    start: new Date(from - 3_600_000),
    end: new Date(to + MAX_OFFSET),
  });
  const out: PushMessage[] = [];
  for (const o of occurrences) {
    if (o.done) continue;
    for (const m of o.item.reminders) {
      const fireAt = Date.parse(o.start) - m * 60_000;
      if (fireAt < from || fireAt >= to) continue;
      const when = o.allDay ? format(local(o.start), 'EEE d MMM') : format(local(o.start), 'HH:mm');
      out.push({
        title: o.title,
        body: `${o.item.kind === 'deadline' ? 'Due' : 'Starts'} ${when} · ${reminderLabel(m)}`,
        // Same tag as the app's own notifications, so an open app and a push don't show twice.
        tag: `${o.key}|${m}`,
        url: '/',
      });
    }
  }
  return out;
}
