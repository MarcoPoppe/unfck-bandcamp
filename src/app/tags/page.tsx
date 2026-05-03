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
          Setup is not complete.{' '}
          <a className="text-accent underline" href="/setup">
            Open setup
          </a>
          .
        </p>
      </main>
    );
  }
  const tags = listTags();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Tags</h1>
        <p className="text-fg-secondary">
          {tags.length} tags. Attach tags to tracks via the + button in any track row.
        </p>
      </header>
      <TagsClient initialTags={tags} />
    </main>
  );
}
