import Dexie, { type Table, type Transaction } from 'dexie';
import type { Category, Completion, Goal, Item, Override } from './schema';
import { EPOCH, SYNCED_TABLES, type SyncedTable, type Tombstone } from './syncTables';

export { EPOCH, SYNCED_TABLES, type SyncedTable, type Tombstone };

/**
 * Default categories have fixed ids so every device seeds the same rows and sync
 * doesn't duplicate them.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'default-health', name: 'Health', color: '#16a34a' },
  { id: 'default-work', name: 'Work', color: '#2563eb' },
  { id: 'default-study', name: 'Study', color: '#9333ea' },
  { id: 'default-personal', name: 'Personal', color: '#ea580c' },
];

export class PlannerDB extends Dexie {
  categories!: Table<Category, string>;
  items!: Table<Item, string>;
  overrides!: Table<Override, string>;
  completions!: Table<Completion, string>;
  goals!: Table<Goal, string>;
  tombstones!: Table<Tombstone, string>;

  constructor(name = 'omegaplanner') {
    super(name);
    this.version(1).stores({
      categories: 'id, name',
      items: 'id, kind, start, goalId, categoryId',
      overrides: 'id, itemId, [itemId+originalStart]',
      completions: 'id, itemId, [itemId+occurrenceStart]',
      goals: 'id',
    });
    this.version(2).stores({
      items: 'id, kind, start, goalId, categoryId, externalId, source',
    });
    // v3: change tracking for sync.
    this.version(3)
      .stores({ tombstones: 'key, deletedAt' })
      .upgrade(async (tx) => {
        markRemote(tx); // migration rows keep EPOCH, they aren't local edits
        for (const t of SYNCED_TABLES) {
          await tx.table(t).toCollection().modify((row: { updatedAt?: string }) => {
            if (t !== 'items' || !row.updatedAt) row.updatedAt = EPOCH;
          });
        }
        // Give existing default categories their fixed ids (and repoint references).
        const cats = (await tx.table('categories').toArray()) as Category[];
        for (const def of DEFAULT_CATEGORIES) {
          const old = cats.find((c) => c.name === def.name && c.id !== def.id);
          if (!old || cats.some((c) => c.id === def.id)) continue;
          await tx.table('categories').delete(old.id);
          await tx.table('categories').add({ ...old, id: def.id });
          await tx.table('items').where('categoryId').equals(old.id).modify({ categoryId: def.id });
          await tx.table('goals').filter((g: Goal) => g.categoryId === old.id).modify({ categoryId: def.id });
        }
      });

    this.on('populate', (tx) => {
      markRemote(tx);
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ ...c, updatedAt: EPOCH })));
    });

    for (const t of SYNCED_TABLES) installTracking(this, t);
  }
}

/* ------------------------------------------------------------------ */
/* Change tracking                                                      */
/* ------------------------------------------------------------------ */

const REMOTE = Symbol('remote');

/** Writes in this transaction come from sync/migrations: don't stamp them or record tombstones. */
export function markRemote(tx: Transaction): void {
  (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
}
const isRemote = (tx: Transaction | undefined) => !!tx && !!(tx as unknown as Record<symbol, boolean>)[REMOTE];

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();
/** Called after any local (non-sync) change, e.g. to schedule a sync. */
export function onLocalChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function installTracking(db: PlannerDB, table: SyncedTable) {
  const t = db.table(table);
  const notifyOnComplete = (tx: Transaction) => {
    const flags = tx as unknown as Record<string, boolean>;
    if (flags.__opNotify) return;
    flags.__opNotify = true;
    tx.on('complete', () => listeners.forEach((fn) => fn()));
  };

  t.hook('creating', function (key, obj, tx) {
    if (isRemote(tx)) return;
    (obj as { updatedAt?: string }).updatedAt = new Date().toISOString();
    // Re-creating a deleted id (e.g. restoring a backup) revives it everywhere.
    const id = String(key ?? (obj as { id?: string }).id);
    tx.on('complete', () => void db.tombstones.delete(`${table}:${id}`));
    notifyOnComplete(tx);
  });

  t.hook('updating', function (_mods, _key, _obj, tx) {
    if (isRemote(tx)) return;
    notifyOnComplete(tx);
    return { updatedAt: new Date().toISOString() };
  });

  t.hook('deleting', function (key, _obj, tx) {
    if (isRemote(tx)) return;
    const id = String(key);
    const deletedAt = new Date().toISOString();
    // Tombstones live in their own table, which may not be part of this transaction:
    // record them right after it commits.
    tx.on('complete', () => {
      void db.tombstones.put({ key: `${table}:${id}`, table, id, deletedAt });
    });
    notifyOnComplete(tx);
  });
}

export const db = new PlannerDB();
