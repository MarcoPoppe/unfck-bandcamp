const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  // Standalone output bundles a minimal node_modules + server.js so the
  // Docker runner stage can ship a small image without dev dependencies.
  output: 'standalone',
  // Force the file-tracing root to the app directory itself. Without this,
  // Next.js auto-detects an ancestor folder ("Claude/" on a Windows dev box)
  // as the workspace root and produces a deeply nested standalone tree.
  outputFileTracingRoot: path.resolve(__dirname),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'f4.bcbits.com' },
      { protocol: 'https', hostname: 'f1.bcbits.com' },
      { protocol: 'https', hostname: 'bandcamp.com' },
    ],
  },
};

module.exports = nextConfig;
