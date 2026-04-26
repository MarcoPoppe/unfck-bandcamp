import {
  mkdirSync,
  existsSync,
  createReadStream,
  statSync,
  createWriteStream,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

let cachedDir: string | null = null;

function getCacheDir(): string {
  if (cachedDir) return cachedDir;
  const dir = resolve(process.env.AUDIO_CACHE_DIR ?? './data/audio_cache');
  mkdirSync(dir, { recursive: true });
  cachedDir = dir;
  return dir;
}

const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

function getMaxCacheBytes(): number {
  const raw = process.env.MAX_AUDIO_CACHE_BYTES;
  if (!raw) return DEFAULT_MAX_CACHE_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CACHE_BYTES;
}

export function getCachedPath(trackId: number): string {
  return join(getCacheDir(), `track_${trackId}.mp3`);
}

export function isCached(trackId: number): boolean {
  return existsSync(getCachedPath(trackId));
}

export interface CachedFileInfo {
  path: string;
  size: number;
}

export function getCachedInfo(trackId: number): CachedFileInfo | null {
  const path = getCachedPath(trackId);
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return { path, size: stat.size };
}

const inflight = new Map<number, Promise<void>>();
// Negative cache: when cacheStream fails for a track, block re-attempts for
// FAILURE_TTL_MS so a broken upstream URL or bandcamp throttling cannot
// hammer the API on every play.
const failedAt = new Map<number, number>();
const FAILURE_TTL_MS = 30_000;

function isInBackoff(trackId: number): boolean {
  const t = failedAt.get(trackId);
  if (!t) return false;
  if (Date.now() - t > FAILURE_TTL_MS) {
    failedAt.delete(trackId);
    return false;
  }
  return true;
}

export interface PruneResult {
  evicted: number;
  bytesEvicted: number;
  totalBytes: number;
}

/**
 * LRU-by-atime eviction. Lists every track_*.mp3 in the cache dir, sorts by
 * access time (oldest first), and unlinks files until total cache size drops
 * below MAX_AUDIO_CACHE_BYTES. Called after every successful cacheStream;
 * cheap enough for hundreds of files because readdir + stat is O(n).
 */
export function pruneCache(): PruneResult {
  const dir = getCacheDir();
  const max = getMaxCacheBytes();
  let entries: { path: string; size: number; atime: number }[];
  try {
    entries = readdirSync(dir)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => {
        const p = join(dir, f);
        try {
          const s = statSync(p);
          return { path: p, size: s.size, atime: s.atimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { path: string; size: number; atime: number } => e !== null)
      .sort((a, b) => a.atime - b.atime);
  } catch {
    return { evicted: 0, bytesEvicted: 0, totalBytes: 0 };
  }
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  let evicted = 0;
  let bytesEvicted = 0;
  while (total > max && entries.length > 0) {
    const file = entries.shift();
    if (!file) break;
    try {
      unlinkSync(file.path);
      total -= file.size;
      bytesEvicted += file.size;
      evicted += 1;
    } catch {
      // skip files we cannot delete (locked etc.)
    }
  }
  return { evicted, bytesEvicted, totalBytes: total };
}

/**
 * Persist the bandcamp-signed stream URL to a local mp3 file. Atomic via
 * write-to-tmp + rename so a half-downloaded file is never served. Concurrent
 * calls for the same track id share a single download via the inflight map.
 * Failures populate a 30-second negative cache to prevent hammering.
 */
export function cacheStream(trackId: number, streamUrl: string): Promise<void> {
  if (isInBackoff(trackId)) {
    return Promise.resolve();
  }
  const existing = inflight.get(trackId);
  if (existing) return existing;
  const promise = (async () => {
    const dest = getCachedPath(trackId);
    if (existsSync(dest)) return;
    const tmpPath = `${dest}.tmp.${process.pid}`;
    const res = await fetch(streamUrl);
    if (!res.ok || !res.body) {
      throw new Error(`upstream returned ${res.status}`);
    }
    try {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpPath));
      await rename(tmpPath, dest);
      pruneCache();
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  })();
  inflight.set(trackId, promise);
  promise.catch(() => {
    failedAt.set(trackId, Date.now());
  });
  promise.finally(() => inflight.delete(trackId));
  return promise;
}

export interface RangeServeResult {
  stream: NodeJS.ReadableStream;
  status: number;
  headers: Record<string, string>;
}

const RANGE_RE = /^bytes=(\d{1,19})-(\d{1,19})?$/;

/**
 * Serve a Range-requested slice of the cached file. Rejects descending ranges
 * (start > end) with 416. If Range is absent or unparsable we fall back to
 * full-file 200.
 */
export function serveCachedFile(
  trackId: number,
  range: string | null,
): RangeServeResult | null {
  const info = getCachedInfo(trackId);
  if (!info) return null;
  const { path, size } = info;
  const baseHeaders: Record<string, string> = {
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
  };
  if (!range) {
    return {
      stream: createReadStream(path),
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(size) },
    };
  }
  const m = RANGE_RE.exec(range.trim());
  if (!m) {
    return {
      stream: createReadStream(path),
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(size) },
    };
  }
  const start = Number(m[1]);
  const rawEnd = m[2] !== undefined ? Number(m[2]) : size - 1;
  const end = Math.min(rawEnd, size - 1);
  if (start >= size || end < start) {
    return {
      stream: Readable.from(Buffer.alloc(0)),
      status: 416,
      headers: {
        'content-range': `bytes */${size}`,
        'cache-control': 'no-store',
      },
    };
  }
  return {
    stream: createReadStream(path, { start, end }),
    status: 206,
    headers: {
      ...baseHeaders,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
    },
  };
}
