import { describe, expect, it } from 'vitest';
import { emptySnapshot, mergeSnapshots, type Snapshot } from '../../src/sync/merge';
import * as p from '../src/planner';

function fresh(): Snapshot {
  const s = emptySnapshot();
  s.tables.categories.push({ id: 'default-work', name: 'Work', color: '#2563eb', updatedAt: '1970-01-01T00:00:00.000Z' });
  return s;
}
/** Runs a change the way the store does: against a copy, writing into the snapshot. */
function change<T>(s: Snapshot, fn: (d: p.Data, tx: p.Tx) => T): T {
  return fn(p.dataOf(structuredClone(s)), new p.Tx(s));
}
const items = (s: Snapshot) => p.dataOf(s).items;

describe('MCP planner', () => {
  it('reads date-only input as local midnight', () => {
    expect(p.parseLocal('2026-11-23').date.getHours()).toBe(0);
    expect(p.parseLocal('2026-11-23T14:30').date.toISOString()).toBe('2026-11-23T13:30:00.000Z');
  });

  it('creates a meeting that shows up in the agenda, stamped for sync', () => {
    const s = fresh();
    const msg = change(s, (d, tx) => p.createItem(d, tx, { title: 'Meeting with Ola', start: '2026-11-23T14:00', duration_minutes: 30, category: 'work' }));
    expect(msg).toContain('Meeting with Ola');
    const [item] = items(s);
    expect(item).toMatchObject({ kind: 'event', allDay: false, categoryId: 'default-work', start: '2026-11-23T13:00:00.000Z', end: '2026-11-23T13:30:00.000Z' });
    expect(item.updatedAt).toBeTruthy();
    const agenda = p.agenda(p.dataOf(s), p.parseLocal('2026-11-23').date, 1, new Date(2026, 10, 22));
    expect(agenda).toContain('14:00 – 14:30');
    expect(agenda).toContain('#Work');
  });

  it('rejects unknown categories with the list of valid ones', () => {
    expect(() => change(fresh(), (d, tx) => p.createItem(d, tx, { title: 'x', category: 'Hobby' }))).toThrow(/Categories: Work/);
  });

  it('makes all-day items and deadlines like the app editor', () => {
    const s = fresh();
    change(s, (d, tx) => p.createItem(d, tx, { title: 'Trip', start: '2026-11-24', end: '2026-11-26' }));
    change(s, (d, tx) => p.createItem(d, tx, { title: 'Report', kind: 'deadline', start: '2026-11-27T17:00' }));
    const [trip, report] = items(s);
    expect(trip).toMatchObject({ allDay: true, start: p.parseLocal('2026-11-24').date.toISOString(), end: p.parseLocal('2026-11-27').date.toISOString() });
    expect(report).toMatchObject({ kind: 'deadline', allDay: false, end: undefined });
  });

  it('checks off and moves single occurrences of a recurring item', () => {
    const s = fresh();
    change(s, (d, tx) => p.createItem(d, tx, { title: 'Gym', start: '2026-11-23T18:00', repeat: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }));
    const gym = items(s)[0];
    const occ = '2026-11-25T17:00:00.000Z'; // Wednesday 18:00
    change(s, (d, tx) => p.setDone(d, tx, gym.id, true, occ));
    expect(p.dataOf(s).completions).toHaveLength(1);
    change(s, (d, tx) => p.updateItem(d, tx, gym.id, { occurrence_start: occ, scope: 'this', start: '2026-11-26T19:00' }));
    const week = p.agenda(p.dataOf(s), p.parseLocal('2026-11-23').date, 7, new Date(2026, 10, 22));
    expect(week).toMatch(/Thursday 26 November 2026[^#]*\[x\] 19:00 – 20:00 +Gym/);
    expect(week).not.toMatch(/Wednesday 25 November 2026\n\[/);
  });

  it('lists upcoming recurring deadlines on today', () => {
    const s = fresh();
    change(s, (d, tx) => p.createItem(d, tx, { title: 'EM2 homework', kind: 'deadline', start: '2026-11-17', repeat: 'FREQ=WEEKLY;BYDAY=TU' }));
    const today = p.agenda(p.dataOf(s), new Date(2026, 10, 22, 11), 1, new Date(2026, 10, 22, 11));
    expect(today).toMatch(/Deadlines in the next 7 days\nTue 24 Nov .*EM2 homework/);
  });

  it('keeps the length when only the start of a one-off item moves', () => {
    const s = fresh();
    change(s, (d, tx) => p.createItem(d, tx, { title: 'Call', start: '2026-11-23T09:00', duration_minutes: 45 }));
    change(s, (d, tx) => p.updateItem(d, tx, items(s)[0].id, { start: '2026-11-23T11:00' }));
    expect(items(s)[0].end).toBe('2026-11-23T10:45:00.000Z');
  });

  it('finds free time between plans', () => {
    const s = fresh();
    change(s, (d, tx) => p.createItem(d, tx, { title: 'A', start: '2026-11-23T09:00', end: '2026-11-23T12:00' }));
    change(s, (d, tx) => p.createItem(d, tx, { title: 'B', start: '2026-11-23T13:00', end: '2026-11-23T19:30' }));
    expect(p.freeTime(p.dataOf(s), p.parseLocal('2026-11-23').date, 60)).toContain('08:00–09:00, 12:00–13:00');
  });

  it('deletions and new items merge into an app that still has the old data', () => {
    const app = fresh();
    change(app, (d, tx) => p.createItem(d, tx, { title: 'Old', start: '2026-11-23T09:00' }));
    const old = items(app)[0];
    const remote = structuredClone(app);
    // Later, the MCP server deletes "Old" and adds "New" in the sync file.
    const later = (fn: () => void) => {
      const real = Date.now;
      Date.now = () => real() + 5000;
      try {
        fn();
      } finally {
        Date.now = real;
      }
    };
    later(() => {
      const tx = new p.Tx(remote);
      (tx as { now: string }).now = new Date(Date.now()).toISOString();
      p.deleteItem(p.dataOf(structuredClone(remote)), tx, old.id);
      p.createItem(p.dataOf(structuredClone(remote)), tx, { title: 'New', kind: 'task' });
    });
    const r = mergeSnapshots(app, remote);
    expect(r.local.delete.items).toEqual([old.id]);
    expect(r.local.put.items.map((i) => i.title)).toEqual(['New']);
  });
});
