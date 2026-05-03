import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStoredAuth, getStoredMainAuth } from '@/lib/auth/store';
import { fetchArtistOverview } from '@/lib/bandcamp/fetch_artist';
import { fetchDiggerProfile } from '@/lib/bandcamp/fetch_digger';
import { bcSetFollow } from '@/lib/bandcamp/fan_follows';
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

function getEntityBcId(entityType: EntityType, entityId: number): number | null {
  const db = getDb();
  if (entityType === 'artist') {
    const row = db
      .prepare<[number], { bc_band_id: number | null }>(
        'SELECT bc_band_id FROM artists WHERE id = ?',
      )
      .get(entityId);
    return row?.bc_band_id ?? null;
  }
  if (entityType === 'label') {
    // Labels share the bands table on Bandcamp, so we'd need their band_id.
    // We don't currently store one — return null and the mirror is skipped.
    return null;
  }
  const row = db
    .prepare<[number], { bc_fan_id: number | null }>(
      'SELECT bc_fan_id FROM diggers WHERE id = ?',
    )
    .get(entityId);
  return row?.bc_fan_id ?? null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface FollowBody {
  entityType?: EntityType;
  entityId?: number;
  bcUrl?: string;
  mirrorToBandcamp?: boolean;
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
      { ok: false, error: 'entityType must be artist/label/curator' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let entityId =
    body.entityId != null &&
    Number.isInteger(body.entityId) &&
    body.entityId > 0
      ? body.entityId
      : null;

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
        // curators: bcUrl is bandcamp.com/<username>
        const u = new URL(url);
        const username = u.pathname.replace(/^\/+/, '').split('/')[0];
        if (!username) throw new Error('curator url must be bandcamp.com/<username>');
        // Hit the public profile page so we capture fan_id, display name and
        // avatar at add-time. If the fetch fails we still create the local
        // row so the user isn't blocked by a transient Bandcamp issue.
        let profile;
        try {
          profile = await fetchDiggerProfile(username, auth.cookieString);
        } catch {
          profile = null;
        }
        entityId = upsertDigger({
          bcUsername: profile?.username ?? username,
          bcFanId: profile?.fanId ?? null,
          displayName: profile?.displayName ?? null,
          imageUrl: profile?.imageUrl ?? null,
        });
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

  let bcMirrorWarning: string | null = null;
  if (body.mirrorToBandcamp) {
    // Mirror writes go through the main account explicitly — the crawler
    // is a throwaway and follows performed on it would land on the wrong
    // identity on bandcamp.com.
    const mainAuth = getStoredMainAuth();
    const bcId = getEntityBcId(entityType, entityId);
    if (!mainAuth) {
      bcMirrorWarning = 'Main account not linked — follow saved locally only';
    } else if (entityType === 'label') {
      bcMirrorWarning = 'Mirroring labels is not supported yet (no band_id stored)';
    } else if (!bcId) {
      bcMirrorWarning =
        'Could not mirror to Bandcamp: missing band/fan id (run a discovery sync first)';
    } else {
      try {
        await bcSetFollow({
          entityType,
          entityBcId: bcId,
          action: 'follow',
          cookieString: mainAuth.cookieString,
        });
      } catch (err) {
        bcMirrorWarning = err instanceof Error ? err.message : 'Bandcamp mirror failed';
      }
    }
  }

  return NextResponse.json(
    { ok: true, entityType, entityId, alreadyFollowed: !created, bcMirrorWarning },
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
  const mirror = url.searchParams.get('mirrorToBandcamp') === '1';
  const removed = unfollow(entityType, entityId);

  let bcMirrorWarning: string | null = null;
  if (mirror) {
    const mainAuth = getStoredMainAuth();
    const bcId = getEntityBcId(entityType, entityId);
    if (mainAuth && bcId && entityType !== 'label') {
      try {
        await bcSetFollow({
          entityType,
          entityBcId: bcId,
          action: 'unfollow',
          cookieString: mainAuth.cookieString,
        });
      } catch (err) {
        bcMirrorWarning = err instanceof Error ? err.message : 'Bandcamp mirror failed';
      }
    } else if (entityType === 'label') {
      bcMirrorWarning = 'Mirroring labels is not supported yet';
    } else if (!mainAuth) {
      bcMirrorWarning = 'Main account not linked — follow removed locally only';
    } else {
      bcMirrorWarning = 'Missing band/fan id for mirror';
    }
  }

  return NextResponse.json(
    { ok: true, removed, bcMirrorWarning },
    { headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;
  return NextResponse.json(
    {
      ok: true,
      artists: listFollowedArtists(),
      labels: listFollowedLabels(),
      curators: listFollowedDiggers(),
    },
    { headers: NO_STORE_HEADERS },
  );
}
