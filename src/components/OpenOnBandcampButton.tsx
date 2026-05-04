'use client';

import Tooltip from './Tooltip';

interface Props {
  href: string;
  /** Tooltip text. Default "Open on bandcamp.com". */
  label?: string;
  /** Visual size — "md" (40px, header default) or "sm" (32px). */
  size?: 'sm' | 'md';
}

/**
 * The single "open on bandcamp.com" affordance, used on detail-page
 * headers (Track, Curator, Artist, Label). Tracklists DO NOT include
 * this anymore — the BC-link only lives on the page that owns a single
 * entity. This keeps row chrome lean and reserves the BC-jump for
 * intentional navigation.
 */
export default function OpenOnBandcampButton({ href, label, size = 'md' }: Props) {
  const sizeClasses =
    size === 'md'
      ? 'h-10 w-10'
      : 'h-8 w-8';
  const iconSize = size === 'md' ? 18 : 14;
  return (
    <Tooltip text={label ?? 'Open on bandcamp.com'} position="top">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label ?? 'Open on bandcamp.com'}
        className={`inline-flex ${sizeClasses} items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
        </svg>
      </a>
    </Tooltip>
  );
}
