/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  // Standalone output bundles a minimal node_modules + server.js so the
  // Docker runner stage can ship a small image without dev dependencies.
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'f4.bcbits.com' },
      { protocol: 'https', hostname: 'f1.bcbits.com' },
      { protocol: 'https', hostname: 'bandcamp.com' },
    ],
  },
};

module.exports = nextConfig;
