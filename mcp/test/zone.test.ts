import { describe, expect, it } from 'vitest';
import { inBothModes } from '../../src/lib/zoneTesting';
import { emptySnapshot } from '../../src/sync/merge';
import * as p from '../src/planner';

describe('MCP planner: same answers in the browser zone and on a UTC server', () => {
  it('creates, lists and finds free time identically', () => {
    const [a, b] = inBothModes(() => {
      const s = emptySnapshot();
      const run = (fn: (d: p.Data, tx: p.Tx) => unknown) => fn(p.dataOf(structuredClone(s)), new p.Tx(s));
      run((d, tx) => p.createItem(d, tx, { title: 'Late call', start: '2026-03-28T23:30', duration_minutes: 60 }));
      run((d, tx) => p.createItem(d, tx, { title: 'Trip', start: '2026-03-28', end: '2026-03-30' }));
      run((d, tx) => p.createItem(d, tx, { title: 'Gym', start: '2026-03-23T18:00', repeat: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }));
      run((d, tx) => p.createItem(d, tx, { title: 'Due', kind: 'deadline', start: '2026-03-31' }));
      const data = p.dataOf(s);
      const now = new Date('2026-03-27T09:00:00.000Z');
      return {
        items: data.items.map((i) => [i.title, i.start, i.end, i.allDay]),
        agenda: p.agenda(data, p.parseLocal('2026-03-27').date, 4, now).replace(/id=[0-9a-f-]+/g, 'id=…'),
        free: p.freeTime(data, p.parseLocal('2026-03-30').date, 30),
      };
    });
    expect(b).toEqual(a);
    expect(a.items[0]).toEqual(['Late call', '2026-03-28T22:30:00.000Z', '2026-03-28T23:30:00.000Z', false]);
    expect(a.agenda).toContain('## Sunday 29 March 2026');
    expect(a.free).toContain('08:00–18:00, 19:00–20:00');
  });
});
