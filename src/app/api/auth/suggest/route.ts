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
 * Loopback-only: cookies are session secrets, so we refuse to ship them over
 * a forwarded or remote connection.
 */
export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

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
