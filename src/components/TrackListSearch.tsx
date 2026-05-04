'use client';

interface Props {
  value: string;
  onChange: (next: string) => void;
  total: number;
  visible: number;
  unitLabel?: string;
  unitLabelPlural?: string;
  placeholder?: string;
  /** Optional extra controls rendered on the right side of the bar
   * (e.g. tab counters, hide-played toggle). */
  trailing?: React.ReactNode;
}

/**
 * Reusable search input for any tracklist. Filters client-side; the
 * parent owns the `value` state and the filtered list. Pattern is the
 * same everywhere (Library, History, Wishlist, Discover, Curator,
 * Playlists) so the search bar feels identical across pages.
 */
export default function TrackListSearch({
  value,
  onChange,
  total,
  visible,
  unitLabel = 'track',
  unitLabelPlural = 'tracks',
  placeholder = 'Search title, artist, album…',
  trailing,
}: Props) {
  const hasFilter = value.trim().length > 0;
  const counter =
    hasFilter && visible !== total
      ? `${visible.toLocaleString('de-DE')} of ${total.toLocaleString('de-DE')} ${
          total === 1 ? unitLabel : unitLabelPlural
        }`
      : `${total.toLocaleString('de-DE')} ${
          total === 1 ? unitLabel : unitLabelPlural
        }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-border bg-bg-surface py-1.5 pl-8 pr-8 text-sm text-fg-primary transition-colors focus:border-accent focus:outline-none"
        />
        {hasFilter && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted transition-colors hover:text-fg-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <span className="text-xs text-fg-muted">{counter}</span>
      {trailing}
    </div>
  );
}
