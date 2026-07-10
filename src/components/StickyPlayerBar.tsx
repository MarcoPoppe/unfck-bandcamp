'use client';

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { usePlayerStore } from '@/lib/store/player';
import { usePreferences } from '@/lib/settings/preferences';
import { THEME_CHANGE_EVENT } from '@/lib/settings/theme';
import { detectBpmForTrack } from '@/lib/audio/detect_bpm';
import WishlistButton from './WishlistButton';
import LazyAddToPlaylistButton from './LazyAddToPlaylistButton';
import TempoControls from './TempoControls';
import Tooltip from './Tooltip';
import type { TrackRowData } from './TrackRow';

function formatTime(seconds: number, sign: '' | '-' = ''): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}

// Low-amplitude placeholder waveform shown while a never-before-heard track
// streams progressively for the first time. The gentle variation avoids a
// normalize divide-by-zero and reads as "loading" rather than a real
// waveform; backfillPeaks() replaces it with the decoded peaks once cached.
const PLACEHOLDER_PEAKS: number[][] = [
  Array.from({ length: 400 }, (_, i) => 0.12 + 0.06 * Math.sin(i / 5)),
];

function peaksUrlFor(track: TrackRowData): string {
  return track.source === 'discovered'
    ? `/api/audio/peaks?id=${track.id}&source=discovered`
    : `/api/audio/peaks?id=${track.id}`;
}

// Extract per-bucket RMS (loudness) from a decoded AudioBuffer, small enough
// to cache and re-feed as channelData. RMS on purpose, NOT peak/max-abs:
// loud, heavily-mastered electronic tracks sit near full-scale almost
// everywhere, so a peak waveform reads as a flat "sausage" with no visible
// dynamics. RMS tracks actual energy, so quiet passages and low-bass
// sections show up as visibly shorter bars — measured on real tracks it
// roughly doubles the spread (std 0.28 vs 0.16) and triples the share of
// sub-half-height bars (22% vs 7%). WaveSurfer's normalize:true then scales
// the loudest bucket back to full height, so the waveform still fills the row.
function extractPeaks(buf: AudioBuffer, maxLength: number): number[][] {
  const channels = Math.min(buf.numberOfChannels, 2);
  const out: number[][] = [];
  for (let c = 0; c < channels; c += 1) {
    const chan = buf.getChannelData(c);
    const bucket = chan.length / maxLength;
    const data: number[] = new Array(maxLength);
    for (let i = 0; i < maxLength; i += 1) {
      const start = Math.floor(i * bucket);
      const end = Math.min(Math.ceil((i + 1) * bucket), chan.length);
      let sumSq = 0;
      for (let j = start; j < end; j += 1) {
        sumSq += chan[j] * chan[j];
      }
      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      data[i] = Math.round(rms * 10000) / 10000;
    }
    out[c] = data;
  }
  return out;
}

export default function StickyPlayerBar() {
  const queue = usePlayerStore((s) => s.queue);
  const currentId = usePlayerStore((s) => s.currentId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const advance = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const replaceTrack = usePlayerStore((s) => s.replaceTrack);
  const expandAlbum = usePlayerStore((s) => s.expandAlbum);
  const markPlayed = usePlayerStore((s) => s.markPlayed);
  const tempoPercent = usePlayerStore((s) => s.tempoPercent);
  const preservesPitch = usePlayerStore((s) => s.preservesPitch);
  const resetTempo = usePlayerStore((s) => s.resetTempo);
  const bpmByBcTrackId = usePlayerStore((s) => s.bpmByBcTrackId);
  const setBpmFor = usePlayerStore((s) => s.setBpmFor);

  const [prefs] = usePreferences();
  const [tempoOpen, setTempoOpen] = useState(false);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const requestTokenRef = useRef(0);
  const wantsPlayRef = useRef(false);
  // True from the moment we start a track switch (ws.empty / ws.load)
  // until 'ready' fires. WaveSurfer fires an internal 'pause' event during
  // load(), which without this guard would flip isPlaying to false and
  // null wantsPlayRef, so onReady would skip auto-play. The user would
  // have to press Play again after every A/D. With the flag we ignore the
  // internal pause and wantsPlayRef stays stable.
  const decodingRef = useRef(false);
  // Last requestToken value we already scheduled an auto-skip for. Prevents
  // both ws.load.catch and the on('error') event handler from firing two
  // independent advance() calls for the same broken track (which would
  // overshoot by one), and prevents a delayed error from a previous track
  // skipping past the new one when the user has already moved on.
  const lastSkippedTokenRef = useRef<number>(-1);
  // Tracks queue ids that have a pre-resolve fetch in flight, so the
  // background prefetch effect doesn't double-fire while a previous lookup
  // is still pending.
  const prefetchInFlightRef = useRef<Set<number>>(new Set());
  // We hand WaveSurfer our own <audio> element so we can unlock it on the
  // first user gesture (browser autoplay policy: media.play() called from
  // an async callback minutes after a click is rejected with NotAllowedError
  // even though the user did interact). Without unlock, the very first
  // track plays silently (no Play event fires) and the user has to press
  // Space; same problem after EP-expand because the album lookup eats the
  // ~5s gesture window.
  const mediaElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  if (typeof window !== 'undefined' && !mediaElementRef.current) {
    mediaElementRef.current = new Audio();
    mediaElementRef.current.preload = 'auto';
  }

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const current = queue.find((t) => t.id === currentId) ?? null;
  // BPM source order: a freshly-detected value in the live store wins
  // over the row's server snapshot, so the player updates immediately
  // after the user clicks "Detect" without waiting for a row refetch.
  const liveBpm =
    current?.bcTrackId != null ? bpmByBcTrackId.get(current.bcTrackId) ?? null : null;
  const bpm = liveBpm ?? current?.bpm ?? null;

  useEffect(() => {
    const container = waveformRef.current;
    if (!container) return;
    const media = mediaElementRef.current;
    if (!media) return;

    // Resolve WaveSurfer colors from the live CSS palette so the waveform
    // tracks the active theme (border-strong, accent, accent-hover).
    const cs = getComputedStyle(document.documentElement);
    const cssVar = (name: string, fallback: string) => {
      const triple = cs.getPropertyValue(name).trim();
      return triple ? `rgb(${triple.replace(/\s+/g, ' ')})` : fallback;
    };

    const ws = WaveSurfer.create({
      container,
      // Use our own audio element so the unlock effect below can prime it
      // within the first user gesture, before any ws.load() src swap.
      media,
      waveColor: cssVar('--border-strong', '#3a3a44'),
      progressColor: cssVar('--accent', '#1da0c3'),
      cursorColor: cssVar('--accent-hover', '#3eb9d9'),
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      // Height matches the waveform container in the player bar (h-12 =
      // 48px) so the bar pattern fills the row vertically the same way
      // Beatport's player does.
      height: 48,
      normalize: true,
      fillParent: true,
    });
    wsRef.current = ws;

    const onReady = (durationSec: number) => {
      decodingRef.current = false;
      setDecoding(false);
      setDuration(durationSec);
      // Clear any stalling-warning message from the soft watchdog now
      // that audio is actually ready. If a real load error already
      // surfaced, that path doesn't go through onReady so this is safe.
      setError(null);
      if (!wantsPlayRef.current) return;
      const token = requestTokenRef.current;
      ws.play().catch((err: unknown) => {
        if (token !== requestTokenRef.current) return;
        // AbortError happens when a previous ws.play() (fired by the
        // isPlaying-effect during loading) was racing this one. The race
        // doesn't mean playback failed — silently ignore so we don't flip
        // isPlaying off and force the user to press Space again.
        if (err instanceof Error && err.name === 'AbortError') return;
        // Other errors (e.g. NotAllowedError, transient audio-element
        // hiccup right after decode) often resolve on a single retry —
        // before that, the user sees the row toggle to "playing" and then
        // silently flip back to paused, which forces them to press Space.
        // Try once more after a short delay; only if THAT fails do we
        // surface the error and pause the player.
        window.setTimeout(() => {
          if (token !== requestTokenRef.current) return;
          const w = wsRef.current;
          if (!w || w.isPlaying()) return;
          w.play().catch((err2: unknown) => {
            if (token !== requestTokenRef.current) return;
            if (err2 instanceof Error && err2.name === 'AbortError') return;
            setError(err2 instanceof Error ? err2.message : 'play failed');
            setIsPlaying(false);
          });
        }, 80);
      });
    };
    const onTime = (t: number) => setPosition(t);
    const onFinish = () => advance();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      // WaveSurfer fires pause internally when ws.load() swaps the source.
      // Suppress that during track switches so isPlaying / wantsPlayRef stay
      // true and onReady auto-resumes without a second user click.
      if (decodingRef.current) return;
      setIsPlaying(false);
    };
    const onError = (err: Error) => {
      // While we're in the middle of an explicit non-load transition (e.g.
      // album-expand or lazy-resolve fetching, or ws.empty() between
      // tracks), the audio element fires synthetic 'error' events that
      // aren't real stream failures. Ignore them — the actual load failure
      // surfaces via ws.load().catch which still triggers scheduleAutoSkip.
      // Without this guard the user briefly sees an "audio error" message
      // while jumping to an EP, before expandAlbum settles.
      if (decodingRef.current) return;
      const token = requestTokenRef.current;
      // Generic fallback first so the user sees *something* immediately —
      // the diagnose-fetch below upgrades it once we know the HTTP status.
      setError(err?.message ?? 'audio error');
      setDecoding(false);
      void diagnoseStreamForCurrent().then((msg) => {
        if (token !== requestTokenRef.current) return;
        if (msg) setError(msg);
      });
      // Use the shared scheduleAutoSkip so the on('error') event and a
      // simultaneous ws.load().catch can't both schedule independent
      // advance() calls — the lastSkippedTokenRef guard de-dupes them.
      scheduleAutoSkip(requestTokenRef.current);
    };

    ws.on('ready', onReady);
    ws.on('timeupdate', onTime);
    ws.on('finish', onFinish);
    ws.on('play', onPlay);
    ws.on('pause', onPause);
    ws.on('error', onError);

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [advance, setIsPlaying]);

  // Re-tint the waveform when the theme changes. WaveSurfer 7 supports
  // setOptions for live colour updates; we read the current CSS palette
  // each time so light <-> dark swaps without a player rebuild.
  useEffect(() => {
    function repaint() {
      const ws = wsRef.current;
      if (!ws) return;
      const cs = getComputedStyle(document.documentElement);
      const cssVar = (name: string, fallback: string) => {
        const triple = cs.getPropertyValue(name).trim();
        return triple ? `rgb(${triple.replace(/\s+/g, ' ')})` : fallback;
      };
      ws.setOptions({
        waveColor: cssVar('--border-strong', '#3a3a44'),
        progressColor: cssVar('--accent', '#1da0c3'),
        cursorColor: cssVar('--accent-hover', '#3eb9d9'),
      });
    }
    window.addEventListener(THEME_CHANGE_EVENT, repaint);
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener?.('change', repaint);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, repaint);
      mq?.removeEventListener?.('change', repaint);
    };
  }, []);

  // Auto-detect BPM after a short dwell on a track that doesn't yet
  // have one. Skip-through browsing (A/D rapid-fire) cancels each
  // pending detect via the cleanup, so we never decode a stream we
  // weren't planning to listen to. Three guards keep this cheap:
  //   1. preference toggle (Settings → Auto-detect BPM)
  //   2. only when bpm is unknown (server snapshot AND live cache)
  //   3. only for resolved local tracks; lazy / synthetic queue entries
  //      get analyzed on their first real play, after the player swaps
  //      them in for the resolved row.
  useEffect(() => {
    if (!prefs.autoDetectBpm) return;
    if (!current || !current.id || current.id < 0) return;
    if (bpm != null) return;

    const controller = new AbortController();
    // 2.5s dwell is long enough to avoid burning a fetch on a skip-past
    // and short enough that the BPM is on screen before the user thinks
    // about it.
    const timeoutId = window.setTimeout(() => {
      void detectBpmForTrack({
        trackId: current.id,
        bcTrackId: current.bcTrackId,
        bcUrl: current.bcUrl,
        signal: controller.signal,
      })
        .then((result) => {
          if (current.bcTrackId != null) setBpmFor(current.bcTrackId, result.bpm);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Auto-detect failures stay silent: the user didn't ask, so a
          // toast would be noise. The on-click button surfaces errors.
        });
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [currentId, prefs.autoDetectBpm, bpm, setBpmFor, current]);

  // Tempo + master-tempo: drive both the WaveSurfer instance (for the
  // playback-rate it tracks internally) and the underlying audio element
  // (for preservesPitch + the vendor fallbacks some browsers still need).
  // Runs whenever the user moves the slider or toggles preserve pitch,
  // plus once after each track-change so the (just-reset) values re-apply
  // to the freshly-loaded media.
  useEffect(() => {
    const media = mediaElementRef.current;
    const ws = wsRef.current;
    const rate = 1 + tempoPercent / 100;
    if (ws) {
      try {
        ws.setPlaybackRate(rate, preservesPitch);
      } catch {
        // ignore — fallback below still pushes onto the media element.
      }
    }
    if (!media) return;
    media.playbackRate = rate;
    media.preservesPitch = preservesPitch;
    type VendorPreserves = HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    const vendor = media as VendorPreserves;
    if ('mozPreservesPitch' in vendor) vendor.mozPreservesPitch = preservesPitch;
    if ('webkitPreservesPitch' in vendor) vendor.webkitPreservesPitch = preservesPitch;
  }, [tempoPercent, preservesPitch, currentId]);

  // Audio-element unlock: capture the first user gesture (anywhere on the
  // page) and prime the media element with a muted play+pause inside the
  // gesture's activation window. After this, browser autoplay policy lets
  // ws.play() succeed even when called from an async onReady callback that
  // fires seconds after the click. Without this, the very first track
  // selection in a session — and any track that follows an album-expand
  // (~1-2s lookup eats the gesture) — won't auto-play; the user has to
  // press Space.
  useEffect(() => {
    function unlock() {
      if (audioUnlockedRef.current) return;
      const media = mediaElementRef.current;
      if (!media) return;
      audioUnlockedRef.current = true;
      const prevMuted = media.muted;
      media.muted = true;
      media
        .play()
        .then(() => {
          try {
            media.pause();
          } catch {
            // ignore
          }
          media.muted = prevMuted;
        })
        .catch(() => {
          media.muted = prevMuted;
          // Even if play() rejects (e.g. no src yet), the gesture-based
          // attempt counts towards the activation window in some browsers.
          // Mark unlocked anyway so we don't keep listening forever.
        });
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    }
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, []);


  useEffect(() => {
    requestTokenRef.current += 1;
    setError(null);
    setPosition(0);
    setDuration(0);
    setDecoding(false);
    // Reset decodingRef explicitly: a previous track-change branch may have
    // set it to true and never reached onReady (e.g. /api/album/by-url
    // hung, the user advanced before it resolved). Without this reset
    // the next track's isPlaying-effect skips its ws.play() call thinking
    // a load is still in progress, and the player wedges silently.
    decodingRef.current = false;
    // Drop tempo back to zero on track switch. Carrying +10% from a 95-BPM
    // track into a 130-BPM track is disorienting and rarely what the user
    // meant. The Tempo panel itself stays open so the next adjustment is
    // one click away.
    resetTempo();
    const ws = wsRef.current;
    if (!ws) return;
    if (!current) {
      ws.empty();
      wantsPlayRef.current = false;
      return;
    }

    // Lazy resolve: if the track is a synthetic queue entry (e.g. from a
    // curator collection or best-of-supporters list), import it via lookup
    // first, then swap the queue entry for the real one. The track-change
    // effect re-runs as soon as currentId switches to the resolved id and
    // streams normally.
    // Album-Expand: turn a fat album queue entry into the resolved
    // tracklist via /api/album/by-url, then jump to the first track. The
    // track-change effect re-runs with the resolved track and streams.
    if (current.albumExpand) {
      decodingRef.current = true;
      ws.empty();
      setDecoding(true);
      const token = requestTokenRef.current;
      void (async () => {
        try {
          // Timeout the album fetch — Bandcamp rate-limit stalls have
          // blocked this call indefinitely and wedged the player. After
          // 10s, abort and let scheduleAutoSkip jump to the next item.
          const ac = new AbortController();
          const timer = window.setTimeout(() => ac.abort(), 10_000);
          const res = await fetch(
            `/api/album/by-url?url=${encodeURIComponent(current.bcUrl)}`,
            { signal: ac.signal },
          );
          window.clearTimeout(timer);
          if (token !== requestTokenRef.current) return;
          const json = (await res.json()) as {
            ok?: boolean;
            tracks?: Array<{
              trackId: number;
              bcTrackId: number;
              title: string;
              artistName: string | null;
              durationSeconds: number | null;
              trackNumber: number | null;
              bcUrl: string;
              hasStream: boolean;
              coverUrl: string | null;
              hasBeenPlayed: boolean;
            }>;
            releaseBcId?: number;
            error?: string;
          };
          if (!res.ok || !json.ok || !json.tracks || json.tracks.length === 0) {
            decodingRef.current = false;
            setError(json.error ?? 'Could not load album tracks');
            setDecoding(false);
            scheduleAutoSkip(token);
            return;
          }
          const albumTracks: TrackRowData[] = json.tracks.map((t) => ({
            id: t.trackId,
            title: t.title,
            artistName: t.artistName,
            albumTitle: current.title,
            durationSeconds: t.durationSeconds,
            trackNumber: t.trackNumber,
            coverUrl: t.coverUrl ?? current.coverUrl,
            bcUrl: t.bcUrl,
            hasStream: t.hasStream,
            bcTrackId: t.bcTrackId,
            hasBeenPlayed: t.hasBeenPlayed,
            parentBcAlbumId: json.releaseBcId ?? null,
            source: 'owned' as const,
          }));
          expandAlbum(current.id, albumTracks);
        } catch (err) {
          if (token !== requestTokenRef.current) return;
          decodingRef.current = false;
          setError(err instanceof Error ? err.message : 'Album load failed');
          setDecoding(false);
          scheduleAutoSkip(token);
        }
      })();
      return;
    }

    // Lazy resolve when either the row is explicitly marked or it just
    // doesn't have a stream URL yet. Marco's invariant: every row with a
    // bcUrl must reach the audio path. The auto-trigger covers all the
    // pages that build TrackRowData straight from the DB without the
    // explicit needsResolve flag (Library, Artist, Label, History, …).
    if (current.needsResolve || (!current.hasStream && !!current.bcUrl)) {
      // Stop any audio still playing from the previous track. Without this
      // the old stream keeps playing during the 1-2s lookup and we get an
      // audible click when the new src loads.
      decodingRef.current = true;
      ws.empty();
      setDecoding(true);
      const token = requestTokenRef.current;
      void (async () => {
        try {
          // Prefer the bcUrl: it always works via fetchReleasePage. Numeric
          // track-ids go through Bandcamp's mobile tralbum_details endpoint
          // which silently 404s for some tracks (e.g. older or region-quirky
          // ones). bcUrl is the direct path to the release page.
          const ac = new AbortController();
          const timer = window.setTimeout(() => ac.abort(), 10_000);
          const res = await fetch('/api/track/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input:
                current.bcUrl && current.bcUrl.length > 0
                  ? current.bcUrl
                  : String(current.bcTrackId ?? ''),
            }),
            signal: ac.signal,
          });
          window.clearTimeout(timer);
          if (token !== requestTokenRef.current) return;
          const json = (await res.json()) as {
            ok?: boolean;
            result?: { trackId: number; bcTrackId: number };
            error?: string;
          };
          if (!res.ok || !json.ok || !json.result) {
            decodingRef.current = false;
            setError(json.error ?? 'Lookup failed');
            setDecoding(false);
            scheduleAutoSkip(token);
            return;
          }
          replaceTrack(current.id, {
            ...current,
            id: json.result.trackId,
            bcTrackId: json.result.bcTrackId,
            hasStream: true,
            needsResolve: false,
          });
        } catch (err) {
          if (token !== requestTokenRef.current) return;
          decodingRef.current = false;
          setError(err instanceof Error ? err.message : 'Lookup failed');
          setDecoding(false);
          scheduleAutoSkip(token);
        }
      })();
      return;
    }

    const src =
      current.source === 'discovered'
        ? `/api/audio/stream?id=${current.id}&source=discovered`
        : `/api/audio/stream?id=${current.id}`;
    decodingRef.current = true;
    setDecoding(true);
    const token = requestTokenRef.current;
    if (prefs.progressivePlayback) {
      void loadProgressive(ws, src, current, token);
    } else {
      loadClassic(ws, src, token);
    }
    // Soft watchdog: if onReady doesn't fire within 30s, surface a
    // warning so the user knows the track is stalling on BC's side.
    // We do NOT auto-skip — Marco's observation was that the track does
    // eventually arrive 30-60s later and starts playing, so silently
    // moving on costs the user a track they wanted. They can hit D
    // manually if it's too slow. Once `ready` does fire, onReady clears
    // the message; if the user advances first the token check skips this.
    window.setTimeout(() => {
      if (token !== requestTokenRef.current) return;
      if (!decodingRef.current) return;
      setError('Loading takes longer than usual — press D to skip');
    }, 30_000);
  }, [current, replaceTrack, expandAlbum, advance, prefs.progressivePlayback]);

  // Schedule a single auto-skip for the given track-load token. Idempotent
  // per token (multiple error sources for the same load only advance once)
  // and bails out if the user has already navigated past the broken track.
  function scheduleAutoSkip(token: number) {
    if (lastSkippedTokenRef.current === token) return;
    lastSkippedTokenRef.current = token;
    window.setTimeout(() => {
      if (token !== requestTokenRef.current) return;
      if (wsRef.current && !wsRef.current.isPlaying()) advance();
    }, 1500);
  }

  // Shared load-failure handling: mark the load done, surface the raw error,
  // upgrade it with an HTTP-status-tuned message, and schedule one auto-skip.
  // Used by both the classic and progressive load paths.
  function handleLoadFailure(err: unknown, token: number) {
    if (token !== requestTokenRef.current) return;
    decodingRef.current = false;
    setError(err instanceof Error ? err.message : 'load failed');
    setDecoding(false);
    void diagnoseStreamForCurrent().then((msg) => {
      if (token !== requestTokenRef.current) return;
      if (msg) setError(msg);
    });
    scheduleAutoSkip(token);
  }

  // Classic path: WaveSurfer fetches the whole MP3 as a blob before the audio
  // element gets a source, then decodes for the waveform. Correct but blocking
  // — under CDN throttling this is the 20-50s stall. Kept as the off-switch
  // fallback (prefs.progressivePlayback === false) and as the range/seek path.
  function loadClassic(ws: WaveSurfer, src: string, token: number) {
    ws.load(src).catch((err: unknown) => handleLoadFailure(err, token));
  }

  // Progressive path: hand WaveSurfer pre-computed peaks so it skips its
  // blocking full-file fetch and sets media.src directly — the <audio> element
  // then streams the progressive route and starts in ~1-2s. Cached peaks give
  // the real waveform immediately; a never-heard track gets a placeholder and
  // its real peaks are decoded + cached in the background (backfillPeaks).
  async function loadProgressive(
    ws: WaveSurfer,
    src: string,
    track: TrackRowData,
    token: number,
  ) {
    let channelData: number[][] | null = null;
    let peakDuration =
      track.durationSeconds != null && track.durationSeconds > 0
        ? track.durationSeconds
        : undefined;
    try {
      const res = await fetch(peaksUrlFor(track));
      if (res.ok) {
        const json = (await res.json()) as {
          ok?: boolean;
          peaks?: number[][];
          duration?: number;
        };
        if (json.ok && Array.isArray(json.peaks) && json.peaks.length > 0) {
          channelData = json.peaks;
          if (typeof json.duration === 'number' && json.duration > 0) {
            peakDuration = json.duration;
          }
        }
      }
    } catch {
      // No cached peaks reachable — fall through to the placeholder.
    }
    if (token !== requestTokenRef.current) return;

    const usingPlaceholder = channelData == null;
    try {
      await ws.load(src, channelData ?? PLACEHOLDER_PEAKS, peakDuration);
    } catch (err) {
      // A genuine media error (e.g. 502) routes through ws.on('error') which
      // already surfaces the message + auto-skip; only handle a load() that
      // rejects outright here.
      handleLoadFailure(err, token);
      return;
    }
    if (usingPlaceholder && token === requestTokenRef.current) {
      void backfillPeaks(ws, src, track, token);
    }
  }

  // Background: fetch the now-caching file (single-flight on the server means
  // this reads from disk / awaits the in-flight download — no second Bandcamp
  // connection), decode it locally for real peaks, cache them for next time,
  // and swap the placeholder waveform for the real one without disrupting
  // playback. All best-effort: any failure just leaves the placeholder.
  async function backfillPeaks(
    ws: WaveSurfer,
    src: string,
    track: TrackRowData,
    token: number,
  ) {
    try {
      const res = await fetch(src);
      if (!res.ok || token !== requestTokenRef.current) return;
      const arrayBuf = await res.arrayBuffer();
      if (token !== requestTokenRef.current) return;
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(arrayBuf);
      } finally {
        void ctx.close();
      }
      if (token !== requestTokenRef.current) return;
      const peaks = extractPeaks(decoded, 2000);
      const duration = decoded.duration;
      void fetch(peaksUrlFor(track), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: track.id, source: track.source, peaks, duration }),
      });
      if (token !== requestTokenRef.current) return;
      try {
        // Load with the media element's CURRENT absolute src so WaveSurfer's
        // setSrc sees url === current src and skips the reload — it only
        // re-renders the waveform from the peaks, leaving playback untouched.
        const media = ws.getMediaElement();
        const currentSrc = media.currentSrc || media.src;
        if (currentSrc) await ws.load(currentSrc, peaks, duration);
      } catch {
        // Live waveform refresh is best-effort; placeholder stays otherwise.
      }
    } catch {
      // Backfill is best-effort; a failure just means no cached peaks yet.
    }
  }

  // Probe the audio endpoint with a Range request so the server has a
  // chance to surface a meaningful HTTP status (502 when Bandcamp doesn't
  // hand us a stream URL, 404 when we don't have the track row, 401/403
  // when cookies have expired). Returns a friendly message tuned to the
  // status, or null if everything looks fine (in which case the original
  // ws error message stays).
  async function diagnoseStreamForCurrent(): Promise<string | null> {
    const cur = current;
    if (!cur || cur.id < 0) return null;
    const src =
      cur.source === 'discovered'
        ? `/api/audio/stream?id=${cur.id}&source=discovered`
        : `/api/audio/stream?id=${cur.id}`;
    try {
      const res = await fetch(src, { headers: { Range: 'bytes=0-0' } });
      if (res.status === 502) {
        return 'Track currently unavailable on Bandcamp.';
      }
      if (res.status === 404) {
        return 'Track not found.';
      }
      if (res.status === 401 || res.status === 403) {
        return 'Bandcamp cookies expired — open Setup and paste fresh ones.';
      }
      if (res.status >= 500) {
        return `Stream error ${res.status}.`;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Pre-resolve the next two lazy queue entries in the background so that
  // when the user advances with A/D (or auto-advance after finish) the next
  // track is already imported and plays without a 1-2s lookup stall.
  useEffect(() => {
    if (currentId == null) return;
    // Read the queue fresh via getState instead of depending on it (see the
    // dependency-array note below). Depending on `queue` re-fires this effect
    // after every resolve — and since each resolve calls replaceTrack (which
    // mutates the queue), a single Play on a large curator collection cascaded
    // through the ENTIRE queue: hundreds of concurrent /api/track/lookup calls
    // that saturate Bandcamp's rate limiter and never settle (the "lookup
    // flood" bug). We only want to prefetch when the user moves to a new track.
    const queue = usePlayerStore.getState().queue;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    const candidates: TrackRowData[] = [];
    for (let i = idx + 1; i < queue.length && candidates.length < 2; i += 1) {
      const item = queue[i];
      if (item.needsResolve && !prefetchInFlightRef.current.has(item.id)) {
        candidates.push(item);
      }
    }
    if (candidates.length === 0) return;
    candidates.forEach((c) => prefetchInFlightRef.current.add(c.id));
    void (async () => {
      for (const item of candidates) {
        try {
          const res = await fetch('/api/track/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input:
                item.bcUrl && item.bcUrl.length > 0
                  ? item.bcUrl
                  : String(item.bcTrackId ?? ''),
            }),
          });
          if (!res.ok) continue;
          const json = (await res.json()) as {
            ok?: boolean;
            result?: { trackId: number; bcTrackId: number };
          };
          if (!json.ok || !json.result) continue;
          replaceTrack(item.id, {
            ...item,
            id: json.result.trackId,
            bcTrackId: json.result.bcTrackId,
            hasStream: true,
            needsResolve: false,
          });
        } catch {
          // Background prefetch is best-effort; on failure the lazy resolve
          // path in the track-change effect will run when the user reaches
          // this entry.
        } finally {
          prefetchInFlightRef.current.delete(item.id);
        }
      }
    })();
    // Intentionally depend on currentId only, NOT `queue`. See the note at the
    // top of the effect: a `queue` dep turns each resolve into a fresh prefetch
    // pass and cascades through the whole queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, replaceTrack]);

  // Audio prefetch removed: the new /api/audio/stream handler waits for
  // the full mp3 to land on disk before responding (one BC connection
  // instead of two). Prefetching the next 2 tracks via tiny Range-fetches
  // would now spawn 2 simultaneous full-file downloads per track-change,
  // which on EP playback (rapid advance through 4-6 tracks) saturates the
  // server and stalls the active player. First-play latency is ~2-5s per
  // track now; subsequent plays are still instant from disk cache.

  useEffect(() => {
    const ws = wsRef.current;
    wantsPlayRef.current = isPlaying;
    if (!ws || !current) return;
    // Don't fire ws.play() while a load is still running — the racing
    // play() call abort-errors and flips isPlaying back to false. onReady
    // will pick this up via wantsPlayRef and start playback once decoding
    // finishes.
    if (decodingRef.current) return;
    if (isPlaying && !ws.isPlaying()) {
      const token = requestTokenRef.current;
      ws.play().catch((err: unknown) => {
        if (token !== requestTokenRef.current) return;
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    } else if (!isPlaying && ws.isPlaying()) {
      ws.pause();
    }
  }, [isPlaying, current]);

  useEffect(() => {
    if (!current) return;
    const trackId = current.id;
    const bcTrackId = current.bcTrackId;
    let didFire = false;
    return () => {
      if (didFire) return;
      didFire = true;
      const ws = wsRef.current;
      if (!ws) return;
      const cur = ws.getCurrentTime();
      const total = ws.getDuration();
      let pct: number | null = null;
      if (Number.isFinite(total) && total > 0) {
        pct = Math.min(1, Math.max(0, cur / total));
      }
      // Owner's intent: any track played for at least one second counts as
      // heard. The 1s floor still filters out drive-by clicks where a user
      // immediately skips before audio decoding completes.
      if (cur >= 1) {
        // Mark in the live store so the green checkmark lights up everywhere
        // (best-of, curator, wishlist) without a page reload.
        if (bcTrackId != null && bcTrackId > 0) markPlayed(bcTrackId);
        const isDiscovered = current.source === 'discovered';
        // For owned tracks: trackId is a real tracks.id and we can write
        // directly. For discovered tracks: send bcTrackId+bcUrl so the
        // server can resolve to a tracks.id (importing the release if it
        // wasn't in the local DB yet). Without this, plays of discovered
        // tracks were never persisted and the green check disappeared
        // after every reload.
        const body = isDiscovered
          ? {
              bcTrackId,
              bcUrl: current.bcUrl,
              completedPct: pct,
              source: 'player',
            }
          : { trackId, completedPct: pct, source: 'player' };
        void fetch('/api/plays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
    };
  }, [current, markPlayed]);

  const elapsed = formatTime(position);
  const remaining = formatTime(Math.max(0, duration - position), '-');
  const totalLabel = formatTime(duration);
  const rightLabel = current ? (prefs.timeDisplay === 'remaining' ? remaining : totalLabel) : '0:00';

  // Player container is always rendered so the WaveSurfer host element keeps
  // the same DOM identity across track changes — that prevents the canvas
  // from being orphaned when going from "no current" to "playing" and avoids
  // the runaway full-width waveform we hit with the old conditional return.
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-bg-elevated/95 shadow-[0_-8px_30px_rgba(0,0,0,0.4)] backdrop-blur transition-transform duration-200 ease-out ${
        current ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-hidden={!current}
    >
      {tempoOpen && current && (
        <TempoControls current={current} bpm={bpm} onClose={() => setTempoOpen(false)} />
      )}
      {/* Beatport-style layout (left → right):
            [cover + title/artist/album block]
            [time block: elapsed / total]
            [waveform — fills remaining width]
            [right action cluster: BC + transport]
          The play button stays primary (accent fill) and lives on the
          right edge so the user's hand is never far from it.            */}
      <div className="relative mx-auto flex w-full max-w-7xl items-center gap-4 overflow-hidden px-4 py-2">
        {/* Track-info block. Cover + 3-line metadata. max-width caps the
            block so the waveform gets adequate center-lane space; min-w-0
            keeps the title from forcing horizontal scroll on narrow viewports. */}
        <div className="flex min-w-0 flex-none items-center gap-3 sm:max-w-[260px]" style={{ flexBasis: 'min(260px, 35%)' }}>
          {current?.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.coverUrl}
              alt=""
              className="h-14 w-14 flex-none rounded object-cover"
            />
          ) : (
            <div className="h-14 w-14 flex-none rounded bg-bg-base" />
          )}
          <div className="min-w-0">
            {current && current.bcTrackId ? (
              <a
                href={`/track/${current.bcTrackId}`}
                className="block truncate text-sm font-semibold leading-tight hover:underline"
                title="Open track page (middle-click for new tab)"
              >
                {current.title}
              </a>
            ) : (
              <div className="truncate text-sm font-semibold leading-tight">
                {current?.title ?? ''}
              </div>
            )}
            {current?.artistName && current.bcUrl ? (
              <a
                href={`/artist/go?url=${encodeURIComponent(current.bcUrl)}`}
                className="block truncate text-xs leading-tight text-fg-secondary hover:text-accent hover:underline"
                title="Open artist page (middle-click for new tab)"
              >
                {current.artistName}
              </a>
            ) : (
              <div className="truncate text-xs text-fg-secondary leading-tight">
                {current?.artistName ?? ''}
              </div>
            )}
            {current?.albumTitle && current.bcUrl ? (
              <a
                href={`/track/go?url=${encodeURIComponent(current.bcUrl)}`}
                className="block truncate text-[11px] leading-tight text-fg-muted hover:text-accent hover:underline"
                title="Open release page (middle-click for new tab)"
              >
                {current.albumTitle}
              </a>
            ) : (
              current?.albumTitle && (
                <div className="truncate text-[11px] text-fg-muted leading-tight">
                  {current.albumTitle}
                </div>
              )
            )}
            {error && <div className="truncate text-xs text-fg-danger">{error}</div>}
            {decoding && !error && (
              <div className="truncate text-xs text-fg-muted">Decoding…</div>
            )}
          </div>
        </div>

        {/* Time block: elapsed on top, total/remaining toggle in the
            middle, BPM at the bottom (when known). Tabular-nums keeps the
            digits from jumping as the number ticks. */}
        <div className="flex flex-none flex-col items-end font-mono text-xs tabular-nums leading-tight" style={{ width: 64 }}>
          <span className="text-fg-primary" title="Elapsed">
            {current ? elapsed : '0:00'}
          </span>
          <Tooltip
            text={
              prefs.timeDisplay === 'elapsed'
                ? 'Total length — click to switch to remaining'
                : 'Remaining — click to switch to total length'
            }
            position="top"
          >
            <button
              type="button"
              onClick={() =>
                savePreferencesToggle(prefs.timeDisplay === 'elapsed' ? 'remaining' : 'elapsed')
              }
              className="rounded text-fg-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-fg-primary focus-visible:text-fg-primary"
              aria-label={
                prefs.timeDisplay === 'elapsed'
                  ? 'Switch to remaining time'
                  : 'Switch to total length'
              }
            >
              {rightLabel}
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => current && setTempoOpen((v) => !v)}
            disabled={!current}
            className={`rounded text-left transition-colors disabled:opacity-40 ${
              tempoOpen
                ? 'text-accent'
                : bpm != null
                  ? 'text-accent hover:text-accent-hover'
                  : 'text-fg-muted hover:text-fg-secondary'
            }`}
            title={
              tempoOpen
                ? 'Close tempo controls'
                : bpm != null
                  ? `BPM ${bpm.toFixed(1)} — click to open tempo controls`
                  : 'Open tempo controls (BPM unknown)'
            }
          >
            {bpm != null ? (
              <span
                // Key change forces a remount when the rounded BPM
                // updates (e.g. after detection finishes), so the new
                // number rolls in instead of swapping silently. When the
                // user pulls the tempo slider, the displayed BPM follows
                // the effective rate (source × (1 + tempoPercent/100))
                // so they see exactly where they're landing.
                key={`bpm-${Math.round(bpm * (1 + tempoPercent / 100))}`}
                className="inline-block anim-roll-in"
                title={
                  tempoPercent === 0
                    ? `${bpm.toFixed(1)} BPM`
                    : `${bpm.toFixed(1)} BPM × ${tempoPercent > 0 ? '+' : ''}${tempoPercent.toFixed(1)}%`
                }
              >
                {Math.round(bpm * (1 + tempoPercent / 100))} BPM
                {tempoPercent !== 0 && (
                  <span className="ml-0.5 text-fg-warning">
                    {tempoPercent > 0 ? '↑' : '↓'}
                  </span>
                )}
              </span>
            ) : (
              <span className="underline decoration-dotted underline-offset-2">Tempo ▾</span>
            )}
          </button>
        </div>

        {/* Waveform fills all remaining horizontal space. h-12 gives enough
            vertical room to show the bar pattern clearly. min-width keeps
            WaveSurfer's ResizeObserver from getting a zero/sub-pixel width
            during the translate-y show/hide transition — that path divides
            by canvas width and throws "Invalid array length" if it ever
            measures 0. */}
        <div className="relative h-12 flex-1 overflow-hidden" style={{ minWidth: 120 }}>
          <div
            ref={waveformRef}
            className="absolute inset-0 overflow-hidden"
            style={{ contain: 'layout size paint' }}
          />
        </div>

        {/* Right action cluster: wishlist heart + external link + transport
            controls. The play button is the largest, accent-filled, with
            skip prev/next flanking it for one-handed reach. */}
        <div className="flex flex-none items-center gap-2 text-fg-secondary">
          {current && current.bcTrackId != null && (
            <WishlistButton
              bcTrackId={current.bcTrackId}
              bcUrl={current.bcUrl}
              title={current.title}
              artistName={current.artistName}
              albumTitle={current.albumTitle}
              coverUrl={current.coverUrl}
            />
          )}
          {current && (
            <LazyAddToPlaylistButton
              trackId={
                current.id > 0 && current.source !== 'discovered'
                  ? current.id
                  : null
              }
              bcTrackId={current.bcTrackId}
              bcUrl={current.bcUrl}
            />
          )}
          <Tooltip text="Cue to track start" position="top">
            <button
              type="button"
              onClick={() => {
                // Pioneer-style CUE: jump to track start and pause.
                // We seek the underlying <audio> element directly;
                // WaveSurfer (if mounted) follows via its `audioprocess`
                // listener so the waveform cursor returns to 0 too.
                const el = mediaElementRef.current;
                if (el) {
                  try {
                    el.currentTime = 0;
                  } catch {
                    // Safari throws if no source loaded yet — ignore.
                  }
                }
                setIsPlaying(false);
              }}
              disabled={!current}
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-amber-500 text-[10px] font-bold tracking-wide text-amber-500 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
              aria-label="Cue to track start"
            >
              CUE
            </button>
          </Tooltip>
          <Tooltip text="Previous track (A)" position="top">
            <button
              type="button"
              onClick={prev}
              disabled={!current}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-bg-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
              aria-label="Previous track"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text={isPlaying ? 'Pause (Space)' : 'Play (Space)'} position="top">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!current}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-fg-on-accent shadow-lg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated disabled:opacity-50"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          </Tooltip>
          <Tooltip text="Next track (D)" position="top">
            <button
              type="button"
              onClick={advance}
              disabled={!current}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-bg-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
              aria-label="Next track"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function savePreferencesToggle(next: 'elapsed' | 'remaining') {
  if (typeof window === 'undefined') return;
  const cur = (() => {
    try {
      const raw = window.localStorage.getItem('unfck.prefs.v1');
      if (!raw) return { timeDisplay: 'elapsed' as const };
      return JSON.parse(raw) as { timeDisplay?: string };
    } catch {
      return { timeDisplay: 'elapsed' as const };
    }
  })();
  const merged = { ...cur, timeDisplay: next };
  window.localStorage.setItem('unfck.prefs.v1', JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent('unfck:prefs-changed'));
}
