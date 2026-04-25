import type { BcAuthInfo } from './types';
import { BC_ORIGIN, bcGet } from './http';
import { parseHomepageFanIdentity, parseProfileBlob } from './parse_collection';

const IDENTITY_RE = /(?:^|;\s*)identity=([^;]+)/;

interface IdentityPayload {
  id?: number;
  ex?: number;
}

export interface ParsedIdentity {
  userId: number;
  expiresAt: number;
}

/**
 * The `identity` cookie carries the bandcamp account user-id, NOT the
 * fan_id needed by the fan-API. We only use it as a sanity-check that
 * the cookie string is well-formed; the real fan_id is resolved from
 * the homepage HTML.
 */
export function parseIdentityCookie(cookieString: string): ParsedIdentity {
  const m = IDENTITY_RE.exec(cookieString);
  if (!m) {
    throw new Error('cookie string is missing an `identity` cookie');
  }
  const decoded = decodeURIComponent(m[1]);
  const parts = decoded.split('\t');
  if (parts.length < 3) {
    throw new Error('identity cookie has unexpected format');
  }
  const jsonPart = parts[parts.length - 1];
  let payload: IdentityPayload;
  try {
    payload = JSON.parse(jsonPart) as IdentityPayload;
  } catch {
    throw new Error('identity cookie payload is not valid JSON');
  }
  if (typeof payload.id !== 'number' || !Number.isFinite(payload.id)) {
    throw new Error('identity cookie has no numeric user id');
  }
  return { userId: payload.id, expiresAt: payload.ex ?? 0 };
}

const LOGOUT_RE = /(?:^|;\s*)logout=([^;]+)/;

interface LogoutPayload {
  username?: string;
}

export function parseEmailFromLogoutCookie(cookieString: string): string | null {
  const m = LOGOUT_RE.exec(cookieString);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    const parsed = JSON.parse(decoded) as LogoutPayload;
    return parsed.username ?? null;
  } catch {
    return null;
  }
}

const JS_LOGGED_IN_RE = /(?:^|;\s*)js_logged_in=1\b/;

export function looksLikeLoggedInCookies(cookieString: string): boolean {
  return JS_LOGGED_IN_RE.test(cookieString) && IDENTITY_RE.test(cookieString);
}

interface CollectionSummary {
  fanId: number | null;
  fanUsername: string | null;
}

async function fetchCollectionSummary(cookieString: string): Promise<CollectionSummary | null> {
  const res = await bcGet(`${BC_ORIGIN}/api/fan/2/collection_summary`, { cookieString });
  if (res.status !== 200) return null;
  try {
    const json = (await res.json()) as {
      fan_id?: number;
      collection_summary?: { username?: string; fan_id?: number };
    };
    return {
      fanId: json.fan_id ?? json.collection_summary?.fan_id ?? null,
      fanUsername: json.collection_summary?.username ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated fan's identity. Tries, in order:
 *   1. Inline `fanId`/`fanUsername` JSON tokens on the bandcamp homepage
 *      (cheapest, works for normal logged-in cookies).
 *   2. The pagedata blob if present (legacy fallback).
 *   3. /api/fan/2/collection_summary (last resort).
 */
export async function validateCookies(cookieString: string): Promise<BcAuthInfo> {
  if (!looksLikeLoggedInCookies(cookieString)) {
    throw new Error('cookies are missing identity or js_logged_in marker');
  }
  // Pre-flight: identity cookie must parse, otherwise the homepage will silently
  // serve the logged-out variant and we'd end up with confusing errors later.
  parseIdentityCookie(cookieString);
  const email = parseEmailFromLogoutCookie(cookieString);

  const res = await bcGet(`${BC_ORIGIN}/`, { cookieString });
  if (res.status !== 200) {
    throw new Error(`bandcamp.com returned ${res.status} during cookie validation`);
  }
  const html = await res.text();

  let { fanId, fanUsername } = parseHomepageFanIdentity(html);

  if (!fanId || !fanUsername) {
    const blob = parseProfileBlob(html);
    fanId ??= blob?.fanId ?? null;
    fanUsername ??= blob?.fanUsername ?? null;
  }

  if (!fanId || !fanUsername) {
    const summary = await fetchCollectionSummary(cookieString);
    fanId ??= summary?.fanId ?? null;
    fanUsername ??= summary?.fanUsername ?? null;
  }

  if (!fanId) throw new Error('could not resolve bandcamp fan_id for these cookies');
  if (!fanUsername) throw new Error('could not resolve bandcamp username for these cookies');

  return { fanId, username: fanUsername, email };
}
