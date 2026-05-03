import { NextResponse } from 'next/server';
import { setDiggerIgnored } from '@/lib/sync/diggers';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  action?: 'ignore' | 'unignore';
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const { id } = await ctx.params;
  const diggerId = Number(id);
  if (!Number.isInteger(diggerId) || diggerId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid curator id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty
  }
  try {
    if (body.action === 'ignore') {
      setDiggerIgnored(diggerId, true);
    } else if (body.action === 'unignore') {
      setDiggerIgnored(diggerId, false);
    } else {
      return NextResponse.json(
        { ok: false, error: 'unknown action' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'action failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
