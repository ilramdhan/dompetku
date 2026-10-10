# syntax=docker/dockerfile:1
# Dompetku — self-hosted Node image (Nitro `node-server` preset).
# Supabase stays external: configure it with env vars at runtime (see docs/SELF-HOSTING.md).
# The Vercel/Lovable builds are unaffected: only this image sets NITRO_PRESET.

ARG NODE_VERSION=24
ARG BUN_VERSION=1

# ---- deps: install exactly what bun.lock pins (same as CI) -------------------
FROM oven/bun:${BUN_VERSION}-slim AS bun
FROM node:${NODE_VERSION}-slim AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build: vite + nitro node-server output in .output/ ----------------------
FROM deps AS build
# Version shown in the UI (vite.config.ts reads GITHUB_SHA; .git is not in the context).
ARG GITHUB_SHA=""
ENV GITHUB_SHA=${GITHUB_SHA} \
    NITRO_PRESET=node-server \
    NODE_ENV=production
COPY . .
RUN bun run build

# ---- runtime: only the self-contained server output --------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", ".output/server/index.mjs"]
