import { getDb } from '../db';
import type { BcAuthInfo } from '../bandcamp/types';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto';

export type AuthRole = 'crawler' | 'main';

export interface StoredAuth extends BcAuthInfo {
  cookieString: string;
  updatedAt: string;
  role: AuthRole;
}

interface AuthRow {
  role: AuthRole;
  cookie_string: string;
  fan_id: number;
  username: string;
  email: string | null;
  crawl_target_username: string | null;
  updated_at: string;
}

function rowToStoredAuth(row: AuthRow): StoredAuth {
  const cookieString = decryptSecret(row.cookie_string);
  // Lazy migration: if the row was still plain text, re-encrypt it now so
  // the next process boots with full encryption-at-rest.
  if (!isEncryptedSecret(row.cookie_string)) {
    try {
      getDb()
        .prepare('UPDATE auth SET cookie_string = ? WHERE role = ?')
        .run(encryptSecret(cookieString), row.role);
    } catch {
      // best-effort; reading still succeeds
    }
  }
  return {
    cookieString,
    fanId: row.fan_id,
    username: row.username,
    email: row.email,
    updatedAt: row.updated_at,
    role: row.role,
  };
}

function selectByRole(role: AuthRole): StoredAuth | null {
  const row = getDb()
    .prepare<[AuthRole], AuthRow>(
      `SELECT role, cookie_string, fan_id, username, email,
              crawl_target_username, updated_at
         FROM auth WHERE role = ?`,
    )
    .get(role);
  return row ? rowToStoredAuth(row) : null;
}

/**
 * Crawler auth — used for all reads / crawls / audio fetches.
 * Falls back to the main account during the migration window where a
 * legacy single-account install hasn't added a crawler yet, so existing
 * setups keep working until the user explicitly adds a throwaway.
 */
export function getStoredAuth(): StoredAuth | null {
  return selectByRole('crawler') ?? selectByRole('main');
}

/**
 * Strict crawler accessor — null when the user hasn't added a throwaway
 * account. Useful for setup status and warnings.
 */
export function getStoredCrawlerAuth(): StoredAuth | null {
  return selectByRole('crawler');
}

/**
 * Main account auth — used only to mirror follow/unfollow back to
 * bandcamp.com. Optional; null when not linked.
 */
export function getStoredMainAuth(): StoredAuth | null {
  return selectByRole('main');
}

/**
 * The bandcamp.com profile this instance pulls collection / follows from.
 * Resolution order:
 *   1. main.username — if a main account is linked, its profile is the
 *      user's real identity and the natural target.
 *   2. crawler.username — single-account setup, the crawler crawls itself.
 *   3. null — nothing configured yet.
 *
 * The crawler's `crawl_target_username` column is no longer used by the
 * UI but is preserved on disk so future power-user overrides can reuse it
 * without another migration.
 */
export function getCrawlTargetUsername(): string | null {
  const main = selectByRoleRaw('main');
  if (main) return main.username;
  const crawler = selectByRoleRaw('crawler');
  return crawler?.username ?? null;
}

function selectByRoleRaw(role: AuthRole): AuthRow | null {
  return (
    getDb()
      .prepare<[AuthRole], AuthRow>(
        `SELECT role, cookie_string, fan_id, username, email,
                crawl_target_username, updated_at
           FROM auth WHERE role = ?`,
      )
      .get(role) ?? null
  );
}

export function saveAuth(role: AuthRole, auth: BcAuthInfo, cookieString: string): void {
  const encrypted = encryptSecret(cookieString);
  getDb()
    .prepare(
      `INSERT INTO auth (role, cookie_string, fan_id, username, email, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (role) DO UPDATE SET
         cookie_string = excluded.cookie_string,
         fan_id = excluded.fan_id,
         username = excluded.username,
         email = excluded.email,
         updated_at = excluded.updated_at`,
    )
    .run(role, encrypted, auth.fanId, auth.username, auth.email);
}

export function deleteAuth(role: AuthRole): void {
  getDb().prepare('DELETE FROM auth WHERE role = ?').run(role);
}
