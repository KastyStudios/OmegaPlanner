/*
 * Sync constants shared by the app and the MCP server (no browser or Dexie dependencies).
 */

export const SYNCED_TABLES = ['categories', 'items', 'overrides', 'completions', 'goals'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** A deleted record, kept so the deletion can be synced to other devices. */
export interface Tombstone {
  /** `${table}:${id}` */
  key: string;
  table: SyncedTable;
  id: string;
  deletedAt: string;
}

/** Timestamp for rows that existed before change tracking; any real edit is newer. */
export const EPOCH = '1970-01-01T00:00:00.000Z';
