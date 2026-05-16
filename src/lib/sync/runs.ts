import { getDb } from '../db';
import type { SyncRunSummary } from './owned';

/**
 * Lightweight wrapper around `sync_runs` so multiple sync kinds (`owned`,
 * `wishlist`, `cart`) can use the same lifecycle helpers without each
 * duplicating the prepare/run plumbing. `owned.ts` keeps its private
 * helpers for backwards compatibility; everything new goes through here.
 */

export type SyncKind = 'owned' | 'wishlist' | 'cart' | string;

export function createSyncRun(opts: { kind: SyncKind }): number {
  const info = getDb()
    .prepare(`INSERT INTO sync_runs (kind, status) VALUES (?, 'running')`)
    .run(opts.kind);
  return Number(info.lastInsertRowid);
}

export function updateSyncRun(
  runId: number,
  patch: { items_synced?: number; items_total_known?: number | null },
): void {
  const fields: string[] = [];
  const args: (number | null)[] = [];
  if (patch.items_synced != null) {
    fields.push('items_synced = ?');
    args.push(patch.items_synced);
  }
  if (patch.items_total_known !== undefined) {
    fields.push('items_total_known = ?');
    args.push(patch.items_total_known);
  }
  if (fields.length === 0) return;
  args.push(runId);
  getDb()
    .prepare(`UPDATE sync_runs SET ${fields.join(', ')} WHERE id = ?`)
    .run(...args);
}

export function markSyncRun(
  runId: number,
  patch: {
    status: 'success' | 'error';
    error_message?: string | null;
    items_synced?: number;
  },
): void {
  getDb()
    .prepare(
      `UPDATE sync_runs SET
         status = ?, finished_at = datetime('now'),
         items_synced = COALESCE(?, items_synced),
         error_message = ?
       WHERE id = ?`,
    )
    .run(patch.status, patch.items_synced ?? null, patch.error_message ?? null, runId);
}

export function getLatestSyncRunOfKind(kind: SyncKind): SyncRunSummary | null {
  const row = getDb()
    .prepare<
      [string],
      {
        id: number;
        kind: string;
        started_at: string;
        finished_at: string | null;
        status: 'running' | 'success' | 'error';
        items_synced: number;
        items_total_known: number | null;
        error_message: string | null;
      }
    >(
      `SELECT id, kind, started_at, finished_at, status, items_synced,
              items_total_known, error_message
         FROM sync_runs WHERE kind = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(kind);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    itemsSynced: row.items_synced,
    itemsTotalKnown: row.items_total_known,
    errorMessage: row.error_message,
  };
}

/**
 * Return the last N runs of a given kind, newest first. Used by the
 * Wishlist UI to detect consecutive `size_mismatch` errors so it can show
 * a specific "Bandcamp wishlist appears to be changing" message.
 */
export function getRecentSyncRuns(kind: SyncKind, limit = 5): SyncRunSummary[] {
  const rows = getDb()
    .prepare<
      [string, number],
      {
        id: number;
        kind: string;
        started_at: string;
        finished_at: string | null;
        status: 'running' | 'success' | 'error';
        items_synced: number;
        items_total_known: number | null;
        error_message: string | null;
      }
    >(
      `SELECT id, kind, started_at, finished_at, status, items_synced,
              items_total_known, error_message
         FROM sync_runs WHERE kind = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(kind, limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    itemsSynced: row.items_synced,
    itemsTotalKnown: row.items_total_known,
    errorMessage: row.error_message,
  }));
}
