# Debian-based images throughout (not Alpine) — better-sqlite3 is a native addon, and
# building it against musl libc then running it here would risk a binary mismatch.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# node-gyp's fallback path for better-sqlite3 needs a C++ toolchain and Python present even
# when a prebuilt binary is available, in case the platform/arch has no matching prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone output already contains a pruned node_modules (including better-sqlite3's
# compiled binary, traced automatically because of `serverExternalPackages` in next.config.ts).
# There's no /public directory in this project (no static assets) — nothing to copy there.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Where the SQLite file lives — mount a persistent volume here on whatever platform this runs
# on, or its data (bookings, staff/patient accounts, everything) disappears on every restart.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/clinic.db

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
