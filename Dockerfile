FROM node:20-slim

# ── System dependencies ────────────────────────────────────────────────────────
# curl + ca-certificates for HTTPS requests to Invidious/Spotify
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install dependencies ───────────────────────────────────────────────────────
COPY package*.json ./
RUN npm ci

# ── Build frontend ─────────────────────────────────────────────────────────────
COPY . .
RUN npm run build

# ── Runtime ────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
EXPOSE 8080

# Run tsx directly (not via npx/npm) so SIGTERM reaches the process correctly
CMD ["node_modules/.bin/tsx", "server.ts"]
