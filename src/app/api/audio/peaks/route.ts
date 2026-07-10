import { NextResponse } from 'next/server';
import { assertLocalRequest } from '@/lib/http/local_only';
import { getCachedPeaks, setCachedPeaks } from '@/lib/audio/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Guard rails on what we persist: waveform peaks for a 48px-tall player bar
// need at most a couple thousand samples per channel, and stereo is plenty.
const MAX_CHANNELS = 2;
const MAX_SAMPLES_PER_CHANNEL = 8000;

function cacheKeyFor(id: number, sourceParam: string | null): string {
  return sourceParam === 'discovered' ? `disc_${id}` : `track_${id}`;
}

function parseId(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function GET(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  const url = new URL(req.url);
  const id = parseId(url.searchParams.get('id'));
  if (id == null) {
    return NextResponse.json({ ok: false, error: 'valid id query param required' }, { status: 400 });
  }
  const cached = getCachedPeaks(cacheKeyFor(id, url.searchParams.get('source')));
  if (!cached) {
    return NextResponse.json({ ok: false, error: 'no peaks cached' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, peaks: cached.peaks, duration: cached.duration });
}

export async function POST(req: Request) {
  const local = assertLocalRequest(req);
  if (local) return local;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
  }
  const { id: rawId, source, peaks, duration } = (body ?? {}) as {
    id?: unknown;
    source?: unknown;
    peaks?: unknown;
    duration?: unknown;
  };

  const id = parseId(typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId : null);
  if (id == null) {
    return NextResponse.json({ ok: false, error: 'valid id required' }, { status: 400 });
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json({ ok: false, error: 'valid duration required' }, { status: 400 });
  }
  if (!Array.isArray(peaks) || peaks.length === 0 || peaks.length > MAX_CHANNELS) {
    return NextResponse.json({ ok: false, error: 'peaks must be 1-2 channels' }, { status: 400 });
  }
  const clean: number[][] = [];
  for (const channel of peaks) {
    if (!Array.isArray(channel) || channel.length === 0 || channel.length > MAX_SAMPLES_PER_CHANNEL) {
      return NextResponse.json({ ok: false, error: 'peak channel out of bounds' }, { status: 400 });
    }
    // Coerce to finite numbers so a malformed sample can't poison the cache.
    clean.push(channel.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)));
  }

  setCachedPeaks(cacheKeyFor(id, typeof source === 'string' ? source : null), {
    peaks: clean,
    duration,
  });
  return NextResponse.json({ ok: true });
}
