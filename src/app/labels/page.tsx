import Link from 'next/link';
import { getStoredAuth } from '@/lib/auth/store';
import { getDb } from '@/lib/db';
import { getLabelActivity } from '@/lib/library/activity';
import ActiveBadge from '@/components/ActiveBadge';

export const dynamic = 'force-dynamic';

interface LabelRow {
  id: number;
  bcUrl: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  isFollowed: number;
}

interface UnlinkedLabel {
  name: string;
  trackCount: number;
}

function listLabelsWithCounts(): LabelRow[] {
  return getDb()
    .prepare<
      [],
      LabelRow
    >(
      `SELECT
         l.id           AS id,
         l.bc_url       AS bcUrl,
         l.name         AS name,
         l.image_url    AS imageUrl,
         (
           SELECT COUNT(*) FROM tracks t
            WHERE t.label_id = l.id AND t.removed_at IS NULL
         )              AS trackCount,
         CASE WHEN f.entity_id IS NULL THEN 0 ELSE 1 END AS isFollowed
       FROM labels l
       LEFT JOIN following f
         ON f.entity_type = 'label' AND f.entity_id = l.id
       ORDER BY isFollowed DESC, l.name COLLATE NOCASE ASC`,
    )
    .all();
}

/** Label names that show up on collection items but never resolved into a
 * `labels` row. Source is `collection_items.label_name` — the bandcamp fan
 * API hands us a name but rarely a URL, so we can't auto-create a label
 * row. We display them so Marco can see what's in his library and decide
 * which ones are worth following. */
function listUnlinkedLabels(): UnlinkedLabel[] {
  return getDb()
    .prepare<[], UnlinkedLabel>(
      `SELECT ci.label_name AS name, COUNT(*) AS trackCount
         FROM collection_items ci
        WHERE ci.label_name IS NOT NULL
          AND TRIM(ci.label_name) <> ''
          AND ci.removed_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM labels l
             WHERE LOWER(l.name) = LOWER(ci.label_name)
          )
        GROUP BY ci.label_name
        ORDER BY trackCount DESC, name COLLATE NOCASE ASC`,
    )
    .all();
}

export default async function LabelsIndexPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-fg-secondary">
          Setup is not complete.{' '}
          <a className="text-accent underline" href="/setup">
            Open setup
          </a>
          .
        </p>
      </main>
    );
  }

  const labels = listLabelsWithCounts();
  const unlinked = listUnlinkedLabels();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <h1 className="text-3xl font-bold tracking-tight">Labels</h1>
      <p className="mt-1 text-sm text-fg-secondary">
        Imprints you follow plus every label name we&apos;ve seen on a track in
        your library.
      </p>

      {labels.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-border bg-bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          No labels followed yet. Follow a label from any track or release page
          to start tracking its activity.
        </p>
      ) : (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Tracked · {labels.length}
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            {labels.map((l) => {
              const activity = getLabelActivity(l.id);
              return (
                <Link
                  key={l.id}
                  href={`/label/${l.id}`}
                  className="flex items-center gap-3 border-b border-border bg-bg-surface px-4 py-3 transition-colors last:border-b-0 hover:bg-bg-hover"
                >
                  {l.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="h-12 w-12 flex-none rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 flex-none rounded bg-bg-elevated" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-base font-medium text-fg-primary">
                        {l.name}
                      </div>
                      {l.isFollowed === 1 && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                          Followed
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                      {l.bcUrl.replace(/^https?:\/\//, '')}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-3 text-xs text-fg-muted">
                    <span title={`${l.trackCount} tracks linked to this label`}>
                      {l.trackCount} tracks
                    </span>
                    <ActiveBadge snapshot={activity} variant="compact" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {unlinked.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Loose label names · {unlinked.length}
          </h2>
          <p className="mb-3 text-xs text-fg-muted">
            These names appear on tracks but aren&apos;t followed yet, so we have
            no Bandcamp URL to navigate to. Follow them from a track or release
            page to upgrade them into trackable labels.
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {unlinked.map((u) => (
              <li
                key={u.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm"
              >
                <span className="truncate text-fg-secondary" title={u.name}>
                  {u.name}
                </span>
                <span className="flex-none font-mono text-xs text-fg-muted">
                  {u.trackCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
