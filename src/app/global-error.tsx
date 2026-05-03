'use client';

/**
 * Outermost error boundary — catches errors in the root layout itself,
 * where the regular `error.tsx` fallback can't render because the layout
 * tree is the thing that failed. Kept intentionally minimal: no Tailwind
 * tokens (the layout is gone, so are the CSS variables), just inline
 * styles. The user's escape hatch is "reload the page".
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#0a0a0b',
          color: '#e5e7eb',
          margin: 0,
          padding: '4rem 1rem',
          minHeight: '100vh',
        }}
      >
        <main style={{ maxWidth: 600, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something broke at the root.
          </h1>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
            The app failed to render its layout. Your data is safe — this
            is a UI failure. Try reloading; if it keeps happening, send
            this digest to whoever maintains the instance:
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.8rem',
                marginTop: '0.5rem',
              }}
            >
              digest: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#1da0c3',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
