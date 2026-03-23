# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server source (runs with tsx at runtime)
COPY server ./server
COPY src/lib/crypto.ts ./src/lib/crypto.ts
COPY src/lib/supabaseAdmin.ts ./src/lib/supabaseAdmin.ts
COPY src/lib/stripeClient.ts ./src/lib/stripeClient.ts
COPY src/lib/paypalClient.ts ./src/lib/paypalClient.ts

# Install tsx for running TypeScript server
RUN npx tsx --version || npm i -g tsx

EXPOSE 3001 5173

# Serve static frontend + API server
CMD ["npx", "tsx", "server/index.ts"]
