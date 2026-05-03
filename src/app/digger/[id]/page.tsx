import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { getDiggerDetail } from '@/lib/sync/diggers';
import { fetchDiggerProfile, type DiggerProfile } from '@/lib/bandcamp/fetch_digger';
import { resolveFanIdToUsername } from '@/lib/bandcamp/resolve_ids';
import { upsertDigger } from '@/lib/entities/store';
import {
  getDiggerCrawlStatus,
  listDiggerCollection,
} from '@/lib/sync/digger_collection';
import {
  getPlayedBcTrackIds,
  getAlbumPlayedStats,
  getAlbumPlayedStatsByUrl,
  getKnownTrackBcIdsByAlbum,
  getKnownTrackBcIdsByAlbumUrl,
  normalizeAlbumUrl,
  reconcileAlbumIdsByUrl,
} from '@/lib/library/plays';
import { getDiggerActivity } from '@/lib/library/activity';
import DiggerDetailClient from './DiggerDetailClient';

export const dynamic = 'force-dynamic';

interface OwnedSet {
  bcItemIds: Set<number>;
}

/** Bulk-match label info for curator collection items via local tracks. */
function loadDiggerItemLabels(
  items: { bcItemId: number; bcItemType: 'a' | 't' }[],
): Map<string, { labelId: number; labelName: string; labelBcUrl: string | null }> {
  const trackIds = items.filter((i) => i.bcItemType === 't').map((i) => i.bcItemId);
  const albumIds = items.filter((i) => i.bcItemType === 'a').map((i) => i.bcItemId);
  const map = new Map<
    string,
    { labelId: number; labelName: string; labelBcUrl: string | null }
  >();
  const db = getDb();
  if (trackIds.length > 0) {
    const ph = trackIds.map(() => '?').join(',');
    const rows = db
      .prepare<number[], {
        bc_track_id: number;
        label_id: number | null;
        label_name: string | null;
        label_bc_url: string | null;
      }>(
        `SELECT t.bc_track_id, t.label_id,
                l.name AS label_name,
                l.bc_url AS label_bc_url
           FROM tracks t LEFT JOIN labels l ON l.id = t.label_id
           WHERE t.bc_track_id IN (${ph}) AND t.removed_at IS NULL`,
      )
      .all(...trackIds);
    for (const r of rows) {
      if (r.label_id != null && r.label_name) {
        map.set(`t:${r.bc_track_id}`, {
          labelId: r.label_id,
          labelName: r.label_name,
          labelBcUrl: r.label_bc_url,
        });
      }
    }
  }
  if (albumIds.length > 0) {
    const ph = albumIds.map(() => '?').join(',');
    const rows = db
      .prepare<number[], {
        bc_album_id: number;
        label_id: number | null;
        label_name: string | null;
        label_bc_url: string | null;
      }>(
        `SELECT t.bc_album_id, t.label_id,
                l.name AS label_name,
                l.bc_url AS label_bc_url
           FROM tracks t LEFT JOIN labels l ON l.id = t.label_id
           WHERE t.bc_album_id IN (${ph}) AND t.removed_at IS NULL
           GROUP BY t.bc_album_id`,
      )
      .all(...albumIds);
    for (const r of rows) {
      if (r.label_id != null && r.label_name) {
        map.set(`a:${r.bc_album_id}`, {
          labelId: r.label_id,
          labelName: r.label_name,
          labelBcUrl: r.label_bc_url,
        });
      }
    }
  }
  return map;
}

function getOwnedBcItemIds(): OwnedSet {
  const rows = getDb()
    .prepare<[], { bc_item_id: number }>(
      `SELECT bc_item_id FROM collection_items WHERE removed_at IS NULL`,
    )
    .all();
  return { bcItemIds: new Set(rows.map((r) => r.bc_item_id)) };
}

function localIdFromBcFanId(bcFanId: number): number | null {
  const row = getDb()
    .prepare<[number], { id: number }>('SELECT id FROM diggers WHERE bc_fan_id = ?')
    .get(bcFanId);
  return row?.id ?? null;
}

export default async function DiggerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-fg-secondary">
          Setup is not complete.{' '}
          <a className="text-accent underline" href="/setup">
            Open setup
          </a>
          .
        </p>
      </main>
    );
  }
  const { id } = await params;
  // URL param is the Bandcamp fan id. Resolve to our local curators.id.
  const bcFanId = Number(id);
  if (!Number.isInteger(bcFanId) || bcFanId <= 0) notFound();
  let localId = localIdFromBcFanId(bcFanId);
  // Auto-lookup fallback: if the fan id is unknown locally, ask BC for the
  // username, persist a stub row, and continue. Mirrors the /track/[id]
  // auto-lookup behaviour so deep-links don't dead-end on 404.
  if (!localId) {
    const resolved = await resolveFanIdToUsername(bcFanId, auth.cookieString);
    if (resolved) {
      localId = upsertDigger({
        bcUsername: resolved.username,
        bcFanId,
        displayName: resolved.displayName,
        imageUrl: resolved.imageUrl,
      });
    }
  }
  if (!localId) notFound();
  const detail = getDiggerDetail(localId);
  if (!detail) notFound();

  // Live-fetch the profile so we always have an avatar, current stats, and
  // the most recent slice of the curator's collection. Failure is non-fatal
  // and the page falls back to whatever we cached in DB at add-time.
  let profile: DiggerProfile | null = null;
  let profileError: string | null = null;
  try {
    profile = await fetchDiggerProfile(detail.bcUsername, auth.cookieString);
    // Backfill cached curator row with whatever we just learned.
    upsertDigger({
      bcUsername: profile.username,
      bcFanId: profile.fanId ?? detail.bcFanId,
      displayName: profile.displayName ?? detail.displayName,
      imageUrl: profile.imageUrl ?? detail.imageUrl,
    });
  } catch (err) {
    profileError = err instanceof Error ? err.message : 'Profile fetch failed';
  }

  // Prefer the persisted full crawl when available; fall back to the live
  // initial items.
  const crawlStatus = getDiggerCrawlStatus(localId);
  const crawled = listDiggerCollection(localId, 10000);
  const owned = getOwnedBcItemIds();
  // Opportunistic heal: collection items of type='a' tell us the album id
  // for any track in our DB whose album_url matches but whose bc_album_id
  // is still NULL (legacy imports). Run this before reading album stats so
  // the joins below pick up the freshly-set ids.
  const visibleAlbumItems = (
    crawled.length > 0
      ? crawled
          .filter((it) => it.bcItemType === 'a' && it.bcUrl)
          .map((it) => ({ bcItemId: it.bcItemId, bcUrl: it.bcUrl ?? '' }))
      : (profile?.initialItems ?? [])
          .filter((it) => it.bcItemType === 'a' && it.bcUrl)
          .map((it) => ({ bcItemId: it.bcItemId, bcUrl: it.bcUrl }))
  );
  reconcileAlbumIdsByUrl(visibleAlbumItems);
  const played = getPlayedBcTrackIds();
  // For album-typed items: same logic as the best-of route — an album
  // counts as "heard" when every locally-known track of it has at least
  // one play. We match by both bc_album_id (the BC tralbum_id we persisted)
  // AND album_url because BC's collection-item id occasionally diverges
  // from the id we extract off the album page; URL matching is the more
  // reliable join for list-page rows.
  const albumStats = getAlbumPlayedStats();
  const albumStatsByUrl = getAlbumPlayedStatsByUrl();
  const knownTrackIdsById = getKnownTrackBcIdsByAlbum();
  const knownTrackIdsByUrl = getKnownTrackBcIdsByAlbumUrl();
  function knownTrackBcIdsFor(bcItemId: number, bcUrl: string | null): number[] {
    const byId = knownTrackIdsById.get(bcItemId);
    if (byId && byId.length > 0) return byId;
    if (bcUrl) {
      const byUrl = knownTrackIdsByUrl.get(normalizeAlbumUrl(bcUrl));
      if (byUrl && byUrl.length > 0) return byUrl;
    }
    return [];
  }
  const isPlayed = (
    bcItemId: number,
    bcItemType: 'a' | 't',
    bcUrl?: string | null,
  ) => {
    if (bcItemType === 't') return played.has(bcItemId);
    const byId = albumStats.get(bcItemId);
    if (byId && byId.total > 0 && byId.played === byId.total) return true;
    if (bcUrl) {
      const byUrl = albumStatsByUrl.get(normalizeAlbumUrl(bcUrl));
      if (byUrl && byUrl.total > 0 && byUrl.played === byUrl.total) return true;
    }
    return false;
  };
  const labelByItem = loadDiggerItemLabels(
    crawled.length > 0
      ? crawled.map((it) => ({ bcItemId: it.bcItemId, bcItemType: it.bcItemType }))
      : (profile?.initialItems ?? []).map((it) => ({
          bcItemId: it.bcItemId,
          bcItemType: it.bcItemType,
        })),
  );
  const collectionItems =
    crawled.length > 0
      ? crawled.map((it) => ({
          bcItemId: it.bcItemId,
          bcItemType: it.bcItemType,
          bcUrl: it.bcUrl ?? '',
          title: it.title ?? '(unknown)',
          artistName: it.artistName,
          coverUrl: it.coverUrl,
          isOwnedByYou: it.isOwnedByYou,
          hasBeenPlayed: isPlayed(it.bcItemId, it.bcItemType, it.bcUrl),
          knownTrackBcIds:
            it.bcItemType === 'a'
              ? knownTrackBcIdsFor(it.bcItemId, it.bcUrl)
              : [],
          ...(labelByItem.get(`${it.bcItemType}:${it.bcItemId}`) ?? {
            labelId: null,
            labelName: null,
            labelBcUrl: null,
          }),
        }))
      : (profile?.initialItems ?? []).map((it) => ({
          ...(labelByItem.get(`${it.bcItemType}:${it.bcItemId}`) ?? {
            labelId: null,
            labelName: null,
            labelBcUrl: null,
          }),
          bcItemId: it.bcItemId,
          bcItemType: it.bcItemType,
          bcUrl: it.bcUrl,
          title: it.title,
          artistName: it.artistName,
          coverUrl: it.coverUrl,
          isOwnedByYou: owned.bcItemIds.has(it.bcItemId),
          hasBeenPlayed: isPlayed(it.bcItemId, it.bcItemType, it.bcUrl),
          knownTrackBcIds:
            it.bcItemType === 'a'
              ? knownTrackBcIdsFor(it.bcItemId, it.bcUrl)
              : [],
        }));

  const merged = {
    ...detail,
    displayName: profile?.displayName ?? detail.displayName,
    imageUrl: profile?.imageUrl ?? detail.imageUrl,
    bcFanId: profile?.fanId ?? detail.bcFanId,
  };
  const stats = {
    bio: profile?.bio ?? null,
    location: profile?.location ?? null,
    websiteUrl: profile?.websiteUrl ?? null,
    followersCount: profile?.followersCount ?? null,
    followingBandsCount: profile?.followingBandsCount ?? null,
    itemCount: profile?.itemCount ?? null,
  };

  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-8">
      <Link
        href="/discover?tab=curators"
        className="text-sm text-fg-muted transition-colors hover:text-accent"
      >
        ← All curators
      </Link>
      <DiggerDetailClient
        detail={merged}
        stats={stats}
        activity={getDiggerActivity(localId)}
        collectionItems={collectionItems}
        profileError={profileError}
        crawlStatus={crawlStatus}
      />
    </main>
  );
}
