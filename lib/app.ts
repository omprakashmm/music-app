import express from "express";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import https from "https";

// ─── Env ───────────────────────────────────────────────────────────────────────
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";

// ─── Database (Neon serverless Postgres) ───────────────────────────────────────
let _sql: NeonQueryFunction<false, false> | null = null;
function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new Error(
        "DATABASE_URL is not set. Add your Neon connection string to environment variables."
      );
    _sql = neon(url);
  }
  return _sql;
}

export async function initDb() {
  const db = getDb();
  await db`
    CREATE TABLE IF NOT EXISTS songs (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      artist     TEXT NOT NULL,
      album      TEXT    DEFAULT 'Unknown Album',
      cover_url  TEXT    DEFAULT '',
      duration   INTEGER DEFAULT 0,
      audio_url  TEXT NOT NULL,
      youtube_id TEXT    DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS playlists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT ''
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
      song_id     TEXT REFERENCES songs(id)     ON DELETE CASCADE,
      PRIMARY KEY (playlist_id, song_id)
    )
  `;
}

// Row mapper: DB snake_case → JS camelCase
function toSong(r: any) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    coverUrl: r.cover_url,
    duration: r.duration,
    audioUrl: r.audio_url,
    youtubeId: r.youtube_id,
  };
}

// ─── General helpers ───────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).substr(2, 9);
}

function extractYoutubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

function extractYoutubePlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractSpotifyPlaylistId(url: string): string | null {
  const m = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

function sseWrite(res: any, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (res.flush) res.flush();
}

function sSEHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

// ─── Invidious API (replaces yt-dlp + curl) ────────────────────────────────────
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.privacydev.net",
  "https://iv.ggtyler.dev",
  "https://invidious.nikkosphere.com",
  "https://yt.artemislena.eu",
  "https://invidious.fdn.fr",
  "https://invidious.perennialte.ch",
  "https://invidious.slipfox.xyz",
  "https://invidious.epicsite.xyz",
];

// ─── Piped API (proxy URLs are NOT IP-bound — works from any browser IP) ───────
const PIPED_API_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://piped-api.garudalinux.org",
  "https://api.piped.projectsegfau.lt",
  "https://watchapi.whatever.social",
];

/** Return a Piped proxy audio URL for `videoId`.
 *  These URLs go through pipedproxy-*.kavin.rocks (or similar) which is
 *  publicly accessible — no IP-binding, works directly in <audio src>. */
async function pipedAudioUrl(videoId: string): Promise<string | null> {
  for (const base of PIPED_API_INSTANCES) {
    try {
      const data = await fetchJson(`${base}/streams/${videoId}`, 10000);
      if (!data || data.error || !Array.isArray(data.audioStreams)) continue;
      // Sort by bitrate desc, pick highest quality
      const streams = [...data.audioStreams].sort(
        (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)
      );
      const best = streams[0];
      if (best?.url) {
        console.log(`✅ Piped audio URL from ${base}`);
        return best.url as string;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SonicStream/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Fetch single-video metadata from first healthy Invidious instance.
 *  Returns the data object plus a `_base` field = the instance that responded. */
async function invidiousVideoInfo(videoId: string): Promise<any> {
  const errors: string[] = [];
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(`${base}/api/v1/videos/${videoId}`, 10000);
      if (data && !data.error) return { ...data, _base: base };
    } catch (e: any) {
      errors.push(`${base}: ${e.message?.slice(0, 40)}`);
    }
  }
  throw new Error("All Invidious instances failed: " + errors.slice(0, 3).join(" | "));
}

/** Search YouTube via Invidious, return first video ID. */
async function invidiousSearch(query: string): Promise<string | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1`,
        10000
      );
      if (Array.isArray(data) && data.length > 0) return data[0].videoId;
    } catch {
      continue;
    }
  }
  return null;
}

/** Fetch all videos from a YouTube playlist via Invidious. */
async function invidiousFetchPlaylist(
  playlistId: string
): Promise<{ videoId: string; title: string; channel: string }[]> {
  const errors: string[] = [];
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const videos: any[] = [];
      let page = 1;
      while (true) {
        const data = await fetchJson(
          `${base}/api/v1/playlists/${playlistId}?page=${page}`,
          12000
        );
        if (!data || data.error || !Array.isArray(data.videos) || data.videos.length === 0) break;
        videos.push(...data.videos);
        const total: number = data.videoCount || videos.length;
        if (videos.length >= total || page >= 10) break;
        page++;
      }
      if (videos.length > 0) {
        console.log(`✅ Invidious: got ${videos.length} videos from ${base}`);
        return videos.map((v) => ({
          videoId: v.videoId,
          title: v.title || "Unknown",
          channel: v.author || "Unknown Artist",
        }));
      }
      errors.push(`${base}: empty response`);
    } catch (e: any) {
      errors.push(`${base}: ${e.message?.slice(0, 60)}`);
      continue;
    }
  }
  throw new Error(
    "All Invidious instances failed. Errors: " + errors.slice(0, 3).join(" | ")
  );
}

// ─── Spotify helpers ───────────────────────────────────────────────────────────
async function httpsJson(options: https.RequestOptions, body?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const raw = data.trim();
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return reject(
            new Error(
              `Spotify returned non-JSON (HTTP ${res.statusCode}): "${raw.slice(0, 120)}"`
            )
          );
        }
        if (parsed.error)
          return reject(
            new Error(
              `Spotify error: ${parsed.error_description || JSON.stringify(parsed.error)}`
            )
          );
        resolve(parsed);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function spotifyToken(): Promise<string> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)
    throw new Error(
      "Spotify credentials not set. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables."
    );
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const body = "grant_type=client_credentials";
  const data = await httpsJson(
    {
      hostname: "accounts.spotify.com",
      path: "/api/token",
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );
  if (!data.access_token) throw new Error("Spotify did not return an access token.");
  return data.access_token;
}

async function spotifyPlaylistTracks(
  playlistId: string,
  token: string
): Promise<{ title: string; artist: string; album: string; coverUrl: string }[]> {
  const tracks: any[] = [];
  let url: string | null = `/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,album(name,images)))`;
  while (url) {
    const data = await httpsJson({
      hostname: "api.spotify.com",
      path: url,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (data.items) {
      for (const item of data.items) {
        const t = item?.track;
        if (!t) continue;
        tracks.push({
          title: t.name,
          artist: t.artists?.map((a: any) => a.name).join(", ") || "Unknown",
          album: t.album?.name || "Unknown",
          coverUrl: t.album?.images?.[0]?.url || "",
        });
      }
    }
    url = data.next ? new URL(data.next).pathname + new URL(data.next).search : null;
  }
  return tracks;
}

// ─── DB helpers ────────────────────────────────────────────────────────────────
async function saveSong(s: {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  audioUrl: string;
  youtubeId?: string;
}) {
  const db = getDb();
  if (s.youtubeId) {
    const rows = await db`SELECT * FROM songs WHERE youtube_id = ${s.youtubeId}`;
    if (rows.length > 0) return toSong(rows[0]);
  }
  const id = genId();
  const cover = s.coverUrl || `https://picsum.photos/seed/${id}/400/400`;
  await db`
    INSERT INTO songs (id, title, artist, album, cover_url, duration, audio_url, youtube_id)
    VALUES (${id}, ${s.title}, ${s.artist}, ${s.album || "Unknown Album"},
            ${cover}, ${s.duration || 0}, ${s.audioUrl}, ${s.youtubeId || ""})
  `;
  const rows = await db`SELECT * FROM songs WHERE id = ${id}`;
  return toSong(rows[0]);
}

// ─── Express app factory ───────────────────────────────────────────────────────
export function createApp() {
  const app = express();
  app.use(express.json());

  // Lazy DB-init middleware — runs once per process, idempotent on Vercel cold starts
  let dbReady = false;
  app.use("/api", async (_req, res, next) => {
    if (!dbReady) {
      try {
        await initDb();
        dbReady = true;
      } catch (e: any) {
        return res.status(503).json({ error: "DB init failed: " + e.message });
      }
    }
    next();
  });

  // ── Songs CRUD ─────────────────────────────────────────────────────────────
  app.get("/api/songs", async (_req, res) => {
    try {
      const rows = await getDb()`SELECT * FROM songs ORDER BY created_at`;
      res.json(rows.map(toSong));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/songs", async (req, res) => {
    const { title, artist, album, coverUrl, duration, audioUrl, youtubeId } = req.body;
    if (!title || !artist || !audioUrl)
      return res.status(400).json({ error: "title, artist, and audioUrl are required" });
    try {
      const song = await saveSong({ title, artist, album, coverUrl, duration, audioUrl, youtubeId });
      res.json(song);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/songs/:id", async (req, res) => {
    try {
      const db = getDb();
      await db`DELETE FROM playlist_songs WHERE song_id = ${req.params.id}`;
      await db`DELETE FROM songs WHERE id = ${req.params.id}`;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── YouTube: single video info ─────────────────────────────────────────────
  app.post("/api/youtube/info", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    const videoId = extractYoutubeId(url);
    if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });
    try {
      const info = await invidiousVideoInfo(videoId);
      const duration = Math.floor(info.lengthSeconds || 0);
      const rawTitle: string = info.title || "Unknown";
      const channel: string = info.author || "Unknown Artist";
      let title = rawTitle, artist = channel;
      if (rawTitle.includes(" - ")) {
        const [a, ...r] = rawTitle.split(" - ");
        artist = a.trim();
        title = r.join(" - ").trim();
      }
      const thumbs: any[] = info.videoThumbnails || [];
      const thumb =
        thumbs.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]?.url || "";
      res.json({
        videoId, title, artist, album: "YouTube",
        coverUrl: thumb, duration, audioUrl: `/api/stream/${videoId}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Could not fetch video info: " + err.message });
    }
  });

  // ── YouTube: audio stream ──────────────────────────────────────────────────
  // Returns JSON { url: "..." } — the REAL audio URL the browser should play.
  // The frontend sets audio.src directly to this URL (no server redirect chain).
  // Strategy:
  //   1. Piped API  — pipedproxy-* URLs, not IP-bound, work from any browser.
  //   2. Invidious latest_version?local=true  — fallback proxy.
  app.get("/api/stream/:videoId", async (req, res) => {
    const { videoId } = req.params;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return res.status(400).json({ error: "Invalid video ID" });
    try {
      // ── 1. Piped ─────────────────────────────────────────────────────────
      const pipedUrl = await pipedAudioUrl(videoId);
      if (pipedUrl) {
        return res.json({ url: pipedUrl });
      }

      // ── 2. Invidious fallback ─────────────────────────────────────────────
      const info = await invidiousVideoInfo(videoId);
      const base: string = info._base;
      const formats: any[] = info.adaptiveFormats || [];
      const audioFormat =
        formats.find((f: any) => f.itag === 140) ||
        formats.find((f: any) => f.itag === 251) ||
        formats.find((f: any) => f.itag === 250) ||
        formats.find((f: any) => f.itag === 249) ||
        formats.find((f: any) => (f.type as string)?.startsWith("audio/"));
      const itag = audioFormat?.itag ?? 140;
      const proxyUrl = `${base}/latest_version?id=${videoId}&itag=${itag}&local=true`;
      return res.json({ url: proxyUrl });
    } catch (err: any) {
      res.status(502).json({ error: "Stream unavailable: " + err.message });
    }
  });

  // ── YouTube playlist import (SSE) ──────────────────────────────────────────
  app.post("/api/import/youtube-playlist", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    sSEHeaders(res);
    const normalizedUrl = url.replace("music.youtube.com", "www.youtube.com");
    const playlistId = extractYoutubePlaylistId(normalizedUrl);
    if (!playlistId) {
      sseWrite(res, { type: "error", message: "Invalid YouTube playlist URL. URL must contain ?list=..." });
      return res.end();
    }
    try {
      sseWrite(res, { type: "info", message: "Fetching playlist info..." });
      const entries = await invidiousFetchPlaylist(playlistId);
      if (entries.length === 0) {
        sseWrite(res, { type: "error", message: "Playlist is empty or private." });
        return res.end();
      }
      const total = entries.length;
      sseWrite(res, { type: "total", total });
      const importedSongs: any[] = [];
      for (let i = 0; i < entries.length; i++) {
        const { videoId, title: rawTitle, channel } = entries[i];
        let title = rawTitle, artist = channel;
        if (rawTitle.includes(" - ")) {
          const [a, ...r] = rawTitle.split(" - ");
          artist = a.trim();
          title = r.join(" - ").trim();
        }
        const thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
        try {
          const song = await saveSong({
            title, artist, album: "YouTube Playlist",
            coverUrl: thumb, duration: 0,
            audioUrl: `/api/stream/${videoId}`, youtubeId: videoId,
          });
          importedSongs.push(song);
          sseWrite(res, { type: "progress", current: i + 1, total, song });
        } catch {
          sseWrite(res, { type: "skip", current: i + 1, total, reason: "Duplicate" });
        }
      }
      sseWrite(res, { type: "done", songs: importedSongs });
    } catch (err: any) {
      sseWrite(res, { type: "error", message: "Failed to import playlist: " + err.message });
    }
    res.end();
  });

  // ── Spotify playlist import (SSE) ──────────────────────────────────────────
  app.post("/api/import/spotify-playlist", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    sSEHeaders(res);
    const playlistId = extractSpotifyPlaylistId(url);
    if (!playlistId) {
      sseWrite(res, { type: "error", message: "Invalid Spotify playlist URL." });
      return res.end();
    }
    try {
      sseWrite(res, { type: "info", message: "Connecting to Spotify..." });
      const token = await spotifyToken();
      sseWrite(res, { type: "info", message: "Fetching playlist tracks..." });
      const tracks = await spotifyPlaylistTracks(playlistId, token);
      if (tracks.length === 0) {
        sseWrite(res, { type: "error", message: "Playlist is empty or private." });
        return res.end();
      }
      const total = tracks.length;
      sseWrite(res, { type: "total", total });
      const importedSongs: any[] = [];
      for (let i = 0; i < tracks.length; i++) {
        const { title, artist, album, coverUrl } = tracks[i];
        sseWrite(res, { type: "searching", current: i + 1, total, track: `${artist} - ${title}` });
        try {
          const videoId = await invidiousSearch(`${artist} ${title} official audio`);
          if (!videoId) {
            sseWrite(res, { type: "skip", current: i + 1, total, reason: `No YouTube match for: ${title}` });
            continue;
          }
          const song = await saveSong({
            title, artist, album, coverUrl,
            audioUrl: `/api/stream/${videoId}`, youtubeId: videoId,
          });
          importedSongs.push(song);
          sseWrite(res, { type: "progress", current: i + 1, total, song });
        } catch (e: any) {
          sseWrite(res, { type: "skip", current: i + 1, total, reason: e.message });
        }
      }
      sseWrite(res, { type: "done", songs: importedSongs });
    } catch (err: any) {
      sseWrite(res, { type: "error", message: err.message });
    }
    res.end();
  });

  // ── Playlists CRUD ─────────────────────────────────────────────────────────
  app.get("/api/playlists", async (_req, res) => {
    try {
      const db = getDb();
      const pls = await db`SELECT * FROM playlists`;
      const result = await Promise.all(
        pls.map(async (p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          songs: (
            await db`
              SELECT s.* FROM songs s
              JOIN playlist_songs ps ON s.id = ps.song_id
              WHERE ps.playlist_id = ${p.id}
            `
          ).map(toSong),
        }))
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/playlists", async (req, res) => {
    const { id, name, songs } = req.body;
    try {
      const db = getDb();
      await db`INSERT INTO playlists (id, name) VALUES (${id}, ${name})`;
      for (const s of songs)
        await db`INSERT INTO playlist_songs (playlist_id, song_id) VALUES (${id}, ${s.id}) ON CONFLICT DO NOTHING`;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/playlists/:id", async (req, res) => {
    try {
      const db = getDb();
      await db`DELETE FROM playlist_songs WHERE playlist_id = ${req.params.id}`;
      await db`DELETE FROM playlists WHERE id = ${req.params.id}`;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/playlists/:id", async (req, res) => {
    try {
      await getDb()`UPDATE playlists SET name = ${req.body.name} WHERE id = ${req.params.id}`;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/playlists/:id/songs", async (req, res) => {
    try {
      await getDb()`
        INSERT INTO playlist_songs (playlist_id, song_id)
        VALUES (${req.params.id}, ${req.body.songId})
        ON CONFLICT DO NOTHING
      `;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/playlists/:id/songs/:songId", async (req, res) => {
    try {
      await getDb()`
        DELETE FROM playlist_songs
        WHERE playlist_id = ${req.params.id} AND song_id = ${req.params.songId}
      `;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
