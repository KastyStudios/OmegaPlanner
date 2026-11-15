import { EPOCH, SYNCED_TABLES, type SyncedTable, type Tombstone } from '../db/db';

/*
 * Two-way merge of planner data. Every record carries `updatedAt`; deletions are kept as
 * tombstones. Per record the most recent change wins (a deletion counts as a change), so
 * syncing in any order converges to the same state on every device.
 */

export interface Row {
  id: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export type Tables = Record<SyncedTable, Row[]>;

export interface Snapshot {
  app: 'OmegaPlanner';
  format: 1;
  tables: Tables;
  tombstones: Tombstone[];
}

export interface LocalChanges {
  put: Tables;
  delete: Record<SyncedTable, string[]>;
  /** Tombstones to store locally (new or newer than what this device knows). */
  tombstones: Tombstone[];
  /** Local tombstone keys that are expired or superseded by a newer row. */
  dropTombstones: string[];
}

export interface MergeResult {
  merged: Snapshot;
  local: LocalChanges;
  localChanged: boolean;
  remoteChanged: boolean;
}

/** Tombstones older than this are dropped; devices offline longer may resurrect deleted rows. */
export const TOMBSTONE_TTL_DAYS = 90;

const emptyTables = <T>(f: () => T) => Object.fromEntries(SYNCED_TABLES.map((t) => [t, f()])) as Record<SyncedTable, T>;
export const emptySnapshot = (): Snapshot => ({ app: 'OmegaPlanner', format: 1, tables: emptyTables(() => []), tombstones: [] });

const stamp = (r: Row | undefined) => r?.updatedAt ?? EPOCH;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Newer row wins; identical timestamps are broken deterministically so all devices agree. */
function newer(a: Row, b: Row): Row {
  const sa = stamp(a);
  const sb = stamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function validateSnapshot(raw: unknown): Snapshot {
  const s = raw as Partial<Snapshot>;
  if (!s || s.app !== 'OmegaPlanner' || s.format !== 1 || typeof s.tables !== 'object' || !Array.isArray(s.tombstones)) {
    throw new Error('The sync file is not a valid OmegaPlanner sync file.');
  }
  const tables = emptyTables<Row[]>(() => []);
  for (const t of SYNCED_TABLES) {
    const rows = (s.tables as Partial<Tables>)[t] ?? [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) throw new Error(`Sync file table "${t}" is invalid.`);
    tables[t] = rows;
  }
  return { app: 'OmegaPlanner', format: 1, tables, tombstones: s.tombstones };
}

export function mergeSnapshots(local: Snapshot, remote: Snapshot | null, now = new Date()): MergeResult {
  const r = remote ?? emptySnapshot();
  const cutoff = new Date(now.getTime() - TOMBSTONE_TTL_DAYS * 864e5).toISOString();

  // Tombstones: newest per key, minus expired ones.
  const tombs = new Map<string, Tombstone>();
  for (const t of [...local.tombstones, ...r.tombstones]) {
    if (t.deletedAt < cutoff) continue;
    const cur = tombs.get(t.key);
    if (!cur || t.deletedAt > cur.deletedAt) tombs.set(t.key, t);
  }

  const merged = emptySnapshot();
  const changes: LocalChanges = { put: emptyTables(() => []), delete: emptyTables(() => []), tombstones: [], dropTombstones: [] };

  for (const table of SYNCED_TABLES) {
    const lm = new Map(local.tables[table].map((x) => [x.id, x]));
    const rm = new Map(r.tables[table].map((x) => [x.id, x]));
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id);
      const rr = rm.get(id);
      const winner = l && rr ? newer(l, rr) : (l ?? rr)!;
      const key = `${table}:${id}`;
      const tomb = tombs.get(key);
      if (tomb && tomb.deletedAt > stamp(winner)) {
        if (l) changes.delete[table].push(id);
        continue;
      }
      if (tomb) tombs.delete(key); // re-created after the deletion: the row wins
      merged.tables[table].push(winner);
      if (!l || !same(l, winner)) changes.put[table].push(winner);
    }
  }

  merged.tombstones = [...tombs.values()].sort((a, b) => a.key.localeCompare(b.key));
  const localTombs = new Map(local.tombstones.map((t) => [t.key, t]));
  changes.tombstones = merged.tombstones.filter((t) => localTombs.get(t.key)?.deletedAt !== t.deletedAt);
  const keep = new Set(merged.tombstones.map((t) => t.key));
  changes.dropTombstones = local.tombstones.filter((t) => !keep.has(t.key)).map((t) => t.key);

  const localChanged =
    SYNCED_TABLES.some((t) => changes.put[t].length || changes.delete[t].length) ||
    changes.tombstones.length > 0 ||
    changes.dropTombstones.length > 0;
  return { merged, local: changes, localChanged, remoteChanged: !remote || !sameSnapshot(merged, r) };
}

/** Order-independent comparison of two snapshots. */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  const norm = (s: Snapshot) =>
    JSON.stringify([
      SYNCED_TABLES.map((t) => [...s.tables[t]].sort((x, y) => x.id.localeCompare(y.id))),
      [...s.tombstones].sort((x, y) => x.key.localeCompare(y.key)),
    ]);
  return norm(a) === norm(b);
}
