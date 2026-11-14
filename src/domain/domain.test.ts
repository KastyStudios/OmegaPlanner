import { describe, expect, it } from 'vitest';
import type { Completion, Goal, Item, Override } from '../db/schema';
import { goalProgress } from './goals';
import { buildRRule, describeRRule, expandOccurrences, parseRRule, seriesEnded, withUntilBefore, type Occurrence } from './recurrence';
import { dueReminders } from './reminders';
import { deleteOccurrence, editOccurrence, type ChangeSet } from './seriesEdit';

// Timezone is Europe/Amsterdam (see vitest.config.ts). DST ends 2026-10-25.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

function makeItem(p: Partial<Item>): Item {
  return {
    id: 'gym',
    kind: 'event',
    title: 'Gym',
    allDay: false,
    exdates: [],
    reminders: [],
    createdAt: '',
    updatedAt: '',
    ...p,
  };
}

const gym = makeItem({
  start: local(2026, 10, 19, 18), // Monday
  end: local(2026, 10, 19, 19),
  rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
});

const range = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

/** Apply a ChangeSet to in-memory tables. */
function apply(
  cs: ChangeSet,
  t: { items: Item[]; overrides: Override[]; completions: Completion[] },
) {
  const upsert = <T extends { id: string }>(arr: T[], put: T[], del: string[]) => {
    const m = new Map(arr.map((x) => [x.id, x]));
    del.forEach((id) => m.delete(id));
    put.forEach((x) => m.set(x.id, x));
    return [...m.values()];
  };
  return {
    items: upsert(t.items, cs.putItems, cs.deleteItems),
    overrides: upsert(t.overrides, cs.putOverrides, cs.deleteOverrides),
    completions: upsert(t.completions, cs.putCompletions, cs.deleteCompletions),
  };
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('expandOccurrences', () => {
  it('expands weekly Mon/Wed/Fri and keeps 18:00 across the DST change', () => {
    const occ = expandOccurrences([gym], [], [], range(local(2026, 10, 19), local(2026, 11, 2)));
    expect(occ.map((o) => hhmm(o.start))).toEqual([
      '19 18:00', '21 18:00', '23 18:00', // CEST
      '26 18:00', '28 18:00', '30 18:00', // CET (after 25 Oct)
    ]);
    expect(occ[0].end).toBe(local(2026, 10, 19, 19));
  });

  it('applies exdates, overrides, cancellations and completions', () => {
    const wed = local(2026, 10, 21, 18);
    const fri = local(2026, 10, 23, 18);
    const item = { ...gym, exdates: [local(2026, 10, 19, 18)] };
    const overrides: Override[] = [
      { id: 'o1', itemId: 'gym', originalStart: wed, start: local(2026, 10, 22, 7), end: local(2026, 10, 22, 8) },
      { id: 'o2', itemId: 'gym', originalStart: fri, cancelled: true },
    ];
    const completions: Completion[] = [{ id: 'c1', itemId: 'gym', occurrenceStart: wed, completedAt: '' }];
    const occ = expandOccurrences([item], overrides, completions, range(local(2026, 10, 19), local(2026, 10, 26)));
    expect(occ).toHaveLength(1);
    expect(hhmm(occ[0].start)).toBe('22 07:00');
    expect(occ[0].done).toBe(true);
    expect(occ[0].overridden).toBe(true);
  });

  it('includes an occurrence moved into the range from outside', () => {
    const fri = local(2026, 10, 23, 18);
    const overrides: Override[] = [
      { id: 'o', itemId: 'gym', originalStart: fri, start: local(2026, 10, 27, 9), end: local(2026, 10, 27, 10) },
    ];
    const occ = expandOccurrences([gym], overrides, [], range(local(2026, 10, 27), local(2026, 10, 28)));
    expect(occ.map((o) => hhmm(o.start))).toEqual(['27 09:00']);
  });

  it('handles one-off items, deadlines and unscheduled to-dos', () => {
    const items = [
      makeItem({ id: 'a', rrule: undefined, start: local(2026, 11, 3, 10), end: local(2026, 11, 3, 11) }),
      makeItem({ id: 'b', kind: 'deadline', allDay: true, start: local(2026, 11, 4) }),
      makeItem({ id: 'c', kind: 'task' }),
    ];
    const occ = expandOccurrences(items, [], [], range(local(2026, 11, 1), local(2026, 11, 8)));
    expect(occ.map((o) => o.item.id)).toEqual(['a', 'b']);
  });
});

describe('seriesEnded', () => {
  it('is true only once no occurrences remain', () => {
    const ended = { ...gym, rrule: withUntilBefore(gym.rrule!, local(2026, 10, 26, 18)) };
    expect(seriesEnded(ended, new Date(local(2026, 10, 23, 12)))).toBe(false); // Fri 18:00 still ahead
    expect(seriesEnded(ended, new Date(local(2026, 10, 24, 12)))).toBe(true);
    expect(seriesEnded(gym, new Date(local(2030, 1, 1)))).toBe(false);
  });
});

describe('rule builder', () => {
  it('round-trips weekly rules', () => {
    const r = buildRRule({ freq: 'weekly', interval: 1, weekdays: [4, 0, 2], endMode: 'count', count: 10 });
    expect(r).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=10');
    expect(parseRRule(r)).toMatchObject({ freq: 'weekly', weekdays: [0, 2, 4], endMode: 'count', count: 10 });
    expect(describeRRule(r)).toMatch(/^Every week on Monday, Wednesday, Friday/);
  });
  it('round-trips an until date', () => {
    const r = buildRRule({ freq: 'daily', interval: 2, weekdays: [], endMode: 'until', until: '2026-12-31' });
    expect(parseRRule(r)).toMatchObject({ freq: 'daily', interval: 2, endMode: 'until', until: '2026-12-31' });
  });
});

describe('series editing', () => {
  const R = range(local(2026, 10, 19), local(2026, 11, 2));
  const base = () => ({ items: [gym], overrides: [] as Override[], completions: [] as Completion[] });
  const occAt = (t: ReturnType<typeof base>, iso: string): Occurrence =>
    expandOccurrences(t.items, t.overrides, t.completions, R).find((o) => o.originalStart === iso)!;
  const ctx = (t: ReturnType<typeof base>, id = 'gym') => ({
    item: t.items.find((i) => i.id === id)!,
    overrides: t.overrides.filter((o) => o.itemId === id),
    completions: t.completions.filter((c) => c.itemId === id),
  });

  it('"this" moves a single occurrence only', () => {
    let t = base();
    const wed = local(2026, 10, 21, 18);
    t = apply(
      editOccurrence(ctx(t), occAt(t, wed), { start: local(2026, 10, 22, 18), end: local(2026, 10, 22, 19) }, 'this'),
      t,
    );
    const occ = expandOccurrences(t.items, t.overrides, t.completions, R);
    expect(occ.map((o) => hhmm(o.start))).toEqual(['19 18:00', '22 18:00', '23 18:00', '26 18:00', '28 18:00', '30 18:00']);
  });

  it('"following" splits the series and keeps earlier weeks', () => {
    let t = base();
    const mon = local(2026, 10, 26, 18);
    t.completions.push(
      { id: 'c1', itemId: 'gym', occurrenceStart: local(2026, 10, 19, 18), completedAt: '' },
      { id: 'c2', itemId: 'gym', occurrenceStart: local(2026, 10, 28, 18), completedAt: '' },
    );
    t = apply(
      editOccurrence(ctx(t), occAt(t, mon), { start: local(2026, 10, 26, 7), end: local(2026, 10, 26, 8) }, 'following'),
      t,
    );
    expect(t.items).toHaveLength(2);
    const occ = expandOccurrences(t.items, t.overrides, t.completions, R);
    expect(occ.map((o) => hhmm(o.start))).toEqual(['19 18:00', '21 18:00', '23 18:00', '26 07:00', '28 07:00', '30 07:00']);
    expect(occ.filter((o) => o.done).map((o) => hhmm(o.start))).toEqual(['19 18:00', '28 07:00']);
  });

  it('"following" on the first occurrence behaves like "all"', () => {
    let t = base();
    t = apply(editOccurrence(ctx(t), occAt(t, gym.start!), { title: 'Workout' }, 'following'), t);
    expect(t.items).toHaveLength(1);
    expect(expandOccurrences(t.items, [], [], R).every((o) => o.title === 'Workout')).toBe(true);
  });

  it('"all" shifts the series time and per-occurrence data', () => {
    let t = base();
    const wed = local(2026, 10, 21, 18);
    t.completions.push({ id: 'c', itemId: 'gym', occurrenceStart: wed, completedAt: '' });
    t = apply(
      editOccurrence(ctx(t), occAt(t, wed), { start: local(2026, 10, 21, 17), end: local(2026, 10, 21, 18, 30) }, 'all'),
      t,
    );
    const occ = expandOccurrences(t.items, t.overrides, t.completions, R);
    expect(occ.every((o) => hhmm(o.start).endsWith('17:00'))).toBe(true);
    expect(hhmm(occ[0].end)).toBe('19 18:30');
    expect(occ.find((o) => o.done)?.start).toBe(local(2026, 10, 21, 17));
  });

  it('deletes this / following / all', () => {
    const wed = local(2026, 10, 21, 18);
    let t = base();
    t = apply(deleteOccurrence(ctx(t), occAt(t, wed), 'this'), t);
    expect(expandOccurrences(t.items, t.overrides, t.completions, R)).toHaveLength(5);

    t = base();
    t = apply(deleteOccurrence(ctx(t), occAt(t, local(2026, 10, 26, 18)), 'following'), t);
    expect(expandOccurrences(t.items, t.overrides, t.completions, R)).toHaveLength(3);

    t = base();
    t = apply(deleteOccurrence(ctx(t), occAt(t, wed), 'all'), t);
    expect(t.items).toHaveLength(0);
  });

  it('splits COUNT rules so the total number of occurrences is preserved', () => {
    let t = { ...base(), items: [{ ...gym, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6' }] as Item[] };
    const R2 = range(local(2026, 10, 1), local(2027, 1, 1));
    const occ0 = expandOccurrences(t.items, [], [], R2);
    expect(occ0).toHaveLength(6);
    t = apply(editOccurrence(ctx(t), occ0[3], { title: 'Late gym' }, 'following'), t);
    const occ = expandOccurrences(t.items, t.overrides, t.completions, R2);
    expect(occ.map((o) => o.title)).toEqual(['Gym', 'Gym', 'Gym', 'Late gym', 'Late gym', 'Late gym']);
  });
});

describe('goals', () => {
  const now = new Date(local(2026, 11, 4, 12)); // Wednesday
  it('counts habit completions this week and the streak', () => {
    const goal: Goal = { id: 'g', title: 'Gym 3x', mode: 'habit', habitTarget: { count: 3, period: 'week' }, createdAt: '' };
    const item = { ...gym, goalId: 'g' };
    const c = (iso: string): Completion => ({ id: iso, itemId: 'gym', occurrenceStart: iso, completedAt: '' });
    const completions = [
      // last week (Oct 26 - Nov 1): 3 -> met
      c(local(2026, 10, 26, 18)), c(local(2026, 10, 28, 18)), c(local(2026, 10, 30, 18)),
      // this week: 2
      c(local(2026, 11, 2, 18)), c(local(2026, 11, 4, 18)),
    ];
    const p = goalProgress(goal, [item], completions, now);
    expect(p).toMatchObject({ done: 2, total: 3, streak: 1 });
  });

  it('computes milestone progress from linked one-off tasks', () => {
    const goal: Goal = { id: 'g', title: 'Learn Spanish', mode: 'milestone', createdAt: '' };
    const items = [
      makeItem({ id: '1', kind: 'task', goalId: 'g', done: true }),
      makeItem({ id: '2', kind: 'task', goalId: 'g' }),
      makeItem({ id: '3', kind: 'task', goalId: 'other', done: true }),
    ];
    expect(goalProgress(goal, items, [], now)).toMatchObject({ done: 1, total: 2, ratio: 0.5 });
  });
});

describe('reminders', () => {
  it('fires once inside the grace window', () => {
    const item = makeItem({ rrule: undefined, start: local(2026, 11, 4, 10), end: local(2026, 11, 4, 11), reminders: [15] });
    const occ = expandOccurrences([item], [], [], range(local(2026, 11, 4), local(2026, 11, 5)));
    expect(dueReminders(occ, new Date(local(2026, 11, 4, 9, 40)), new Set())).toHaveLength(0);
    const due = dueReminders(occ, new Date(local(2026, 11, 4, 9, 46)), new Set());
    expect(due).toHaveLength(1);
    expect(dueReminders(occ, new Date(local(2026, 11, 4, 9, 46)), new Set([due[0].key]))).toHaveLength(0);
    expect(dueReminders(occ, new Date(local(2026, 11, 4, 10, 30)), new Set())).toHaveLength(0);
  });
});
