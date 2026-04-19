# syntax=docker/dockerfile:1.7
#
# Repro dashboard image. Published as ghcr.io/ripwords/reprokit-dashboard.
#
# Same image serves two purposes via the command:
#   - default      : `bun .output/server/index.mjs` (starts the Nuxt server)
#   - "migrate"    : `drizzle-kit migrate` (applies DB migrations, exits 0)
#
# The compose file runs the migrator service first (depends_on:
# condition: service_completed_successfully), then the dashboard.

# ─────────────────────────────────────────────────────────────────
# Stage 1: deps — resolve workspace deps; cached unless manifests change
# ─────────────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS deps
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/shared/package.json packages/shared/
COPY packages/recorder/package.json packages/recorder/
COPY packages/integrations/github/package.json packages/integrations/github/

# --ignore-scripts skips the better-sqlite3 native build (a transitive dep of
# @better-auth/cli we only use at dev time; the runtime pg driver is pure JS).
RUN bun install --frozen-lockfile --ignore-scripts

# ─────────────────────────────────────────────────────────────────
# Stage 2: build — compile the Nuxt app into a self-contained server
# ─────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo

COPY . .
RUN bun --filter dashboard build

# ─────────────────────────────────────────────────────────────────
# Stage 3: runtime — slim image with Nuxt output + migration tooling
# ─────────────────────────────────────────────────────────────────
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

# Non-root runtime user
RUN groupadd --system --gid 1001 repro \
 && useradd --system --uid 1001 --gid 1001 --create-home --shell /bin/sh repro

# Nuxt .output is a self-contained Node server — no workspace node_modules needed
COPY --from=build --chown=repro:repro /repo/apps/dashboard/.output ./.output

# Migration artifacts: drizzle-kit reads these at runtime
COPY --from=build --chown=repro:repro /repo/apps/dashboard/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=repro:repro /repo/apps/dashboard/server/db ./server/db

# drizzle-kit standalone (for the migrator command); tiny, ~30MB with its deps
RUN bun add --cwd /app drizzle-kit@latest drizzle-orm pg

# Healthcheck helper — reads NITRO_PORT so it stays in sync with the server
# if the port ever changes. Kept inside the image so compose.yaml doesn't
# carry escaped-quote soup.
RUN printf '%s\n' \
  'const port = process.env.NITRO_PORT ?? "3000"' \
  'fetch(`http://127.0.0.1:${port}/api/health`)' \
  '  .then((r) => process.exit(r.ok ? 0 : 1))' \
  '  .catch(() => process.exit(1))' \
  > /app/healthcheck.mjs \
 && chown repro:repro /app/healthcheck.mjs

USER repro

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
EXPOSE 3000

# Default: start the Nuxt server. Override in compose for the migrator service:
#   command: ["bunx", "drizzle-kit", "migrate"]
CMD ["bun", ".output/server/index.mjs"]
