import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unfck Bandcamp',
  description: 'Beatport-style discovery UI for your Bandcamp collection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg-base text-fg-primary min-h-screen antialiased">{children}</body>
    </html>
  );
}
