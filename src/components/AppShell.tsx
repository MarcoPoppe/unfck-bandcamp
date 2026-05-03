'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import UnfckBandcampLogo from './UnfckBandcampLogo';
import Tooltip from './Tooltip';
import UpdaterBanner from './UpdaterBanner';
import { usePlayerStore } from '@/lib/store/player';

interface NavItem {
  href: string;
  label: string;
}

const PRIMARY: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/discover', label: 'Discover' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/tracks', label: 'Library' },
];

const LIBRARY: NavItem[] = [
  { href: '/labels', label: 'Labels' },
  { href: '/history', label: 'History' },
];

export default function AppShell({
  auth,
  children,
}: {
  auth: { username: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [libOpen, setLibOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const libRef = useRef<HTMLDivElement | null>(null);
  const setWishlistedBcTrackIds = usePlayerStore((s) => s.setWishlistedBcTrackIds);
  const setPlayedBcTrackIds = usePlayerStore((s) => s.setPlayedBcTrackIds);
  const setPlaylistMembershipMap = usePlayerStore((s) => s.setPlaylistMembershipMap);
  // Avatar URL of the BC profile we crawl. Cached in localStorage for 6h
  // so we don't hit bandcamp.com on every navigation. The fallback (an
  // initial-letter circle) renders instantly until the cache is warm.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    const KEY = 'unfck.avatar_cache.v1';
    const TTL_MS = 6 * 60 * 60 * 1000;
    try {
      const cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') as
        | { username: string; url: string | null; fetchedAt: number }
        | null;
      if (
        cached &&
        cached.username === auth.username &&
        Date.now() - cached.fetchedAt < TTL_MS
      ) {
        setAvatarUrl(cached.url);
        return;
      }
    } catch {
      // ignore — fall through to fresh fetch
    }
    let cancelled = false;
    void fetch('/api/auth/avatar')
      .then(
        (r) => r.json() as Promise<{ ok?: boolean; url?: string | null; username?: string | null }>,
      )
      .then((j) => {
        if (cancelled || !j.ok) return;
        setAvatarUrl(j.url ?? null);
        try {
          localStorage.setItem(
            KEY,
            JSON.stringify({
              username: j.username ?? auth.username,
              url: j.url ?? null,
              fetchedAt: Date.now(),
            }),
          );
        } catch {
          // ignore quota errors
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [auth]);

  // Hydrate the live wishlist set on first mount so heart icons pick up
  // their filled state without each WishlistButton instance fetching
  // separately. Only `open` items count as "on wishlist" — bought and
  // dismissed items shouldn't keep the heart lit.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/wishlist?status=open')
      .then((r) => r.json() as Promise<{ ok?: boolean; items?: { bcTrackId: number }[] }>)
      .then((j) => {
        if (cancelled || !j.ok || !j.items) return;
        setWishlistedBcTrackIds(j.items.map((i) => i.bcTrackId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setWishlistedBcTrackIds]);

  // Hydrate the live played-set so green checks stay correct after a
  // soft navigation (e.g. clicking a track title and back). Without
  // this, only the bcTrackIds that were marked-played in the current
  // mount were lit, and a back-navigation reset the set on remount.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/plays?as=set')
      .then(
        (r) => r.json() as Promise<{ ok?: boolean; bcTrackIds?: number[] }>,
      )
      .then((j) => {
        if (cancelled || !j.ok || !j.bcTrackIds) return;
        setPlayedBcTrackIds(j.bcTrackIds);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setPlayedBcTrackIds]);

  // Hydrate the live playlist-membership map. Per-row badges read from
  // this so add/remove via the dropdown is reflected immediately on every
  // visible row, not just after a refresh.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/playlists?as=memberships')
      .then(
        (r) =>
          r.json() as Promise<{
            ok?: boolean;
            memberships?: Record<string, { id: number; name: string }[]>;
          }>,
      )
      .then((j) => {
        if (cancelled || !j.ok || !j.memberships) return;
        const map = new Map<number, { id: number; name: string }[]>();
        for (const [k, v] of Object.entries(j.memberships)) {
          map.set(Number(k), v);
        }
        setPlaylistMembershipMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setPlaylistMembershipMap]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!libRef.current) return;
      if (e.target instanceof Node && !libRef.current.contains(e.target)) {
        setLibOpen(false);
      }
    }
    if (libOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [libOpen]);

  useEffect(() => {
    setLibOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);
  const libraryActive = LIBRARY.some((i) => isActive(i.href));

  return (
    <>
      <UpdaterBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-bg-base/95 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-3">
          <Link
            href="/"
            className="mr-2 flex items-center text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Unfck Bandcamp — home"
          >
            <UnfckBandcampLogo className="h-7 w-auto" priority />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {PRIMARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive(item.href)
                    ? 'bg-bg-elevated text-fg-primary'
                    : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                }`}
              >
                {item.label}
              </Link>
            ))}

            <div className="relative" ref={libRef}>
              <Tooltip
                text="Labels and listening history"
                position="bottom"
                disabled={libOpen}
              >
                <button
                  type="button"
                  onClick={() => setLibOpen((v) => !v)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    libraryActive
                      ? 'bg-bg-elevated text-fg-primary'
                      : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={libOpen}
                >
                  More
                  <span className="ml-1 text-xs">▾</span>
                </button>
              </Tooltip>
              {libOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded border border-border bg-bg-elevated shadow-lg"
                >
                  {LIBRARY.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      role="menuitem"
                      className={`block px-3 py-2 text-sm transition-colors ${
                        isActive(i.href)
                          ? 'bg-bg-hover text-fg-primary'
                          : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                      }`}
                    >
                      {i.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="ml-auto rounded p-2 text-fg-secondary hover:bg-bg-hover md:hidden"
            aria-label="Toggle menu"
          >
            ☰
          </button>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Tooltip
              text={auth ? `${auth.username} — open setup` : 'Open setup'}
              position="bottom"
            >
              <Link
                href="/setup"
                aria-label={auth ? `Account ${auth.username} — open setup` : 'Open setup'}
                className={`group flex items-center gap-2 rounded-full border px-1 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive('/setup')
                    ? 'border-accent bg-bg-elevated'
                    : 'border-border bg-bg-elevated/60 hover:border-accent hover:bg-bg-hover'
                }`}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-8 w-8 flex-none rounded-full object-cover"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold uppercase tracking-tight ${
                      auth
                        ? 'bg-accent text-fg-on-accent'
                        : 'bg-bg-base text-fg-muted'
                    }`}
                    aria-hidden="true"
                  >
                    {auth ? auth.username.slice(0, 1) : '?'}
                  </span>
                )}
                {auth && (
                  <span className="pr-2 text-fg-secondary group-hover:text-fg-primary">
                    {auth.username}
                  </span>
                )}
              </Link>
            </Tooltip>
          </div>
        </nav>

        {mobileOpen && (
          <div className="border-t border-border bg-bg-base md:hidden">
            <div className="mx-auto max-w-7xl space-y-1 px-4 py-3">
              {[...PRIMARY, ...LIBRARY, { href: '/setup', label: 'Setup' }].map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className={`block rounded px-3 py-2 text-sm transition-colors ${
                    isActive(i.href)
                      ? 'bg-bg-elevated text-fg-primary'
                      : 'text-fg-secondary hover:bg-bg-hover hover:text-fg-primary'
                  }`}
                >
                  {i.label}
                </Link>
              ))}
              {auth && (
                <div className="px-3 py-2 font-mono text-xs text-fg-muted">
                  @{auth.username}
                </div>
              )}
            </div>
          </div>
        )}
      </header>
      {children}
    </>
  );
}
