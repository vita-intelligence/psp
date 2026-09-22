# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the PSP Next.js client (Next 16 standalone).
#   deps    → npm ci with cache
#   builder → next build (bakes NEXT_PUBLIC_* args)
#   runtime → Node 22 slim + standalone bundle

FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---------- Builder ----------

FROM node:22-slim AS builder

WORKDIR /app

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
# Rebuild whenever the backend hostname changes.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
# Sandbox-only escape hatch — see next.config.ts. Prod never sets it.
ARG NEXT_IGNORE_BUILD_ERRORS
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_IGNORE_BUILD_ERRORS=${NEXT_IGNORE_BUILD_ERRORS} \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- Runtime ----------

FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -s /bin/bash -m nextjs

# Next standalone output ships a minimal server + traced node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
