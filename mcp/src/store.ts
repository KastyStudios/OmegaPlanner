/*
 * The planner data lives in the app's Dropbox sync file. Reads download it; writes change it and
 * upload with the revision they read, retrying on a concurrent change, exactly like the app's sync.
 */
import { emptySnapshot, validateSnapshot, type Snapshot } from '../../src/sync/merge';
import { DropboxError, type DropboxFiles } from './dropboxApi';
import { dataOf, Tx, type Data } from './planner';

/** Same file the app syncs (Apps/<Dropbox app name>/omegaplanner-sync.json). */
export const SYNC_PATH = '/omegaplanner-sync.json';

export interface Store {
  read(): Promise<Data>;
  write<T>(change: (data: Data, tx: Tx) => T): Promise<T>;
}

export function makeStore(files: DropboxFiles): Store {
  async function load(): Promise<{ snap: Snapshot; rev: string | null }> {
    const file = await files.download(SYNC_PATH);
    if (!file) return { snap: emptySnapshot(), rev: null };
    return { snap: validateSnapshot(JSON.parse(file.text)), rev: file.rev };
  }

  return {
    async read() {
      return dataOf((await load()).snap);
    },
    async write(change) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { snap, rev } = await load();
        const tx = new Tx(snap);
        // Run against a copy of the rows, so `data` shows the state before this change.
        const result = change(dataOf(structuredClone(snap)), tx);
        try {
          await files.upload(SYNC_PATH, JSON.stringify(snap), rev);
          return result;
        } catch (e) {
          if (e instanceof DropboxError && e.kind === 'conflict') continue;
          throw e;
        }
      }
      throw new Error('The sync file keeps changing; try again in a moment.');
    },
  };
}
