# =============================================================================
# AfriSend API — production image
#
# Build context is the REPOSITORY ROOT (the API also serves the operations
# console from ./admin-dashboard):
#   docker build -f backend/Dockerfile -t afrisend-api .
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--max-old-space-size=384

# tini reaps zombies, wget is used by the container healthcheck
RUN apk add --no-cache tini wget

WORKDIR /app

# Non-root runtime user
RUN addgroup -g 10001 -S afrisend && adduser -u 10001 -S afrisend -G afrisend

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY admin-dashboard/ ./admin-dashboard/
COPY supabase/ ./supabase/

USER afrisend

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/public/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# Migrations are intentionally NOT run automatically here: on Render run them
# once with `npm run migrate` (Shell tab) or via the CI job, so a bad migration
# cannot take the service down on deploy.
CMD ["node", "backend/server.js"]
