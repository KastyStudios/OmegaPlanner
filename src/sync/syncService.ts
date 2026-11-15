import { useSyncExternalStore } from 'react';
import { db, markRemote, onLocalChange, SYNCED_TABLES, type SyncedTable } from '../db/db';
import * as dropbox from './dropbox';
import { DropboxError } from './dropbox';
import { mergeSnapshots, validateSnapshot, type LocalChanges, type Row, type Snapshot, type Tables } from './merge';

/** File in the Dropbox app folder (Apps/<your app name>/). */
export const SYNC_PATH = '/omegaplanner-sync.json';

export type SyncState = 'disconnected' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSync?: string;
  error?: string;
}

/* ---------------- status store ---------------- */

const LAST_KEY = 'omegaplanner.lastSync';
const readLast = () => {
  try {
    return localStorage.getItem(LAST_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
let status: SyncStatus = { state: dropbox.isConnected() ? 'idle' : 'disconnected', lastSync: readLast() };
const subs = new Set<() => void>();
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  subs.forEach((fn) => fn());
}
export const getSyncStatus = () => status;
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    getSyncStatus,
  );
}

/* ---------------- local snapshot ---------------- */

async function readLocal(): Promise<Snapshot> {
  const tables = {} as Tables;
  for (const t of SYNCED_TABLES) tables[t] = (await db.table(t).toArray()) as Row[];
  return { app: 'OmegaPlanner', format: 1, tables, tombstones: await db.tombstones.toArray() };
}

/** Apply merged changes locally, without overwriting anything edited while the sync ran. */
async function applyLocal(ch: LocalChanges): Promise<void> {
  const tables = [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones];
  await db.transaction('rw', tables, async (tx) => {
    markRemote(tx);
    const tombAt = new Map(ch.tombstones.map((t) => [t.key, t.deletedAt]));
    for (const t of SYNCED_TABLES as readonly SyncedTable[]) {
      const table = db.table(t);
      const ids = [...ch.put[t].map((r) => r.id), ...ch.delete[t]];
      if (!ids.length) continue;
      const current = new Map(((await table.bulkGet(ids)) as (Row | undefined)[]).filter(Boolean).map((r) => [r!.id, r!]));
      const stamp = (id: string) => current.get(id)?.updatedAt ?? '';
      const puts = ch.put[t].filter((r) => !(stamp(r.id) > (r.updatedAt ?? '')));
      const dels = ch.delete[t].filter((id) => !(stamp(id) > (tombAt.get(`${t}:${id}`) ?? '')));
      if (puts.length) await table.bulkPut(puts);
      if (dels.length) await table.bulkDelete(dels);
    }
    if (ch.tombstones.length) await db.tombstones.bulkPut(ch.tombstones);
    if (ch.dropTombstones.length) await db.tombstones.bulkDelete(ch.dropTombstones);
  });
}

/* ---------------- sync ---------------- */

let running: Promise<void> | null = null;
let again = false;

async function syncOnce(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remoteFile = await dropbox.downloadFile(SYNC_PATH);
    const remote = remoteFile ? validateSnapshot(JSON.parse(remoteFile.text)) : null;
    const result = mergeSnapshots(await readLocal(), remote);
    if (result.localChanged) await applyLocal(result.local);
    if (!result.remoteChanged) return;
    try {
      await dropbox.uploadFile(SYNC_PATH, JSON.stringify(result.merged), remoteFile?.rev ?? null);
      return;
    } catch (e) {
      // Another device uploaded in between: download again and re-merge.
      if (e instanceof DropboxError && e.kind === 'conflict') continue;
      throw e;
    }
  }
  throw new DropboxError('The sync file keeps changing; try again in a moment.', 'other');
}

/** Run a sync now (coalesces with one already running). */
export function syncNow(): Promise<void> {
  if (!dropbox.isConnected()) {
    setStatus({ state: 'disconnected' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  setStatus({ state: 'syncing', error: undefined });
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_KEY, now);
      } catch {
        /* ignore */
      }
      setStatus({ state: 'idle', lastSync: now, error: undefined });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err instanceof DropboxError && err.kind === 'network') setStatus({ state: 'offline', error: err.message });
      else if (err instanceof DropboxError && err.kind === 'auth' && !dropbox.isConnected())
        setStatus({ state: 'disconnected', error: err.message });
      else setStatus({ state: 'error', error: err.message });
    } finally {
      running = null;
    }
  })();
  return running;
}

/* ---------------- lifecycle ---------------- */

let debounce: number | undefined;
const scheduleSoon = (ms = 2000) => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void syncNow(), ms);
};

/** Finish a pending Dropbox sign-in, sync, and keep syncing on changes, focus and a timer. */
export function startSyncService(): () => void {
  void (async () => {
    try {
      if (await dropbox.completeConnectFromUrl()) setStatus({ state: 'idle', error: undefined });
    } catch (e) {
      setStatus({ state: 'disconnected', error: (e as Error).message });
      return;
    }
    void syncNow();
  })();

  const offChange = onLocalChange(() => dropbox.isConnected() && scheduleSoon());
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const last = status.lastSync ? Date.parse(status.lastSync) : 0;
    if (Date.now() - last > 10_000) void syncNow();
  };
  const onOnline = () => void syncNow();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000);
  return () => {
    offChange();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
    window.clearTimeout(debounce);
  };
}

export async function connectDropbox(): Promise<void> {
  await dropbox.startConnect();
}

export async function disconnectDropbox(): Promise<void> {
  await dropbox.disconnect();
  setStatus({ state: 'disconnected', error: undefined });
}
