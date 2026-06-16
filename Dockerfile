# syntax=docker/dockerfile:1
# Playwright's official image ships Chromium + all OS deps (fonts, GL libs)
# already wired up — this is what makes Flutter/CanvasKit/WebGL render reliably
# in a container. Tag MUST track the `playwright` npm version in package.json.
ARG PW_VERSION=v1.48.2
FROM mcr.microsoft.com/playwright:${PW_VERSION}-noble AS base
WORKDIR /app
ENV NODE_ENV=production
# Browsers live here in the base image; the npm package resolves them from it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# ── deps + build ──────────────────────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── production deps only ────────────────────────────────────────────────────────
FROM base AS proddeps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── runtime ─────────────────────────────────────────────────────────────────────
FROM base AS runtime
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 8080
# ROLE selects behaviour; default API. Override CMD for the worker.
ENV ROLE=api
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/entrypoints/api.js"]
