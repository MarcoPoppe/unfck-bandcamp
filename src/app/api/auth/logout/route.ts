import { NextResponse } from 'next/server';
import { deleteAuth, type AuthRole } from '@/lib/auth/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LogoutBody {
  role?: AuthRole;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: LogoutBody = {};
  try {
    body = (await req.json()) as LogoutBody;
  } catch {
    // empty body is fine — defaults below pick crawler
  }
  // Default to crawler so old clients (no body) hit the read-side account.
  // Main is the rarer case (the user explicitly unlinks their real account).
  const role: AuthRole = body.role === 'main' ? 'main' : 'crawler';

  try {
    deleteAuth(role);
    return NextResponse.json({ ok: true, role }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'logout failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
