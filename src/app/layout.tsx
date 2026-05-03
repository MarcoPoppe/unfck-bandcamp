import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import { getStoredAuth } from '@/lib/auth/store';
import { THEME_BOOT_SCRIPT } from '@/lib/settings/theme';

export const metadata: Metadata = {
  title: 'Unfck Bandcamp',
  description: 'Beatport-style discovery UI for your Bandcamp collection',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = getStoredAuth();
  // Inline boot script: applies the user's saved theme to <html> before
  // first paint to avoid a flash of dark-then-light. Content is a fixed
  // hard-coded constant (THEME_BOOT_SCRIPT), no untrusted input involved.
  const bootScript = { __html: THEME_BOOT_SCRIPT };
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={bootScript} />
      </head>
      <body className="bg-bg-base text-fg-primary min-h-screen antialiased">
        <AppShell auth={auth ? { username: auth.username } : null}>{children}</AppShell>
      </body>
    </html>
  );
}
