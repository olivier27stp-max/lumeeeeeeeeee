# ── Stage 1: Build ──────────────────────────────────────────────
# Cache bust: 2026-05-12-v2
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# These VITE_-prefixed vars are intentionally embedded into the client bundle
# at build time. They are PUBLIC values by design:
#  - VITE_SUPABASE_ANON_KEY: anon-role JWT (RLS-protected, designed for browser use)
#  - VITE_GOOGLE_MAPS_API_KEY: HTTP-referer restricted in Google Cloud Console
#  - VITE_MAPBOX_TOKEN: domain restricted in Mapbox dashboard
# Docker's SecretsUsedInArgOrEnv linter flags these as false positives — Vite
# REQUIRES ENV vars at build time to inline them into the client. Real secrets
# (SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, etc.) are never set here.
# hadolint ignore=DL3042
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_MAPBOX_TOKEN
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user for security (prevents container escape → root access)
RUN addgroup -g 1001 lume && adduser -D -u 1001 -G lume lume

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server source (runs with tsx at runtime)
COPY server ./server
COPY src/lib/crypto.ts ./src/lib/crypto.ts
COPY src/lib/stripeClient.ts ./src/lib/stripeClient.ts
COPY src/lib/paypalClient.ts ./src/lib/paypalClient.ts
COPY src/lib/permissions.ts ./src/lib/permissions.ts
# `src/lib/supabaseAdmin.ts` is now a stub that throws if imported from
# client code (real impl lives at `server/lib/supabaseAdmin.ts` for security
# — commit c12b767). The stub exists so Railway/BuildKit cache layers that
# still reference this COPY resolve cleanly.
COPY src/lib/supabaseAdmin.ts ./src/lib/supabaseAdmin.ts

# Install tsx for running TypeScript server
RUN npx tsx --version || npm i -g tsx

# Set ownership and switch to non-root user
RUN chown -R lume:lume /app
USER lume

# Only expose the API port (frontend is served by the same Express server in production)
EXPOSE 3001

# Serve static frontend + API server
CMD ["npx", "tsx", "server/index.ts"]
