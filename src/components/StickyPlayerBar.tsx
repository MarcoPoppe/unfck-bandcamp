'use client';

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { usePlayerStore } from '@/lib/store/player';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Sticky bottom-of-screen player. Native HTMLAudioElement is the source of
 * truth (reliable cross-browser, deterministic event timing). Wavesurfer is
 * mounted with `media: <audio>` so it reflects the audio's state without
 * owning playback.
 *
 * Single-owner playback discipline:
 *   - Track-change effect: only sets src + ws.load(...). Does NOT call play().
 *   - isPlaying-change effect: SOLE owner of play()/pause() transitions.
 *   - A request-token guard prevents stale `play()` rejections from a previous
 *     track from forcing the store back into "paused" after the user has
 *     already skipped.
 */
export default function StickyPlayerBar() {
  const queue = usePlayerStore((s) => s.queue);
  const currentId = usePlayerStore((s) => s.currentId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const advance = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const requestTokenRef = useRef(0);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue.find((t) => t.id === currentId) ?? null;

  // Mount wavesurfer once and bind to native audio.
  useEffect(() => {
    const audio = audioRef.current;
    const container = waveformRef.current;
    if (!audio || !container) return;

    const ws = WaveSurfer.create({
      container,
      waveColor: '#3a3a44',
      progressColor: '#7c5cff',
      cursorColor: '#7c5cff',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 36,
      normalize: true,
      media: audio,
    });
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);

  // Track-change: bump request token, swap src, kick off peak decode.
  // No play() here — the isPlaying effect below owns that decision.
  useEffect(() => {
    requestTokenRef.current += 1;
    setError(null);
    setPosition(0);
    setDuration(0);
    const audio = audioRef.current;
    if (!audio) return;
    if (!current) {
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    const src = `/api/audio/stream?id=${current.id}`;
    audio.src = src;
    audio.load();
    if (wsRef.current) {
      // fire-and-forget peak decode; aborts on next track replace
      wsRef.current.load(src).catch(() => {});
    }
  }, [current]);

  // Single-owner playback transitions. A stale rejection from a play() that
  // was superseded by a track skip is filtered via requestTokenRef.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current) return;
    if (isPlaying) {
      if (!audio.paused) return;
      const token = requestTokenRef.current;
      audio.play().catch((err: unknown) => {
        if (token !== requestTokenRef.current) return; // superseded; ignore
        setError(err instanceof Error ? err.message : 'play failed');
        setIsPlaying(false);
      });
    } else {
      if (!audio.paused) audio.pause();
    }
  }, [isPlaying, current, setIsPlaying]);

  // Mirror native audio events into the store + UI.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
    };
  }, [setIsPlaying]);

  // Record a play into track_plays once per track-load. We record at track-end
  // (via onEnded -> advance) and at track-change (so partial listens get
  // captured too). The completed_pct stays accurate because we read from
  // the audio element at the moment of the change.
  useEffect(() => {
    if (!current) return;
    const audio = audioRef.current;
    const trackId = current.id;
    // didFire guard prevents React Strict-mode double-invocation in dev from
    // emitting two POST /api/plays for the same track-load (Codex pass-1
    // finding 9). Production has single mount, so the guard is a no-op there.
    let didFire = false;
    return () => {
      if (didFire) return;
      didFire = true;
      let pct: number | null = null;
      let durationSec = 0;
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
        pct = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
        durationSec = audio.duration;
      }
      // Threshold: at least 5 seconds OR 10 % of the track played, whichever
      // is smaller (Codex pass-1 finding 6 — the previous 1s threshold did
      // not match the "gehoert ab 50 %" copy on /history). This still
      // captures partial listens but skips drive-by clicks.
      const minPlayedSec = audio
        ? Math.min(5, Math.max(1, durationSec * 0.1))
        : 5;
      if (audio && audio.currentTime >= minPlayedSec) {
        void fetch('/api/plays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId, completedPct: pct, source: 'player' }),
        }).catch(() => {});
      }
    };
  }, [current]);

  if (!current) {
    return (
      <>
        <audio ref={audioRef} className="hidden" />
        <div ref={waveformRef} className="hidden" />
      </>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-bg-elevated/95 backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[260px_minmax(0,1fr)_140px] items-center gap-4 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          {current.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.coverUrl}
              alt=""
              className="h-12 w-12 flex-none rounded object-cover"
            />
          ) : (
            <div className="h-12 w-12 flex-none rounded bg-bg-base" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{current.title}</div>
            <div className="truncate text-xs text-fg-secondary">
              {current.artistName ?? 'unknown artist'}
            </div>
            {error && <div className="truncate text-xs text-red-400">{error}</div>}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-fg-secondary">
              <button
                type="button"
                onClick={prev}
                className="h-8 w-8 rounded-full transition-colors hover:bg-bg-hover hover:text-fg-primary"
                aria-label="previous track (A)"
                title="A"
              >
                ◀◀
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="h-9 w-9 rounded-full bg-accent text-fg-primary transition-colors hover:bg-accent-hover"
                aria-label={isPlaying ? 'pause (Space)' : 'play (Space)'}
                title="Space"
              >
                {isPlaying ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                onClick={advance}
                className="h-8 w-8 rounded-full transition-colors hover:bg-bg-hover hover:text-fg-primary"
                aria-label="next track (D)"
                title="D"
              >
                ▶▶
              </button>
            </div>
            <div ref={waveformRef} className="h-9 flex-1" />
          </div>
          <div className="flex items-center justify-between font-mono text-xs text-fg-muted">
            <span>{formatTime(position)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 text-xs text-fg-muted">
          <a
            href={current.bcUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-border bg-bg-base px-2 py-1 transition-colors hover:border-accent hover:text-accent"
            title="open on bandcamp.com"
          >
            ↗ BC
          </a>
        </div>
      </div>
      <audio ref={audioRef} onEnded={advance} className="hidden" preload="auto" />
    </div>
  );
}
