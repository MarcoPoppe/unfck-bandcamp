import { getDb } from '../db';
import type { BcAuthInfo } from '../bandcamp/types';

export interface StoredAuth extends BcAuthInfo {
  cookieString: string;
  updatedAt: string;
}

export function getStoredAuth(): StoredAuth | null {
  const row = getDb()
    .prepare<
      [],
      {
        cookie_string: string;
        fan_id: number;
        username: string;
        email: string | null;
        updated_at: string;
      }
    >('SELECT cookie_string, fan_id, username, email, updated_at FROM auth WHERE id = 1')
    .get();
  if (!row) return null;
  return {
    cookieString: row.cookie_string,
    fanId: row.fan_id,
    username: row.username,
    email: row.email,
    updatedAt: row.updated_at,
  };
}

export function saveAuth(auth: BcAuthInfo, cookieString: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO auth (id, cookie_string, fan_id, username, email, updated_at)
     VALUES (1, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET
       cookie_string = excluded.cookie_string,
       fan_id = excluded.fan_id,
       username = excluded.username,
       email = excluded.email,
       updated_at = excluded.updated_at`,
  ).run(cookieString, auth.fanId, auth.username, auth.email);
}

export function deleteAuth(): void {
  getDb().prepare('DELETE FROM auth WHERE id = 1').run();
}
