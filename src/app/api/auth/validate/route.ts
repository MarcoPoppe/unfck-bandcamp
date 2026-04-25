import { NextResponse } from 'next/server';
import { validateCookies } from '@/lib/bandcamp/auth';
import { saveAuth } from '@/lib/auth/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ValidateBody {
  cookieString?: string;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: ValidateBody;
  try {
    body = (await req.json()) as ValidateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json body' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const cookieString = body.cookieString?.trim();
  if (!cookieString) {
    return NextResponse.json(
      { ok: false, error: 'cookieString is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const auth = await validateCookies(cookieString);
    saveAuth(auth, cookieString);
    return NextResponse.json({ ok: true, auth }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
