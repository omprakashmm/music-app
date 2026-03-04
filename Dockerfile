FROM node:20-slim

# ── System dependencies ────────────────────────────────────────────────────────
# python3 + make + g++ compile better-sqlite3 native addon
# ffmpeg needed by yt-dlp for audio extraction
# curl downloads the yt-dlp binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
     -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install dependencies ───────────────────────────────────────────────────────
COPY package*.json ./
RUN npm ci

# ── Build frontend ─────────────────────────────────────────────────────────────
COPY . .
RUN npm run build

# ── Persistent data directory (mount a Railway Volume at /data) ────────────────
RUN mkdir -p /data

# ── Runtime ────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV DB_PATH=/data/music.db
EXPOSE 8080

# Run tsx directly (not via npx/npm) so SIGTERM reaches the process correctly
CMD ["node_modules/.bin/tsx", "server.ts"]
