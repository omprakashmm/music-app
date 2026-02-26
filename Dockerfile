FROM node:20-alpine

# ── System dependencies ───────────────────────────────────────────────────────
# python3 + make + g++ are required to compile better-sqlite3 (native addon)
# ffmpeg is required by yt-dlp for audio format conversion
# yt-dlp standalone binary is downloaded directly for YouTube streaming
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
     -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# ── Install Node dependencies ─────────────────────────────────────────────────
COPY package*.json ./
RUN npm install

# ── Copy source and build Vite frontend ──────────────────────────────────────
COPY . .
RUN npm run build

# ── Persistent data directory (mount Railway Volume here) ────────────────────
RUN mkdir -p /data

# ── Runtime config ────────────────────────────────────────────────────────────
EXPOSE 3000
ENV NODE_ENV=production
ENV DB_PATH=/data/music.db

CMD ["npx", "tsx", "server.ts"]
