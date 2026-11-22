/*
 * The planner data lives in the app's Dropbox sync file. Reads download it; writes change it and
 * upload with the revision they read, retrying on a concurrent change, exactly like the app's sync.
 */
import { emptySnapshot, validateSnapshot, type Snapshot } from '../../src/sync/merge';
import { DropboxError, downloadFile, uploadFile } from './dropbox';
import { dataOf, Tx, type Data } from './planner';

/** Same file the app syncs (Apps/<Dropbox app name>/omegaplanner-sync.json). */
const SYNC_PATH = '/omegaplanner-sync.json';

async function load(): Promise<{ snap: Snapshot; rev: string | null }> {
  const file = await downloadFile(SYNC_PATH);
  if (!file) return { snap: emptySnapshot(), rev: null };
  return { snap: validateSnapshot(JSON.parse(file.text)), rev: file.rev };
}

export async function read(): Promise<Data> {
  return dataOf((await load()).snap);
}

export async function write<T>(change: (data: Data, tx: Tx) => T): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { snap, rev } = await load();
    const tx = new Tx(snap);
    // Run against a copy of the rows, so `data` shows the state before this change.
    const before = dataOf(structuredClone(snap));
    const result = change(before, tx);
    try {
      await uploadFile(SYNC_PATH, JSON.stringify(snap), rev);
      return result;
    } catch (e) {
      if (e instanceof DropboxError && e.kind === 'conflict') continue;
      throw e;
    }
  }
  throw new Error('The sync file keeps changing; try again in a moment.');
}
