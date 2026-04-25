import { NextResponse } from 'next/server';

// Loopback identifiers we accept. Next.js dev/runtime sets `x-forwarded-for: ::1`
// without brackets, but `host: [::1]:3457` keeps the brackets, so we strip them
// in `isLocal()` and compare against the bare forms here.
//
// `0.0.0.0` is intentionally NOT included: it's a wildcard bind address, never
// a legitimate origin. If a remote client sends `Host: 0.0.0.0` we should
// reject it.
//
// LIMITATION: this guard cannot distinguish a remote client spoofing
// `Host: localhost` from a real loopback request, because Node's HTTP layer
// in Next.js doesn't expose the raw socket peer address to route handlers.
// Operators MUST either bind the listener to 127.0.0.1 only (docker-compose
// default) or run a trusted reverse proxy that sets x-forwarded-for. The
// guard is a defence-in-depth, not the only line of defence.
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);

function isLocal(host: string): boolean {
  if (!host) return false;
  // Bracketed IPv6 with optional :port → e.g. "[::1]:3457"
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end <= 0) return false;
    return LOCAL_HOSTS.has(host.slice(1, end));
  }
  // Bare IPv6 has multiple colons and no leading bracket → e.g. "::1"
  if ((host.match(/:/g) ?? []).length > 1) {
    return LOCAL_HOSTS.has(host);
  }
  // IPv4 or hostname, optionally with port → split off the port suffix
  return LOCAL_HOSTS.has(host.split(':')[0]);
}

/**
 * Coarse but useful guard for endpoints that return secrets (cookies,
 * sessions, etc.) in a single-tenant self-host. Rejects any request whose
 * `host` header is not a loopback address or whose `x-forwarded-for`
 * indicates a non-loopback upstream.
 *
 * Operators who run behind a reverse proxy must terminate auth there and
 * mark the route accordingly; for the default `docker compose up` flow
 * (port bound to 127.0.0.1 by recommendation) this filter lets the
 * legitimate browser through and shuts everything else out.
 */
export function assertLocalRequest(req: Request): NextResponse | null {
  const host = req.headers.get('host') ?? '';
  if (!isLocal(host)) {
    return NextResponse.json(
      { ok: false, error: 'this endpoint is loopback-only' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && !isLocal(first)) {
      return NextResponse.json(
        { ok: false, error: 'forwarded request not allowed for secret-bearing endpoint' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  return null;
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
