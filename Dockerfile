# syntax=docker/dockerfile:1

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time-only placeholders. `next build` collects page data by importing
# every route module, but never opens a DB connection or reads real secrets —
# the actual values are injected at runtime by docker-compose / the platform.
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV APP_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN npm run build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Migrations run from instrumentation.register() on boot inside the container.
ENV RUN_MIGRATIONS_ON_BOOT=true

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server + static assets + public dir.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# SQL migrations, resolved relative to CWD (/app) at boot.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
