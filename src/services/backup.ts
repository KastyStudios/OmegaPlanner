import { db } from '../db/db';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'OmegaPlanner';
  version: number;
  exportedAt: string;
  data: {
    categories: unknown[];
    items: unknown[];
    overrides: unknown[];
    completions: unknown[];
    goals: unknown[];
  };
}

const TABLES = ['categories', 'items', 'overrides', 'completions', 'goals'] as const;

export async function exportBackup(): Promise<BackupFile> {
  const [categories, items, overrides, completions, goals] = await Promise.all(
    TABLES.map((t) => db.table(t).toArray()),
  );
  return {
    app: 'OmegaPlanner',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { categories, items, overrides, completions, goals },
  };
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `omegaplanner-backup-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Validate a parsed backup. Throws with a readable message when invalid. */
export function validateBackup(raw: unknown): BackupFile {
  const b = raw as Partial<BackupFile>;
  if (!b || typeof b !== 'object' || b.app !== 'OmegaPlanner') throw new Error('This is not an OmegaPlanner backup file.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION)
    throw new Error(`Unsupported backup version ${b.version}. Please update the app.`);
  for (const t of TABLES) {
    const rows = b.data?.[t];
    if (!Array.isArray(rows)) throw new Error(`Backup is missing the "${t}" table.`);
    if (rows.some((r) => !r || typeof (r as { id?: unknown }).id !== 'string'))
      throw new Error(`Backup table "${t}" contains invalid rows.`);
  }
  return b as BackupFile;
}

/** Replace all data with the backup contents. */
export async function importBackup(backup: BackupFile): Promise<void> {
  const tables = TABLES.map((t) => db.table(t));
  await db.transaction('rw', tables, async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      await db.table(t).bulkAdd(backup.data[t]);
    }
  });
}
