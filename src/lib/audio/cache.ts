import {
  mkdirSync,
  existsSync,
  createReadStream,
  statSync,
  createWriteStream,
  readdirSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
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

const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

function getMaxCacheBytes(): number {
  const raw = process.env.MAX_AUDIO_CACHE_BYTES;
  if (!raw) return DEFAULT_MAX_CACHE_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CACHE_BYTES;
}

const KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizeKey(key: string): string {
  if (!KEY_RE.test(key)) {
    throw new Error(`invalid cache key: ${key}`);
  }
  return key;
}

export function getCachedPath(cacheKey: string): string {
  return join(getCacheDir(), `${sanitizeKey(cacheKey)}.mp3`);
}

export function isCached(cacheKey: string): boolean {
  return existsSync(getCachedPath(cacheKey));
}

export interface CachedFileInfo {
  path: string;
  size: number;
}

export function getCachedInfo(cacheKey: string): CachedFileInfo | null {
  const path = getCachedPath(cacheKey);
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return { path, size: stat.size };
}

const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const FAILURE_TTL_MS = 30_000;
// Cache pruning is O(n) over the cache directory; running it after every
// single write was wasteful at thousands of files. We prune every Nth write
// instead, which keeps the cap accurate-ish without scanning constantly.
const PRUNE_EVERY = 25;
let writesSincePrune = 0;

function isInBackoff(cacheKey: string): boolean {
  const t = failedAt.get(cacheKey);
  if (!t) return false;
  if (Date.now() - t > FAILURE_TTL_MS) {
    failedAt.delete(cacheKey);
    return false;
  }
  return true;
}

export interface PruneResult {
  evicted: number;
  bytesEvicted: number;
  totalBytes: number;
}

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
      // skip files we cannot delete
    }
  }
  return { evicted, bytesEvicted, totalBytes: total };
}

export function cacheStream(cacheKey: string, streamUrl: string): Promise<void> {
  const key = sanitizeKey(cacheKey);
  if (isInBackoff(key)) {
    return Promise.resolve();
  }
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const dest = getCachedPath(key);
    if (existsSync(dest)) return;
    const tmpPath = `${dest}.tmp.${process.pid}`;
    const res = await fetch(streamUrl);
    if (!res.ok || !res.body) {
      throw new Error(`upstream returned ${res.status}`);
    }
    try {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpPath));
      await rename(tmpPath, dest);
      writesSincePrune += 1;
      if (writesSincePrune >= PRUNE_EVERY) {
        writesSincePrune = 0;
        pruneCache();
      }
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  })();
  inflight.set(key, promise);
  promise.catch(() => {
    failedAt.set(key, Date.now());
  });
  promise.finally(() => inflight.delete(key));
  return promise;
}

/** Web ReadableStream we hand straight to the client while the same bytes
 * are teed onto disk in the background. */
export interface ProgressiveStream {
  webStream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: string | null;
}

/** The in-flight cache-write promise for a key, if one is running. Callers
 * use this to avoid opening a second Bandcamp connection for the same file:
 * if a download is already in flight, await it and serve from disk instead
 * of teeing a fresh fetch. */
export function getInflight(cacheKey: string): Promise<void> | undefined {
  return inflight.get(sanitizeKey(cacheKey));
}

let progressiveTmpSeq = 0;

/** Start a single Bandcamp fetch and tee it: one branch streams straight to
 * the caller (progressive playback — first byte immediately), the other is
 * written to the on-disk cache in the background. `inflight` is reserved
 * SYNCHRONOUSLY (before the await on fetch) so a request that arrives while
 * this one is still awaiting headers sees the reservation and waits for the
 * download instead of opening a second Bandcamp connection. The inflight
 * promise resolves on full disk write, so it survives a client disconnect
 * (a skip mid-load still finishes caching for next time). Throws if Bandcamp
 * doesn't hand us a usable body; the caller falls back to a refresh + retry. */
export function beginProgressiveStream(
  cacheKey: string,
  streamUrl: string,
): Promise<ProgressiveStream> {
  const key = sanitizeKey(cacheKey);
  const dest = getCachedPath(key);
  // Unique tmp path per call so the rare double-fetch race can't have two
  // writers on the same temp file.
  const tmpPath = `${dest}.tmp.${process.pid}.${progressiveTmpSeq++}`;
  let markDone: () => void = () => {};
  let markFailed: (err: unknown) => void = () => {};
  const donePromise = new Promise<void>((res, rej) => {
    markDone = res;
    markFailed = rej;
  });
  inflight.set(key, donePromise);
  donePromise.catch(() => {}).finally(() => inflight.delete(key));

  return (async (): Promise<ProgressiveStream> => {
    // Time out the *header* wait only. Once Bandcamp answers, the (possibly
    // throttled) body may stream slowly for a long time — that's fine and must
    // not be aborted, which is why we clear the timer as soon as fetch resolves.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(streamUrl, { signal: ac.signal });
    } catch (err) {
      clearTimeout(timer);
      failedAt.set(key, Date.now());
      markFailed(err);
      throw err;
    }
    clearTimeout(timer);
    if (!res.ok || !res.body) {
      failedAt.set(key, Date.now());
      const err = new Error(`upstream returned ${res.status}`);
      markFailed(err);
      throw err;
    }
    const [clientBranch, diskBranch] = res.body.tee();
    void (async () => {
      try {
        await pipeline(Readable.fromWeb(diskBranch as never), createWriteStream(tmpPath));
        await rename(tmpPath, dest);
        writesSincePrune += 1;
        if (writesSincePrune >= PRUNE_EVERY) {
          writesSincePrune = 0;
          pruneCache();
        }
        markDone();
      } catch (err) {
        try {
          await unlink(tmpPath);
        } catch {
          // ignore cleanup error
        }
        failedAt.set(key, Date.now());
        markFailed(err);
      }
    })();
    return {
      webStream: clientBranch,
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      contentLength: res.headers.get('content-length'),
    };
  })();
}

/** Pre-computed waveform peaks + duration for a track, cached next to the
 * audio file as `<key>.peaks.json`. Handing these to WaveSurfer lets it skip
 * its blocking full-file fetch, so playback can start progressively. */
export interface CachedPeaks {
  peaks: number[][];
  duration: number;
}

function getPeaksPath(cacheKey: string): string {
  return join(getCacheDir(), `${sanitizeKey(cacheKey)}.peaks.json`);
}

export function getCachedPeaks(cacheKey: string): CachedPeaks | null {
  const p = getPeaksPath(cacheKey);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as CachedPeaks;
    if (!Array.isArray(parsed.peaks) || parsed.peaks.length === 0) return null;
    if (typeof parsed.duration !== 'number' || !Number.isFinite(parsed.duration)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedPeaks(cacheKey: string, data: CachedPeaks): void {
  try {
    writeFileSync(getPeaksPath(cacheKey), JSON.stringify(data));
  } catch {
    // Best-effort: a failed peak-cache write just means we recompute next time.
  }
}

export interface RangeServeResult {
  stream: NodeJS.ReadableStream;
  status: number;
  headers: Record<string, string>;
}

const RANGE_RE = /^bytes=(\d{1,19})-(\d{1,19})?$/;

export function serveCachedFile(
  cacheKey: string,
  range: string | null,
): RangeServeResult | null {
  const info = getCachedInfo(cacheKey);
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
