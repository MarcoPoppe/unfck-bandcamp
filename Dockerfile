# syntax=docker/dockerfile:1.7

# ---- deps stage ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder stage ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner stage ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3457
ENV HOSTNAME=0.0.0.0

# Pinned yt-dlp release for reproducible builds.
# Bump YTDLP_VERSION + YTDLP_SHA256 together when updating.
ARG YTDLP_VERSION=2026.03.17
ARG YTDLP_SHA256=3bda0968a01cde70d26720653003b28553c71be14dcb2e5f4c24e9921fdad745

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      ca-certificates \
      curl \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
    && echo "${YTDLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output: server.js + minimal node_modules subset
# from .next/standalone, with static assets from .next/static and the
# original public/ dir alongside. This is dramatically smaller than the
# full builder node_modules and isolates the runtime surface.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# better-sqlite3 ships a prebuilt native binary, but the standalone bundle
# only links against the already-installed copy. Make sure the runner has
# it by copying the resolved package directly.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

RUN mkdir -p /app/data /app/data/audio_cache && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3457

# server.js is the standalone entrypoint emitted by next build.
CMD ["node", "server.js"]
