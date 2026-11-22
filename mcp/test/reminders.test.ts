import { describe, expect, it } from 'vitest';
import { inBothModes } from '../../src/lib/zoneTesting';
import { emptySnapshot } from '../../src/sync/merge';
import * as p from '../src/planner';
import { remindersDue } from '../src/worker/reminders';

function planner() {
  const s = emptySnapshot();
  const run = (fn: (d: p.Data, tx: p.Tx) => unknown) => fn(p.dataOf(structuredClone(s)), new p.Tx(s));
  run((d, tx) => p.createItem(d, tx, { title: 'Gym', start: '2026-11-23T18:00', repeat: 'FREQ=WEEKLY;BYDAY=MO,WE', reminders_minutes: [15, 0] }));
  run((d, tx) => p.createItem(d, tx, { title: 'Report', kind: 'deadline', start: '2026-11-25', reminders_minutes: [1440] }));
  run((d, tx) => p.createItem(d, tx, { title: 'No reminder', start: '2026-11-23T17:45' }));
  return { s, run, data: () => p.dataOf(s) };
}

const at = (iso: string) => Date.parse(iso);

describe('push reminders', () => {
  it('fires each reminder in exactly one cron minute', () => {
    const { data } = planner();
    // Gym Monday 23 Nov 18:00 local = 17:00Z; 15 min before = 16:45Z.
    const minutes = Array.from({ length: 30 }, (_, i) => at('2026-11-23T16:40:00Z') + i * 60_000);
    const fired = minutes.flatMap((t) => remindersDue(data(), t).map((m) => `${new Date(t).toISOString().slice(11, 16)} ${m.title} ${m.body}`));
    expect(fired).toEqual(['16:45 Gym Starts 18:00 · 15 min before', '17:00 Gym Starts 18:00 · At start']);
  });

  it('skips occurrences that are checked off', () => {
    const { run, data } = planner();
    const gym = data().items.find((i) => i.title === 'Gym')!;
    run((d, tx) => p.setDone(d, tx, gym.id, true, '2026-11-23T17:00:00.000Z'));
    expect(remindersDue(data(), at('2026-11-23T16:45:00Z'))).toEqual([]);
    expect(remindersDue(data(), at('2026-11-25T16:45:00Z'))).toHaveLength(1); // Wednesday still reminds
  });

  it('reminds of all-day deadlines a day ahead, in local time on a UTC server', () => {
    const [a, b] = inBothModes(() => {
      const { data } = planner();
      // Due Wed 25 Nov (local midnight = 24 Nov 23:00Z); 1 day before = 23 Nov 23:00Z.
      return remindersDue(data(), at('2026-11-23T23:00:00Z')).map((m) => [m.title, m.body]);
    });
    expect(b).toEqual(a);
    expect(a).toEqual([['Report', 'Due Wed 25 Nov · 1 day before']]);
  });
});
