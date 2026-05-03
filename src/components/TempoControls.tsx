'use client';

import { useState } from 'react';
import { usePlayerStore } from '@/lib/store/player';
import { detectBpmForTrack } from '@/lib/audio/detect_bpm';
import type { TrackRowData } from './TrackRow';

interface Props {
  current: TrackRowData;
  /** Live BPM if known (server value or already-detected during this session). */
  bpm: number | null;
  /** Close handler for the parent collapsible wrapper. */
  onClose: () => void;
}

/**
 * Tempo and BPM controls inspired by the "Bandcamp Tempo Adjust" Chrome
 * extension: a slider with range presets, a master-tempo (preserve-pitch)
 * toggle, a reset, and a one-shot BPM detector.
 *
 * Lives in the StickyPlayerBar as a collapsible row that opens above the
 * main player block. Tempo state lives in the player store so changes
 * survive collapse/expand and are picked up by the audio-element effect.
 */
export default function TempoControls({ current, bpm, onClose }: Props) {
  const tempoPercent = usePlayerStore((s) => s.tempoPercent);
  const preservesPitch = usePlayerStore((s) => s.preservesPitch);
  const setTempoPercent = usePlayerStore((s) => s.setTempoPercent);
  const setPreservesPitch = usePlayerStore((s) => s.setPreservesPitch);
  const resetTempo = usePlayerStore((s) => s.resetTempo);
  const setBpmFor = usePlayerStore((s) => s.setBpmFor);

  // Slider range presets, mirroring the extension. WIDE = ±50 lets the
  // user pull a track far enough for genre-bending mashups without
  // jumping to a separate "wide" mode like the extension does.
  const [range, setRange] = useState<6 | 10 | 16 | 50>(10);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  // Clamp the live tempo into the active range when the user picks a
  // smaller preset. Without this, switching from ±50 down to ±6 would
  // leave the slider thumb off-screen at +30.
  function pickRange(next: 6 | 10 | 16 | 50) {
    setRange(next);
    if (Math.abs(tempoPercent) > next) {
      setTempoPercent(tempoPercent > 0 ? next : -next);
    }
  }

  async function detect() {
    if (!current.id || current.id < 0) {
      // Synthetic / lazy queue entry: the local trackId we'd send to
      // /api/track/bpm doesn't exist yet. The player resolves these on
      // first play; ask the user to start playback once before detecting.
      setDetectError('Track not imported yet. Play it once, then re-detect.');
      return;
    }
    setDetecting(true);
    setDetectError(null);
    try {
      const { bpm: detected } = await detectBpmForTrack({
        trackId: current.id,
        bcTrackId: current.bcTrackId,
        bcUrl: current.bcUrl,
      });
      if (current.bcTrackId) setBpmFor(current.bcTrackId, detected);
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'detection failed');
    } finally {
      setDetecting(false);
    }
  }

  const sliderId = 'tempo-slider';
  const display =
    tempoPercent === 0
      ? '+0.0%'
      : `${tempoPercent > 0 ? '+' : ''}${tempoPercent.toFixed(1)}%`;

  return (
    <div className="border-b border-border bg-bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        {/* BPM block: shows the value when known plus a Detect button.
            On click the button fetches the stream, decodes offline, and
            persists the winning tempo. */}
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-fg-muted">BPM</span>
          <span
            // Roll-in when the value updates (e.g. detect finished). Key
            // remount on the rounded value gives us "—" → "176" with one
            // smooth slide instead of a flash swap.
            key={`bpm-${bpm != null ? Math.round(bpm) : 'none'}`}
            className="inline-block font-mono text-base tabular-nums text-fg-primary anim-roll-in"
          >
            {bpm != null ? Math.round(bpm) : '—'}
          </span>
          <button
            type="button"
            onClick={detect}
            disabled={detecting}
            className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover hover:text-fg-primary disabled:opacity-50"
            title="Fetch stream, decode offline, estimate tempo"
          >
            {detecting ? 'Analyzing…' : bpm != null ? 'Re-detect' : 'Detect BPM'}
          </button>
          {detectError && (
            <span className="text-xs text-fg-danger" title={detectError}>
              {detectError.length > 40 ? detectError.slice(0, 40) + '…' : detectError}
            </span>
          )}
        </div>

        {/* Slider + live percent label + effective BPM readout. flex-1
            so the slider eats all remaining horizontal space. The
            effective BPM only shows when we know the source tempo —
            otherwise the percent is the only honest signal. */}
        <div className="flex flex-1 items-center gap-3 min-w-[280px]">
          <label htmlFor={sliderId} className="text-xs uppercase tracking-wide text-fg-muted">
            Tempo
          </label>
          <input
            id={sliderId}
            type="range"
            min={-range}
            max={range}
            step={0.1}
            value={tempoPercent}
            onChange={(e) => setTempoPercent(parseFloat(e.target.value))}
            className="flex-1 accent-accent"
          />
          <div className="flex w-32 flex-none flex-col items-end font-mono text-xs leading-tight tabular-nums">
            <span className="text-fg-primary">{display}</span>
            {bpm != null && (
              <span
                className={
                  tempoPercent === 0 ? 'text-fg-muted' : 'text-accent'
                }
                title={`${bpm.toFixed(1)} BPM at ${display}`}
              >
                {(bpm * (1 + tempoPercent / 100)).toFixed(1)} BPM
              </span>
            )}
          </div>
        </div>

        {/* Range presets. The selected one fills with the accent. */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-0.5">
          {([6, 10, 16, 50] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRange(r)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                range === r
                  ? 'bg-accent text-fg-on-accent'
                  : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
              }`}
              title={r === 50 ? 'Wide range: ±50%' : `±${r}%`}
            >
              {r === 50 ? 'WIDE' : `±${r}`}
            </button>
          ))}
        </div>

        {/* Master Tempo toggle: pitch stays at original frequency while
            playbackRate changes. Off = the chipmunk effect. */}
        <button
          type="button"
          onClick={() => setPreservesPitch(!preservesPitch)}
          aria-pressed={preservesPitch}
          className={`rounded border px-3 py-1 text-xs transition-colors ${
            preservesPitch
              ? 'border-accent bg-accent/20 text-fg-primary'
              : 'border-border bg-bg-elevated text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
          }`}
          title={
            preservesPitch
              ? 'Master Tempo on: pitch stays, only speed changes.'
              : 'Master Tempo off: pitch follows the rate (chipmunk mode).'
          }
        >
          Master Tempo
        </button>

        <button
          type="button"
          onClick={resetTempo}
          disabled={tempoPercent === 0}
          className="rounded border border-border bg-bg-elevated px-3 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover hover:text-fg-primary disabled:opacity-40"
          title="Reset tempo to 0%"
        >
          Reset
        </button>

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-primary"
          aria-label="Collapse tempo controls"
          title="Collapse"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
