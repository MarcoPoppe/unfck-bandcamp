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
