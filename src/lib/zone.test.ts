import { describe, expect, it } from 'vitest';
import type { Item } from '../db/schema';
import { goalProgress } from '../domain/goals';
import { expandOccurrences } from '../domain/recurrence';
import { editOccurrence } from '../domain/seriesEdit';
import { timeLabel } from './dates';
import { localDate } from './zone';
import { inBothModes } from './zoneTesting';

const item = (over: Partial<Item>): Item => ({
  id: 'i',
  kind: 'event',
  title: 'x',
  allDay: false,
  exdates: [],
  reminders: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const range = (from: string, to: string) => ({ start: new Date(from), end: new Date(to) });
const starts = (items: Item[], from: string, to: string) =>
  expandOccurrences(items, [], [], range(from, to)).map((o) => `${o.start}..${o.end}`);

describe('time zone: browser and worker agree', () => {
  it('keeps a weekly 18:00 at 18:00 local across both DST changes', () => {
    const [a, b] = inBothModes(() =>
      starts([item({ start: '2026-03-23T17:00:00.000Z', end: '2026-03-23T18:00:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' })], '2026-03-23T00:00:00Z', '2026-11-05T00:00:00Z'),
    );
    expect(b).toEqual(a);
    expect(a).toContain('2026-03-30T16:00:00.000Z..2026-03-30T17:00:00.000Z'); // summer time
    expect(a).toContain('2026-11-02T17:00:00.000Z..2026-11-02T18:00:00.000Z'); // winter time
  });

  it('expands late-evening and all-day series on the right local days', () => {
    const [a, b] = inBothModes(() => [
      starts([item({ start: '2026-01-05T22:30:00.000Z', end: '2026-01-05T23:30:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO' })], '2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      starts([item({ allDay: true, start: '2026-03-27T23:00:00.000Z', end: '2026-03-28T23:00:00.000Z', rrule: 'FREQ=DAILY;COUNT=4' })], '2026-03-01T00:00:00Z', '2026-04-10T00:00:00Z'),
      starts([item({ start: '2026-01-31T09:00:00.000Z', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' })], '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'),
    ]);
    expect(b).toEqual(a);
    // The all-day item stays midnight to midnight local, also over the DST night (Mar 29).
    expect(a[1]).toContain('2026-03-28T23:00:00.000Z..2026-03-29T22:00:00.000Z');
  });

  it('splits a series ("this and following") the same way', () => {
    const [a, b] = inBothModes(() => {
      const gym = item({ start: '2026-10-05T16:00:00.000Z', end: '2026-10-05T17:00:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
      const occ = expandOccurrences([gym], [], [], range('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z'))[0];
      const cs = editOccurrence({ item: gym, overrides: [], completions: [] }, occ, { start: '2026-11-02T18:00:00.000Z', end: '2026-11-02T19:00:00.000Z' }, 'following');
      return cs.putItems.map((i) => ({ start: i.start, end: i.end, rrule: i.rrule }));
    });
    expect(b).toEqual(a);
  });

  it('counts habit goals per local week and month', () => {
    const [a, b] = inBothModes(() => {
      const gym = item({ id: 'g', goalId: 'goal', start: '2026-11-01T22:30:00.000Z', end: '2026-11-01T23:00:00.000Z', rrule: 'FREQ=DAILY' });
      const completions = ['2026-11-01T22:30:00.000Z', '2026-11-30T22:30:00.000Z', '2026-10-31T22:30:00.000Z'].map((s, i) => ({
        id: `c${i}`,
        itemId: 'g',
        occurrenceStart: s,
        completedAt: s,
      }));
      const goal = (period: 'week' | 'month') => ({ id: 'goal', title: 'G', mode: 'habit' as const, habitTarget: { count: 1, period }, createdAt: '' });
      // 1 Dec 00:15 local is still 30 Nov in UTC.
      const now = new Date('2026-11-30T23:15:00.000Z');
      return [goalProgress(goal('week'), [gym], completions, now), goalProgress(goal('month'), [gym], completions, now)];
    });
    expect(b).toEqual(a);
  });

  it('formats labels in local time', () => {
    const [a, b] = inBothModes(() => [
      timeLabel('2026-07-01T16:00:00.000Z', '2026-07-01T17:30:00.000Z', false, 'event'),
      timeLabel(localDate(2026, 6, 1).toISOString(), localDate(2026, 6, 3).toISOString(), true, 'event'),
    ]);
    expect(b).toEqual(a);
    expect(a).toEqual(['18:00 – 19:30', '1 Jul – 2 Jul']);
  });
});
