import { NextResponse } from 'next/server';
import { getStoredAuth } from '@/lib/auth/store';
import { fetchArtistOverview } from '@/lib/bandcamp/fetch_artist';
import {
  follow,
  listFollowedArtists,
  listFollowedDiggers,
  listFollowedLabels,
  unfollow,
  upsertArtist,
  upsertDigger,
  upsertLabel,
  type EntityType,
} from '@/lib/entities/store';
import { assertLocalRequest, NO_STORE_HEADERS } from '@/lib/http/local_only';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface FollowBody {
  entityType?: EntityType;
  entityId?: number;
  bcUrl?: string;
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: FollowBody;
  try {
    body = (await req.json()) as FollowBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const entityType = body.entityType;
  if (entityType !== 'artist' && entityType !== 'label' && entityType !== 'digger') {
    return NextResponse.json(
      { ok: false, error: 'entityType must be artist/label/digger' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let entityId = body.entityId ?? null;

  if (!entityId && body.bcUrl) {
    const auth = getStoredAuth();
    if (!auth) {
      return NextResponse.json(
        { ok: false, error: 'not configured (run /setup)' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const url = body.bcUrl.trim();
    try {
      if (entityType === 'artist') {
        const overview = await fetchArtistOverview(url, auth.cookieString);
        entityId = upsertArtist({
          bcUrl: url,
          name: overview.name,
          bcBandId: overview.bcBandId,
          imageUrl: overview.imageUrl,
        });
      } else if (entityType === 'label') {
        // Labels share the artist-overview shape; reuse the same fetcher.
        const overview = await fetchArtistOverview(url, auth.cookieString);
        entityId = upsertLabel({
          bcUrl: url,
          name: overview.name,
          imageUrl: overview.imageUrl,
        });
      } else {
        // diggers: bcUrl is bandcamp.com/<username>
        const u = new URL(url);
        const username = u.pathname.replace(/^\/+/, '').split('/')[0];
        if (!username) throw new Error('digger url must be bandcamp.com/<username>');
        entityId = upsertDigger({ bcUsername: username });
      }
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'add failed' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
  }

  if (!entityId) {
    return NextResponse.json(
      { ok: false, error: 'bcUrl or entityId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const created = follow(entityType, entityId);
  return NextResponse.json(
    { ok: true, entityType, entityId, alreadyFollowed: !created },
    { headers: NO_STORE_HEADERS },
  );
}

export async function DELETE(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const entityType = url.searchParams.get('entityType') as EntityType | null;
  const entityIdParam = url.searchParams.get('entityId');
  if (
    entityType !== 'artist' &&
    entityType !== 'label' &&
    entityType !== 'digger'
  ) {
    return NextResponse.json(
      { ok: false, error: 'entityType required' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const entityId = Number(entityIdParam);
  if (!Number.isInteger(entityId) || entityId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'entityId must be positive integer' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const removed = unfollow(entityType, entityId);
  return NextResponse.json({ ok: true, removed }, { headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  return NextResponse.json(
    {
      ok: true,
      artists: listFollowedArtists(),
      labels: listFollowedLabels(),
      diggers: listFollowedDiggers(),
    },
    { headers: NO_STORE_HEADERS },
  );
}
