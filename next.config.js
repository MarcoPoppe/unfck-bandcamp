/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'f4.bcbits.com' },
      { protocol: 'https', hostname: 'f1.bcbits.com' },
      { protocol: 'https', hostname: 'bandcamp.com' },
    ],
  },
};

module.exports = nextConfig;
