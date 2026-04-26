import FollowsClient from './FollowsClient';
import {
  listFollowedArtists,
  listFollowedDiggers,
  listFollowedLabels,
} from '@/lib/entities/store';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function FollowsPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Follows</h1>
        <p className="mt-2 text-fg-secondary">
          Setup ist noch nicht abgeschlossen.{' '}
          <a className="text-accent underline" href="/setup">
            /setup
          </a>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Follows</h1>
          <p className="text-fg-secondary">
            Artists, Labels und Diggers, deren neue Releases im Discovery-Tab landen
          </p>
        </div>
        <a href="/" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← home
        </a>
      </header>
      <FollowsClient
        initialArtists={listFollowedArtists()}
        initialLabels={listFollowedLabels()}
        initialDiggers={listFollowedDiggers()}
      />
    </main>
  );
}
