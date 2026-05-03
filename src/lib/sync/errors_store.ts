import { getDb } from '../db';
import { logger } from '../log';

export type SyncErrorKind =
  | 'owned'
  | 'tracks'
  | 'discovery'
  | 'diggers'
  | 'digger_collection'
  | 'follows'
  | 'best_of_supporters'
  | 'audio_stream';

export interface RecordedSyncError {
  kind: SyncErrorKind;
  runId?: number | null;
  itemUrl?: string | null;
  itemTitle?: string | null;
  message: string;
}

/**
 * Persist a per-item sync error so the diagnostics endpoint can surface
 * it after the toast is gone. Codex pass-2: errors used to live only in
 * API response payloads, so the user had no way to retrieve a yesterday-
 * was-broken bug-report. Best-effort: a logging failure must not cascade
 * back into the sync flow that was already failing.
 */
export function recordSyncError(err: RecordedSyncError): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO sync_errors (run_kind, run_id, item_url, item_title, error_message)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        err.kind,
        err.runId ?? null,
        err.itemUrl ?? null,
        err.itemTitle ?? null,
        err.message.length > 2000 ? err.message.slice(0, 2000) : err.message,
      );
  } catch (logErr) {
    // Swallow but log to file so we still know the persistence path is
    // broken — useful when the schema check missed something.
    logger.warn('sync_errors', 'failed to persist sync error', {
      original: err,
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }
}

/**
 * Most recent persisted sync errors for the diagnostics endpoint.
 */
export interface SyncErrorRow {
  id: number;
  kind: string;
  runId: number | null;
  itemUrl: string | null;
  itemTitle: string | null;
  message: string;
  createdAt: string;
}

export function listRecentSyncErrors(limit = 50): SyncErrorRow[] {
  try {
    const rows = getDb()
      .prepare<[number], {
        id: number;
        run_kind: string;
        run_id: number | null;
        item_url: string | null;
        item_title: string | null;
        error_message: string;
        created_at: string;
      }>(
        `SELECT id, run_kind, run_id, item_url, item_title, error_message, created_at
           FROM sync_errors ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      kind: r.run_kind,
      runId: r.run_id,
      itemUrl: r.item_url,
      itemTitle: r.item_title,
      message: r.error_message,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
