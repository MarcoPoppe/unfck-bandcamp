import type { ActivitySnapshot } from '@/lib/library/activity';

interface Props {
  snapshot: ActivitySnapshot;
  /** Compact (just the dot + label) vs full (with last-activity date). */
  variant?: 'compact' | 'full';
}

const STATUS_LABEL: Record<ActivitySnapshot['status'], string> = {
  active: 'Active',
  dormant: 'Dormant',
  inactive: 'Inactive',
  unknown: 'No data',
};

const DOT_CLASS: Record<ActivitySnapshot['status'], string> = {
  active: 'bg-fg-success',
  dormant: 'bg-fg-warning',
  inactive: 'bg-fg-muted',
  unknown: 'bg-fg-muted/40',
};

const TEXT_CLASS: Record<ActivitySnapshot['status'], string> = {
  active: 'text-fg-success',
  dormant: 'text-fg-warning',
  inactive: 'text-fg-muted',
  unknown: 'text-fg-muted',
};

function relativeLabel(daysAgo: number | null): string | null {
  if (daysAgo == null) return null;
  if (daysAgo <= 1) return 'today';
  if (daysAgo <= 30) return `${daysAgo} d ago`;
  if (daysAgo <= 365) return `${Math.round(daysAgo / 30)} mo ago`;
  return `${(daysAgo / 365).toFixed(1)} y ago`;
}

/**
 * Tiny status pill: coloured dot plus label. Used on Artist, Label and
 * Curator pages to flag whether the entity has shipped / collected
 * anything recent. The relative-time suffix is shown inline (compact and
 * full variants) so a friend can tell at a glance "Inactive since when".
 * Tooltip adds the absolute date for verification.
 */
export default function ActiveBadge({ snapshot, variant = 'compact' }: Props) {
  const label = STATUS_LABEL[snapshot.status];
  const rel = relativeLabel(snapshot.daysAgo);
  const tooltip = snapshot.lastDate
    ? `Last activity: ${snapshot.lastDate}${rel ? ` (${rel})` : ''}`
    : 'No release / collection data yet — entity not synced or never updated.';
  const isUnknown = snapshot.status === 'unknown';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] font-medium ${TEXT_CLASS[snapshot.status]}`}
      title={tooltip}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[snapshot.status]}`}
      />
      {label}
      {/* Relative-time suffix. "Active" alone would be ambiguous (active
          since when?), so we always show "Active · 3 mo" when we have a
          date. For Inactive/Dormant the suffix is even more important. */}
      {!isUnknown && rel && (
        <span className="text-fg-muted">· {rel}</span>
      )}
    </span>
  );
}
