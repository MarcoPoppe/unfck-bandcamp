'use client';

import { useState } from 'react';
import type { ArtistRow, DiggerRow, LabelRow } from '@/lib/entities/store';

type Tab = 'artist' | 'label' | 'digger';

interface Props {
  initialArtists: ArtistRow[];
  initialLabels: LabelRow[];
  initialDiggers: DiggerRow[];
}

export default function FollowsClient({
  initialArtists,
  initialLabels,
  initialDiggers,
}: Props) {
  const [tab, setTab] = useState<Tab>('artist');
  const [artists, setArtists] = useState<ArtistRow[]>(initialArtists);
  const [labels, setLabels] = useState<LabelRow[]>(initialLabels);
  const [diggers, setDiggers] = useState<DiggerRow[]>(initialDiggers);
  const [bcUrl, setBcUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function refreshAll() {
    const res = await fetch('/api/follow');
    if (!res.ok) return;
    const json = (await res.json()) as {
      artists?: ArtistRow[];
      labels?: LabelRow[];
      diggers?: DiggerRow[];
    };
    setArtists(json.artists ?? []);
    setLabels(json.labels ?? []);
    setDiggers(json.diggers ?? []);
  }

  async function handleAdd() {
    if (!bcUrl.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: tab, bcUrl: bcUrl.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `add failed (${res.status})`);
      } else {
        setBcUrl('');
        await refreshAll();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'add failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnfollow(entityType: Tab, entityId: number) {
    const res = await fetch(
      `/api/follow?entityType=${entityType}&entityId=${entityId}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      await refreshAll();
    }
  }

  async function triggerDiscoverySync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        artistsCrawled?: number;
        releasesFetched?: number;
        tracksWritten?: number;
        durationMs?: number;
        errors?: { error: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? `sync failed (${res.status})`);
      } else {
        const seconds = ((json.durationMs ?? 0) / 1000).toFixed(1);
        const errCount = json.errors?.length ?? 0;
        setMessage(
          `${json.artistsCrawled} Artists / ${json.releasesFetched} Releases / ${json.tracksWritten} Tracks in ${seconds}s` +
            (errCount > 0 ? ` (${errCount} Fehler)` : ''),
        );
        await refreshAll();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const counts = {
    artist: artists.length,
    label: labels.length,
    digger: diggers.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 border-b border-border">
        {(['artist', 'label', 'digger'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {t === 'artist' ? 'Artists' : t === 'label' ? 'Labels' : 'Diggers'}{' '}
            <span className="ml-1 text-xs text-fg-muted">{counts[t]}</span>
          </button>
        ))}
        <div className="ml-auto">
          <button
            type="button"
            onClick={triggerDiscoverySync}
            disabled={syncing || artists.length === 0}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {syncing ? 'crawle...' : 'Discovery Sync'}
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-bg-surface p-4">
        <h2 className="text-base font-semibold">
          Hinzufuegen:{' '}
          {tab === 'artist'
            ? 'Artist-URL'
            : tab === 'label'
              ? 'Label-URL'
              : 'Digger-URL'}
        </h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={bcUrl}
            onChange={(e) => setBcUrl(e.target.value)}
            placeholder={
              tab === 'digger'
                ? 'https://bandcamp.com/<username>'
                : 'https://<subdomain>.bandcamp.com'
            }
            className="flex-1 rounded border border-border bg-bg-base px-3 py-2 text-sm font-mono text-fg-primary focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !bcUrl.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'add...' : 'folgen'}
          </button>
        </div>
      </section>

      {message && (
        <div className="rounded border border-border bg-bg-surface p-3 text-sm text-fg-secondary">
          {message}
        </div>
      )}

      <div className="space-y-2">
        {tab === 'artist' &&
          artists.map((a) => (
            <EntityCard
              key={a.id}
              imageUrl={a.imageUrl}
              title={a.name}
              subtitle={a.bcUrl}
              onUnfollow={() => handleUnfollow('artist', a.id)}
            />
          ))}
        {tab === 'label' &&
          labels.map((l) => (
            <EntityCard
              key={l.id}
              imageUrl={l.imageUrl}
              title={l.name}
              subtitle={l.bcUrl}
              onUnfollow={() => handleUnfollow('label', l.id)}
            />
          ))}
        {tab === 'digger' &&
          diggers.map((d) => (
            <EntityCard
              key={d.id}
              imageUrl={d.imageUrl}
              title={d.displayName ?? d.bcUsername}
              subtitle={`bandcamp.com/${d.bcUsername}`}
              onUnfollow={() => handleUnfollow('digger', d.id)}
            />
          ))}
        {((tab === 'artist' && artists.length === 0) ||
          (tab === 'label' && labels.length === 0) ||
          (tab === 'digger' && diggers.length === 0)) && (
          <p className="rounded border border-dashed border-border bg-bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Noch keine {tab === 'artist' ? 'Artists' : tab === 'label' ? 'Labels' : 'Diggers'}{' '}
            gefolgt.
          </p>
        )}
      </div>
    </div>
  );
}

interface EntityCardProps {
  imageUrl: string | null;
  title: string;
  subtitle: string;
  onUnfollow: () => void;
}

function EntityCard({ imageUrl, title, subtitle, onUnfollow }: EntityCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface p-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-12 w-12 flex-none rounded object-cover" />
      ) : (
        <div className="h-12 w-12 flex-none rounded bg-bg-elevated" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-fg-muted">{subtitle}</div>
      </div>
      <button
        type="button"
        onClick={onUnfollow}
        className="rounded border border-border px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-red-700 hover:text-red-200"
      >
        unfollow
      </button>
    </div>
  );
}
