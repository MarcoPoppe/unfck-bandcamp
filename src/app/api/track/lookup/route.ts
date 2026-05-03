import { NextResponse } from 'next/server';
import { lookupTrack } from '@/lib/track/lookup';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  input?: string;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty
  }
  const input = (body.input ?? '').trim();
  if (!input) {
    return NextResponse.json(
      { ok: false, error: 'input required (Bandcamp URL or numeric track id)' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await lookupTrack(input);
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
