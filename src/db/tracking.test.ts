import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { EPOCH, markRemote, onLocalChange, PlannerDB } from './db';
import type { Item } from './schema';

const settle = () => new Promise((r) => setTimeout(r, 20));
let n = 0;
const fresh = () => new PlannerDB(`test-${Date.now()}-${n++}`);
const item = (id: string): Item => ({ id, kind: 'task', title: id, allDay: false, exdates: [], reminders: [], createdAt: '', updatedAt: '' });

describe('change tracking', () => {
  it('seeds default categories with fixed ids and EPOCH stamps', async () => {
    const db = fresh();
    const cats = await db.categories.toArray();
    expect(cats.map((c) => c.id).sort()).toEqual(['default-health', 'default-personal', 'default-study', 'default-work']);
    expect(cats.every((c) => c.updatedAt === EPOCH)).toBe(true);
  });

  it('stamps creates and updates, and records deletions', async () => {
    const db = fresh();
    let changes = 0;
    const off = onLocalChange(() => changes++);
    await db.items.add(item('a'));
    const a1 = (await db.items.get('a'))!.updatedAt;
    expect(a1 > EPOCH).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await db.items.update('a', { title: 'changed' });
    expect((await db.items.get('a'))!.updatedAt > a1).toBe(true);
    await db.items.where('id').equals('a').delete();
    await settle();
    expect((await db.tombstones.toArray()).map((t) => t.key)).toEqual(['items:a']);
    expect(changes).toBe(3);
    off();
  });

  it('re-creating a deleted id removes its tombstone', async () => {
    const db = fresh();
    await db.items.add(item('a'));
    await db.items.delete('a');
    await settle();
    await db.items.add(item('a'));
    await settle();
    expect(await db.tombstones.count()).toBe(0);
  });

  it('leaves sync-applied writes untouched', async () => {
    const db = fresh();
    let changes = 0;
    const off = onLocalChange(() => changes++);
    await db.transaction('rw', db.items, async (tx) => {
      markRemote(tx);
      await db.items.put({ ...item('r'), updatedAt: '2026-01-01T00:00:00.000Z' });
      await db.items.delete('r');
    });
    await settle();
    expect(await db.tombstones.count()).toBe(0);
    expect(changes).toBe(0);
    off();
  });

  it('migrates a v2 database: stamps rows and gives default categories fixed ids', async () => {
    const name = `legacy-${Date.now()}`;
    const old = new Dexie(name);
    old.version(2).stores({
      categories: 'id, name',
      items: 'id, kind, start, goalId, categoryId, externalId, source',
      overrides: 'id, itemId, [itemId+originalStart]',
      completions: 'id, itemId, [itemId+occurrenceStart]',
      goals: 'id',
    });
    await old.table('categories').bulkAdd([
      { id: 'rnd-1', name: 'Health', color: '#16a34a' },
      { id: 'rnd-2', name: 'Hobby', color: '#000000' },
    ]);
    await old.table('items').add({ ...item('x'), categoryId: 'rnd-1', updatedAt: '2026-11-01T00:00:00.000Z' });
    await old.table('goals').add({ id: 'g', title: 'Gym', mode: 'habit', categoryId: 'rnd-1', createdAt: '' });
    old.close();

    const db = new PlannerDB(name);
    const cats = await db.categories.toArray();
    expect(cats.map((c) => c.id).sort()).toEqual(['default-health', 'rnd-2']);
    expect(cats.every((c) => c.updatedAt === EPOCH)).toBe(true);
    expect((await db.items.get('x'))!).toMatchObject({ categoryId: 'default-health', updatedAt: '2026-11-01T00:00:00.000Z' });
    expect((await db.goals.get('g'))!).toMatchObject({ categoryId: 'default-health', updatedAt: EPOCH });
    await settle();
    expect(await db.tombstones.count()).toBe(0);
  });
});
