import { NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read the cookie file dropped by the user (`data/bc_cookies.txt`) and return
 * its contents so the setup UI can pre-fill the textarea. The file is opt-in:
 * if it doesn't exist the endpoint just reports `present: false`.
 *
 * Loopback-only AND opt-in via the `UNFCK_ALLOW_COOKIE_SUGGEST=1` env var so
 * packaged builds (Tauri / Docker shipped to friends) can disable this
 * cookie-leak surface entirely. Codex flagged this as HIGH risk for
 * distribution: the endpoint's only real purpose is to streamline a fresh
 * setup and that's a one-time UX win, not worth keeping permanently
 * exposed once an account is configured.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  if (process.env.UNFCK_ALLOW_COOKIE_SUGGEST !== '1') {
    return NextResponse.json(
      {
        ok: true,
        present: false,
        disabled: true,
        reason:
          'cookie-suggest endpoint disabled (set UNFCK_ALLOW_COOKIE_SUGGEST=1 to enable)',
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  const path = resolve(process.env.COOKIE_FILE ?? './data/bc_cookies.txt');
  try {
    await stat(path);
  } catch {
    return NextResponse.json({ ok: true, present: false }, { headers: NO_STORE_HEADERS });
  }
  try {
    const raw = await readFile(path, 'utf-8');
    const cookieString = raw.trim();
    if (!cookieString) {
      return NextResponse.json({ ok: true, present: false }, { headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { ok: true, present: true, cookieString },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'read error' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
