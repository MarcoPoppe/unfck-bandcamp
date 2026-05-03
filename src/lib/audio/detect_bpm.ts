'use client';

import { analyzeFullBuffer } from 'realtime-bpm-analyzer';

interface DetectArgs {
  /** Local trackId — preferred path. */
  trackId?: number;
  /** Fallback for discovered tracks: the server side resolves bcUrl
   * → tracks.id (importing the release if needed) before persisting. */
  bcTrackId?: number;
  bcUrl?: string;
  /** Aborts the in-flight stream fetch and POST. The decode + analyze
   * steps don't accept a signal, so worst case we burn ~1-2s of CPU
   * after a cancel before bailing on the POST. */
  signal?: AbortSignal;
}

interface DetectResult {
  bpm: number;
  /** Detector's own confidence count for the winning candidate; useful
   * for debugging but not surfaced in the UI. */
  count: number;
}

/**
 * Detect BPM offline.
 *
 * Mirrors the technique used by the "Bandcamp Tempo Adjust" Chrome
 * extension: fetch the stream into an ArrayBuffer, decode it with a
 * one-shot AudioContext, then run the buffer through the analyzer.
 *
 * The reason we avoid the realtime path: `createMediaElementSource` can
 * only be called once per HTMLMediaElement, so attaching the analyzer
 * to our live `<audio>` element broke playback on the second track.
 * Decoding into an isolated buffer sidesteps that constraint.
 */
export async function detectBpmForTrack(args: DetectArgs): Promise<DetectResult> {
  const id = args.trackId;
  if (!id) throw new Error('detectBpmForTrack needs a local trackId');

  // Same audio endpoint the player streams from. The server persists the
  // raw bytes in its LRU disk cache, so a follow-up playback won't hit
  // Bandcamp twice.
  const res = await fetch(`/api/audio/stream?id=${id}`, {
    cache: 'force-cache',
    signal: args.signal,
  });
  if (!res.ok) {
    throw new Error(`stream fetch failed: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (args.signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // One-shot AudioContext just for decoding. We never connect it to
  // anything that produces sound; the destination is unused.
  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close().catch(() => {});
  }

  const tempos = await analyzeFullBuffer(audioBuffer);
  if (!tempos || tempos.length === 0) {
    throw new Error('no BPM candidate found');
  }
  const winner = tempos[0];
  // The analyzer occasionally locks onto a half- or double-time grid for
  // genres with strong off-beats. The musical range we care about is
  // 60..180 — anything outside likely needs a *2 or /2 fold.
  let bpm = winner.tempo;
  if (bpm < 60 && bpm * 2 <= 220) bpm = bpm * 2;
  else if (bpm > 200 && bpm / 2 >= 60) bpm = bpm / 2;

  if (args.signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // Persist server-side so the value survives reloads. Caller uses the
  // returned bpm for live UI; the POST is fire-and-forget but we await
  // it so a failed write surfaces back to the user.
  await fetch('/api/track/bpm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trackId: args.trackId,
      bcTrackId: args.bcTrackId,
      bcUrl: args.bcUrl,
      bpm,
    }),
    signal: args.signal,
  });

  return { bpm, count: winner.count };
}
