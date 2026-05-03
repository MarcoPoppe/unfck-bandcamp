import { create } from 'zustand';
import type { TrackRowData } from '@/components/TrackRow';

export interface PlayerState {
  queue: TrackRowData[];
  currentId: number | null;
  isPlaying: boolean;
  /**
   * Bandcamp track ids that have been played in the current session for at
   * least one second. Components subscribe to this so the green "listened"
   * checkmark lights up live, without waiting for a page reload to re-read
   * the play log from SQLite.
   */
  playedBcTrackIds: Set<number>;
  /**
   * Bandcamp track ids on the open wishlist. Mirrors the server state so
   * the heart icon stays in sync across every list (Library, Discover,
   * Best-of, the player bar) when the user clicks heart anywhere.
   * Hydrated lazily by `hydrateWishlist()` and updated optimistically by
   * mark/unmark actions.
   */
  wishlistedBcTrackIds: Set<number>;
  setQueue: (queue: TrackRowData[]) => void;
  toggle: (id: number) => void;
  setIsPlaying: (playing: boolean) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  /**
   * Replace one queue entry by id. Used by StickyPlayerBar after a lazy
   * resolve to swap a synthetic-id entry with the real one. If the replaced
   * entry was the current track, currentId is updated atomically so the
   * track-change effect picks the new id up.
   */
  replaceTrack: (oldId: number, next: TrackRowData) => void;
  /**
   * Mark a BC track as played in the live store. Called by StickyPlayerBar
   * when a track has been audible for at least one second. Server-side play
   * recording continues in parallel via /api/plays.
   */
  markPlayed: (bcTrackId: number) => void;
  /**
   * Remove a BC track from the live played-set. Used when the user clicks
   * "mark as unplayed" — the API removes the track_plays rows server-side
   * and we drop the entry here so the green check disappears immediately.
   */
  markUnplayed: (bcTrackId: number) => void;
  /** Replace the entire played-set, e.g. on first mount when AppShell
   * hydrates from /api/plays?as=set. Without this, the live set only
   * grows from session plays and lists rendered after a navigation
   * round-trip can show stale "not played" state until reload. */
  setPlayedBcTrackIds: (ids: Iterable<number>) => void;
  /**
   * Replace one fat album-entry in the queue with the resolved tracklist.
   * Called by StickyPlayerBar after fetching /api/album/by-url for an
   * `albumExpand` queue entry. currentId jumps to the first track of the
   * album so the track-change effect picks it up and starts playback.
   */
  expandAlbum: (oldId: number, albumTracks: TrackRowData[]) => void;
  /** Replace the entire wishlisted-bc-track-id set, e.g. on first hydrate. */
  setWishlistedBcTrackIds: (ids: Iterable<number>) => void;
  /** Add a single bcTrackId — called after a successful POST /api/wishlist. */
  markOnWishlist: (bcTrackId: number) => void;
  /** Remove a single bcTrackId — for unmark via PATCH (dismiss/reopen). */
  markOffWishlist: (bcTrackId: number) => void;
  /**
   * Live map of playlist memberships keyed by local tracks.id. Components
   * (badges on track rows) subscribe so adding or removing a track from a
   * playlist updates every visible row immediately, without waiting for a
   * page refresh. Keyed by local id because that's what playlist_tracks
   * uses; rows without a resolved local id can't be in any playlist anyway.
   */
  playlistMembershipByTrackId: Map<number, { id: number; name: string }[]>;
  /** Replace the entire membership map, e.g. on first hydrate. */
  setPlaylistMembershipMap: (
    map: Map<number, { id: number; name: string }[]>,
  ) => void;
  /** Add a single membership — called after a successful add_track. */
  addPlaylistMembership: (
    trackId: number,
    playlist: { id: number; name: string },
  ) => void;
  /** Remove a single membership — called after a successful remove_track. */
  removePlaylistMembership: (trackId: number, playlistId: number) => void;
  /**
   * Tempo offset in percent. -50..+50. Applied as
   * `playbackRate = 1 + tempoPercent / 100` on the audio element. Reset to
   * 0 at every track-change so the user doesn't get blindsided by a +10%
   * carry-over when jumping from a 95-BPM track to a 130-BPM one.
   */
  tempoPercent: number;
  /** Master Tempo: when on, pitch is preserved while the rate changes. */
  preservesPitch: boolean;
  setTempoPercent: (pct: number) => void;
  setPreservesPitch: (b: boolean) => void;
  resetTempo: () => void;
  /**
   * Live BPM cache keyed by bc_track_id. Updated when the user clicks
   * "Detect BPM" and the analyzer returns a value. Components read from
   * this so the new BPM shows immediately, without waiting for the parent
   * page to re-fetch its row data.
   */
  bpmByBcTrackId: Map<number, number>;
  setBpmFor: (bcTrackId: number, bpm: number) => void;
}

function findNextPlayable(
  queue: TrackRowData[],
  fromIndex: number,
  direction: 1 | -1,
): TrackRowData | null {
  let i = fromIndex + direction;
  while (i >= 0 && i < queue.length) {
    const entry = queue[i];
    // Lazy entries (needsResolve), album-expand entries, and any row that
    // has a bcUrl get a chance — the player resolves missing stream URLs
    // via /api/track/lookup on first play. Already-resolved entries are
    // marked hasStream.
    if (
      entry.needsResolve
      || entry.albumExpand
      || entry.hasStream
      || entry.bcUrl
    ) return entry;
    i += direction;
  }
  return null;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentId: null,
  isPlaying: false,
  playedBcTrackIds: new Set<number>(),
  wishlistedBcTrackIds: new Set<number>(),
  setQueue: (queue) => set({ queue }),
  toggle: (id) => {
    const { queue, currentId, isPlaying } = get();
    const target = queue.find((t) => t.id === id);
    if (!target) return;
    // Allow play even for unresolved entries — StickyPlayerBar will resolve
    // (lazy) or expand (album) them on demand and swap the queue position
    // with the real entry/entries. Marco's rule: anything with a bcUrl is
    // playable; the player resolves missing stream URLs on first play.
    const lazyResolvable = !target.hasStream && !!target.bcUrl;
    if (
      !target.hasStream
      && !target.needsResolve
      && !target.albumExpand
      && !lazyResolvable
    ) {
      return;
    }
    if (currentId === id) {
      set({ isPlaying: !isPlaying });
    } else {
      set({ currentId: id, isPlaying: true });
    }
  },
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  next: () => {
    const { queue, currentId } = get();
    if (currentId == null || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    const target = findNextPlayable(queue, idx, 1);
    if (target) set({ currentId: target.id, isPlaying: true });
    else set({ currentId: null, isPlaying: false });
  },
  prev: () => {
    const { queue, currentId } = get();
    if (currentId == null || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    const target = findNextPlayable(queue, idx, -1);
    if (target) set({ currentId: target.id, isPlaying: true });
  },
  stop: () => set({ currentId: null, isPlaying: false }),
  replaceTrack: (oldId, next) =>
    set((state) => {
      const queue = state.queue.map((t) => (t.id === oldId ? next : t));
      const currentId = state.currentId === oldId ? next.id : state.currentId;
      return { queue, currentId };
    }),
  markPlayed: (bcTrackId) =>
    set((state) => {
      if (state.playedBcTrackIds.has(bcTrackId)) return state;
      const next = new Set(state.playedBcTrackIds);
      next.add(bcTrackId);
      return { playedBcTrackIds: next };
    }),
  markUnplayed: (bcTrackId) =>
    set((state) => {
      if (!state.playedBcTrackIds.has(bcTrackId)) return state;
      const next = new Set(state.playedBcTrackIds);
      next.delete(bcTrackId);
      return { playedBcTrackIds: next };
    }),
  setPlayedBcTrackIds: (ids) =>
    set({ playedBcTrackIds: new Set(ids) }),
  expandAlbum: (oldId, albumTracks) =>
    set((state) => {
      const idx = state.queue.findIndex((t) => t.id === oldId);
      if (idx < 0 || albumTracks.length === 0) return state;
      const queue = [
        ...state.queue.slice(0, idx),
        ...albumTracks,
        ...state.queue.slice(idx + 1),
      ];
      // If the album entry was the currently selected one, jump to its
      // first track so the track-change effect picks it up.
      const currentId =
        state.currentId === oldId ? albumTracks[0].id : state.currentId;
      return { queue, currentId };
    }),
  setWishlistedBcTrackIds: (ids) =>
    set({ wishlistedBcTrackIds: new Set(ids) }),
  markOnWishlist: (bcTrackId) =>
    set((state) => {
      if (state.wishlistedBcTrackIds.has(bcTrackId)) return state;
      const next = new Set(state.wishlistedBcTrackIds);
      next.add(bcTrackId);
      return { wishlistedBcTrackIds: next };
    }),
  markOffWishlist: (bcTrackId) =>
    set((state) => {
      if (!state.wishlistedBcTrackIds.has(bcTrackId)) return state;
      const next = new Set(state.wishlistedBcTrackIds);
      next.delete(bcTrackId);
      return { wishlistedBcTrackIds: next };
    }),
  playlistMembershipByTrackId: new Map<number, { id: number; name: string }[]>(),
  setPlaylistMembershipMap: (map) =>
    set({ playlistMembershipByTrackId: new Map(map) }),
  addPlaylistMembership: (trackId, playlist) =>
    set((state) => {
      const next = new Map(state.playlistMembershipByTrackId);
      const list = next.get(trackId) ?? [];
      if (list.some((p) => p.id === playlist.id)) return state;
      next.set(
        trackId,
        [...list, playlist].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return { playlistMembershipByTrackId: next };
    }),
  removePlaylistMembership: (trackId, playlistId) =>
    set((state) => {
      const list = state.playlistMembershipByTrackId.get(trackId);
      if (!list || !list.some((p) => p.id === playlistId)) return state;
      const next = new Map(state.playlistMembershipByTrackId);
      const filtered = list.filter((p) => p.id !== playlistId);
      if (filtered.length === 0) next.delete(trackId);
      else next.set(trackId, filtered);
      return { playlistMembershipByTrackId: next };
    }),
  tempoPercent: 0,
  preservesPitch: true,
  setTempoPercent: (pct) =>
    set({ tempoPercent: Math.max(-50, Math.min(50, pct)) }),
  setPreservesPitch: (b) => set({ preservesPitch: b }),
  resetTempo: () => set({ tempoPercent: 0 }),
  bpmByBcTrackId: new Map<number, number>(),
  setBpmFor: (bcTrackId, bpm) =>
    set((state) => {
      const next = new Map(state.bpmByBcTrackId);
      next.set(bcTrackId, bpm);
      return { bpmByBcTrackId: next };
    }),
}));
