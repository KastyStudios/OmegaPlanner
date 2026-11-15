import { describe, expect, it } from 'vitest';
import { emptySnapshot, mergeSnapshots, type Row, type Snapshot } from './merge';

const T = (min: number) => new Date(Date.UTC(2026, 10, 14, 12, min)).toISOString();
const NOW = new Date(Date.UTC(2026, 10, 14, 13));

function snap(items: Row[] = [], tombstones: Snapshot['tombstones'] = []): Snapshot {
  const s = emptySnapshot();
  s.tables.items = items;
  s.tombstones = tombstones;
  return s;
}
const item = (id: string, title: string, min: number): Row => ({ id, title, updatedAt: T(min) });
const tomb = (id: string, min: number) => ({ key: `items:${id}`, table: 'items' as const, id, deletedAt: T(min) });

describe('mergeSnapshots', () => {
  it('first sync uploads everything and changes nothing locally', () => {
    const local = snap([item('a', 'Gym', 1)]);
    const r = mergeSnapshots(local, null, NOW);
    expect(r.remoteChanged).toBe(true);
    expect(r.localChanged).toBe(false);
    expect(r.merged.tables.items).toEqual(local.tables.items);
  });

  it('takes rows added on the other device', () => {
    const r = mergeSnapshots(snap([item('a', 'Gym', 1)]), snap([item('b', 'Study', 2)]), NOW);
    expect(r.merged.tables.items.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(r.local.put.items.map((x) => x.id)).toEqual(['b']);
    expect(r.remoteChanged).toBe(true);
  });

  it('newest edit of the same row wins, in either direction', () => {
    const phone = snap([item('a', 'Gym (phone)', 5)]);
    const pc = snap([item('a', 'Gym (pc)', 3)]);
    expect(mergeSnapshots(pc, phone, NOW).merged.tables.items[0].title).toBe('Gym (phone)');
    expect(mergeSnapshots(phone, pc, NOW).merged.tables.items[0].title).toBe('Gym (phone)');
    expect(mergeSnapshots(pc, phone, NOW).local.put.items).toHaveLength(1);
    expect(mergeSnapshots(phone, pc, NOW).localChanged).toBe(false);
  });

  it('deletions propagate unless the row was edited later', () => {
    // deleted on the phone at :10, still present on the PC (last edited :5)
    let r = mergeSnapshots(snap([item('a', 'Gym', 5)]), snap([], [tomb('a', 10)]), NOW);
    expect(r.merged.tables.items).toEqual([]);
    expect(r.local.delete.items).toEqual(['a']);
    expect(r.local.tombstones.map((t) => t.id)).toEqual(['a']);
    // edited on the PC at :20, after the deletion at :10 -> the edit wins and the tombstone goes
    r = mergeSnapshots(snap([item('a', 'Gym', 20)]), snap([], [tomb('a', 10)]), NOW);
    expect(r.merged.tables.items.map((x) => x.title)).toEqual(['Gym']);
    expect(r.merged.tombstones).toEqual([]);
    expect(r.remoteChanged).toBe(true);
  });

  it('is convergent: syncing A then B gives both the same data', () => {
    const a = snap([item('1', 'A1', 1), item('2', 'A2', 9)], [tomb('3', 4)]);
    const b = snap([item('2', 'B2', 5), item('3', 'B3', 2), item('4', 'B4', 3)]);
    const afterA = mergeSnapshots(a, null, NOW).merged; // A uploads
    const afterB = mergeSnapshots(b, afterA, NOW).merged; // B merges with remote and uploads
    const aAgain = mergeSnapshots(a, afterB, NOW).merged; // A pulls
    const sort = (s: Snapshot) => s.tables.items.map((x) => `${x.id}:${x.title}`).sort();
    expect(sort(afterB)).toEqual(['1:A1', '2:A2', '4:B4']);
    expect(sort(aAgain)).toEqual(sort(afterB));
    expect(mergeSnapshots(b, afterB, NOW).remoteChanged).toBe(false);
  });

  it('breaks timestamp ties deterministically', () => {
    const x = snap([{ id: 'a', title: 'x', updatedAt: T(1) }]);
    const y = snap([{ id: 'a', title: 'y', updatedAt: T(1) }]);
    expect(mergeSnapshots(x, y, NOW).merged.tables.items[0]).toEqual(mergeSnapshots(y, x, NOW).merged.tables.items[0]);
  });

  it('drops expired tombstones', () => {
    const old = { ...tomb('z', 0), deletedAt: '2026-01-01T00:00:00.000Z' };
    expect(mergeSnapshots(snap([], [old]), null, NOW).merged.tombstones).toEqual([]);
  });

  it('reports no change when both sides are equal', () => {
    const s = snap([item('a', 'Gym', 1)], [tomb('b', 2)]);
    const r = mergeSnapshots(s, structuredClone(s), NOW);
    expect(r.localChanged).toBe(false);
    expect(r.remoteChanged).toBe(false);
  });
});
