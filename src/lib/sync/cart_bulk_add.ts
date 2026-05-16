import { getStoredMainAuth } from '../auth/store';
import { addToBcCart } from '../bandcamp/bc_cart';
import { isOwned, type BcItemType } from '../wishlist/store';
import { createSyncRun, getLatestSyncRunOfKind, markSyncRun, updateSyncRun } from './runs';

export interface BulkAddItem {
  itemType: BcItemType;
  itemId: number;
  bcUrl: string;
}

export interface BulkAddInput {
  items: BulkAddItem[];
}

export type BulkAddItemStatus =
  | 'added'
  | 'duplicate_skipped'
  | 'owned_skipped'
  | 'failed'
  | 'main_auth_expired';

export interface BulkAddItemResult {
  key: string;
  status: BulkAddItemStatus;
  error?: string;
}

export interface BulkAddResult {
  runId: number;
  alreadyRunning?: boolean;
  results: BulkAddItemResult[];
}

const THROTTLE_MS = 1200;
const RATE_LIMIT_BACKOFF_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function bulkAddToCart(input: BulkAddInput): Promise<BulkAddResult> {
  const main = getStoredMainAuth();
  if (!main) {
    return {
      runId: 0,
      results: [{ key: '*', status: 'main_auth_expired', error: 'main_auth_missing' }],
    };
  }

  const existing = getLatestSyncRunOfKind('cart');
  if (existing && existing.status === 'running') {
    return { runId: existing.id, alreadyRunning: true, results: [] };
  }

  const runId = createSyncRun({ kind: 'cart' });
  const seen = new Set<string>();
  const results: BulkAddItemResult[] = [];

  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    const key = `${item.itemType}:${item.itemId}`;
    if (seen.has(key)) {
      results.push({ key, status: 'duplicate_skipped' });
      continue;
    }
    seen.add(key);

    if (isOwned(item.itemType, item.itemId)) {
      results.push({ key, status: 'owned_skipped' });
      continue;
    }

    const first = await addToBcCart(item.bcUrl, {
      runId,
      itemKey: key,
      syncNum: i + 1,
      cartLength: i,
    });
    if (first.ok) {
      results.push({ key, status: 'added' });
    } else if (first.error === 'main_auth_expired') {
      // Cannot recover within this run; abort the batch and surface the
      // banner-worthy error to the caller.
      results.push({ key, status: 'main_auth_expired', error: first.error });
      markSyncRun(runId, {
        status: 'error',
        error_message: 'main_auth_expired',
        items_synced: results.length,
      });
      return { runId, results };
    } else if (first.error === 'bc_resync_rejected' || first.error === 'ref_token_missing') {
      // Bandcamp dropped the add silently (sync_num/ref_token mismatch).
      // Continuing with the same stale state keeps getting rejected, so
      // abort the batch and surface the failure so the user can re-try
      // after a manual refresh.
      results.push({ key, status: 'failed', error: first.error });
      markSyncRun(runId, {
        status: 'error',
        error_message: first.error,
        items_synced: results.length,
      });
      return { runId, results };
    } else if (first.error === 'rate_limited') {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      const second = await addToBcCart(item.bcUrl, {
        runId,
        itemKey: key,
        syncNum: i + 1,
        cartLength: i,
      });
      results.push({
        key,
        status: second.ok ? 'added' : 'failed',
        error: second.ok ? undefined : second.error,
      });
    } else {
      results.push({ key, status: 'failed', error: first.error });
    }

    updateSyncRun(runId, { items_synced: results.length });
    if (i < input.items.length - 1) await sleep(THROTTLE_MS);
  }

  markSyncRun(runId, {
    status: 'success',
    items_synced: results.length,
  });
  return { runId, results };
}
