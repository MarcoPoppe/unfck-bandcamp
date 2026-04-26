import TagsClient from './TagsClient';
import { listTags } from '@/lib/library/tags';
import { getStoredAuth } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default function TagsPage() {
  const auth = getStoredAuth();
  if (!auth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Tags</h1>
        <p className="mt-2 text-fg-secondary">
          Setup ist noch nicht abgeschlossen.{' '}
          <a className="text-accent underline" href="/setup">
            /setup
          </a>
        </p>
      </main>
    );
  }
  const tags = listTags();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tags</h1>
          <p className="text-fg-secondary">
            {tags.length} Tags. Tracks bekommen Tags ueber den TagPicker in der Track-Liste.
          </p>
        </div>
        <a href="/" className="text-sm text-fg-muted transition-colors hover:text-accent">
          ← home
        </a>
      </header>
      <TagsClient initialTags={tags} />
    </main>
  );
}
