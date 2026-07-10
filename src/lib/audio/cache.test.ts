import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the cache at a throwaway dir BEFORE importing the module: getCacheDir
// memoizes the resolved path on first use, so the env var must be set first.
let cacheDir: string;
let mod: typeof import('./cache');

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'unfck-peaks-'));
  process.env.AUDIO_CACHE_DIR = cacheDir;
  mod = await import('./cache');
});

afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('peak cache', () => {
  it('round-trips peaks + duration', () => {
    mod.setCachedPeaks('track_1', { peaks: [[0.1, 0.2, 0.3]], duration: 12.5 });
    expect(mod.getCachedPeaks('track_1')).toEqual({
      peaks: [[0.1, 0.2, 0.3]],
      duration: 12.5,
    });
  });

  it('supports stereo peaks and the discovered key namespace', () => {
    mod.setCachedPeaks('disc_7', { peaks: [[0.4], [0.6]], duration: 200 });
    const got = mod.getCachedPeaks('disc_7');
    expect(got?.peaks).toHaveLength(2);
    expect(got?.duration).toBe(200);
  });

  it('returns null for an uncached key', () => {
    expect(mod.getCachedPeaks('track_999')).toBeNull();
  });

  it('rejects a file with invalid json', () => {
    writeFileSync(join(cacheDir, 'track_badjson.peaks.json'), '{not json');
    expect(mod.getCachedPeaks('track_badjson')).toBeNull();
  });

  it('rejects a file with a non-finite duration', () => {
    writeFileSync(
      join(cacheDir, 'track_baddur.peaks.json'),
      JSON.stringify({ v: 2, peaks: [[0.1]], duration: null }),
    );
    expect(mod.getCachedPeaks('track_baddur')).toBeNull();
  });

  it('rejects a file with empty peaks', () => {
    writeFileSync(
      join(cacheDir, 'track_nopeaks.peaks.json'),
      JSON.stringify({ v: 2, peaks: [], duration: 10 }),
    );
    expect(mod.getCachedPeaks('track_nopeaks')).toBeNull();
  });

  it('rejects peaks written by a stale algorithm version', () => {
    // v1 was peak/max-abs; the current algorithm is RMS (v2). Old caches must
    // be ignored so the waveform gets recomputed instead of staying flat.
    writeFileSync(
      join(cacheDir, 'track_stale.peaks.json'),
      JSON.stringify({ v: 1, peaks: [[0.1, 0.2]], duration: 10 }),
    );
    expect(mod.getCachedPeaks('track_stale')).toBeNull();
  });

  it('rejects an unsafe cache key', () => {
    expect(() => mod.getCachedPeaks('../escape')).toThrow();
  });
});
