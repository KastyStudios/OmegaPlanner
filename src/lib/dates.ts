import { addDays, format, isSameDay, isToday, isTomorrow, isYesterday } from 'date-fns';
import { local } from './zone';

export const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');
export const toTimeInput = (d: Date) => format(d, 'HH:mm');

/** Local Date from 'yyyy-MM-dd' and optional 'HH:mm'. */
export function fromInputs(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}

export function nextFullHour(from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function friendlyDay(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE d MMM');
}

/** "18:00 – 19:00", "All day", "Due 17:00" ... */
export function timeLabel(start: string, end: string, allDay: boolean, kind: string): string {
  const s = local(start);
  const e = local(end);
  if (kind === 'deadline') return allDay ? 'Due' : `Due ${format(s, 'HH:mm')}`;
  if (allDay) {
    const lastDay = addDays(e, -1);
    return isSameDay(s, lastDay) || e <= s ? 'All day' : `${format(s, 'd MMM')} – ${format(lastDay, 'd MMM')}`;
  }
  if (isSameDay(s, e)) return `${format(s, 'HH:mm')} – ${format(e, 'HH:mm')}`;
  return `${format(s, 'HH:mm')} – ${format(e, 'd MMM HH:mm')}`;
}
