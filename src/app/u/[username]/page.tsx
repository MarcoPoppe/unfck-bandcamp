import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { fetchDiggerProfile } from '@/lib/bandcamp/fetch_digger';
import { getDiggerDetail } from '@/lib/sync/diggers';
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
import { classifyActivity, getDiggerActivity } from '@/lib/library/activity';
import DiggerDetailClient from '@/app/digger/[id]/DiggerDetailClient';

export const dynamic = 'force-dynamic';

function findExistingDigger(username: string): { id: number } | null {
  const row = getDb()
    .prepare<[string], { id: number }>('SELECT id FROM diggers WHERE bc_username = ?')
    .get(username);
  return row ?? null;
}

function getOwnedBcItemIds(): Set<number> {
  const rows = getDb()
    .prepare<[], { bc_item_id: number }>(
      'SELECT bc_item_id FROM collection_items WHERE removed_at IS NULL',
    )
    .all();
  return new Set(rows.map((r) => r.bc_item_id));
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
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
  const { username: raw } = await params;
  const username = decodeURIComponent(raw).replace(/^@/, '').trim();
  if (!username) notFound();

  let profile;
  let profileError: string | null = null;
  try {
    profile = await fetchDiggerProfile(username, auth.cookieString);
  } catch (err) {
    profileError = err instanceof Error ? err.message : 'Profile fetch failed';
    profile = null;
  }

  const existing = findExistingDigger(profile?.username ?? username);
  // When the user lands on a curator that's never been seen before, upsert
  // a minimal `diggers` row so the AddEntityToPlaylistButton (and any other
  // tagging UI) has a real diggerId to POST against. Without this the page
  // rendered with diggerId=0 and the playlist-tag dropdown silently fell
  // back to "No playlists yet" because the route rejected diggerId<=0
  // (Susi report 2026-05-13). Follow/ignore stay opt-in.
  const wasExistingBeforeVisit = existing != null;
  const ensuredDiggerId =
    existing?.id ??
    (profile
      ? upsertDigger({
          bcUsername: profile.username,
          bcFanId: profile.fanId,
          displayName: profile.displayName,
          imageUrl: profile.imageUrl,
        })
      : null);
  const persisted = ensuredDiggerId ? getDiggerDetail(ensuredDiggerId) : null;

  const detail = persisted
    ? {
        ...persisted,
        displayName: profile?.displayName ?? persisted.displayName,
        imageUrl: profile?.imageUrl ?? persisted.imageUrl,
        bcFanId: profile?.fanId ?? persisted.bcFanId,
      }
    : {
        diggerId: 0,
        bcUsername: profile?.username ?? username,
        bcFanId: profile?.fanId ?? null,
        displayName: profile?.displayName ?? null,
        imageUrl: profile?.imageUrl ?? null,
        overlapCount: 0,
        sampleTitles: [],
        lastComputedAt: '',
        isFollowed: false,
        isIgnored: false,
      };

  const owned = getOwnedBcItemIds();
  const crawled = persisted ? listDiggerCollection(persisted.diggerId, 10000) : [];
  const crawlStatus = persisted ? getDiggerCrawlStatus(persisted.diggerId) : undefined;

  // Heal legacy tracks rows whose bc_album_id is NULL but album_url matches
  // one of the album items we're about to render.
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
        }))
      : (profile?.initialItems ?? []).map((it) => ({
          bcItemId: it.bcItemId,
          bcItemType: it.bcItemType,
          bcUrl: it.bcUrl,
          title: it.title,
          artistName: it.artistName,
          coverUrl: it.coverUrl,
          isOwnedByYou: owned.has(it.bcItemId),
          hasBeenPlayed: isPlayed(it.bcItemId, it.bcItemType, it.bcUrl),
          knownTrackBcIds:
            it.bcItemType === 'a'
              ? knownTrackBcIdsFor(it.bcItemId, it.bcUrl)
              : [],
        }));

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
        detail={detail}
        stats={stats}
        activity={
          persisted
            ? getDiggerActivity(persisted.diggerId)
            : classifyActivity(
                (profile?.initialItems ?? [])
                  .map((it) => it.purchasedAt)
                  .filter((d): d is string => d != null)
                  .sort()
                  .pop() ?? null,
              )
        }
        collectionItems={collectionItems}
        profileError={profileError}
        crawlStatus={crawlStatus}
        ephemeral={!wasExistingBeforeVisit}
      />
    </main>
  );
}
