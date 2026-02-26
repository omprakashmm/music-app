import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import https from "https";
import { config as dotenvConfig } from "dotenv";

// Load .env from project root
dotenvConfig();

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Env vars (set via .env or environment)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";

// ─── Database ──────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || "music.db";
// Ensure parent directory exists (critical for Railway /data volume mount)
const DB_DIR = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT DEFAULT 'Unknown Album',
    coverUrl TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    audioUrl TEXT NOT NULL,
    youtubeId TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id TEXT,
    song_id TEXT,
    FOREIGN KEY(playlist_id) REFERENCES playlists(id),
    FOREIGN KEY(song_id) REFERENCES songs(id),
    PRIMARY KEY(playlist_id, song_id)
  );
`);
try { db.exec(`ALTER TABLE songs ADD COLUMN youtubeId TEXT DEFAULT ''`); } catch { /* column exists */ }

// ─── Helpers ───────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).substr(2, 9); }

function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
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

/** SSE utility: write one event */
function sseWrite(res: any, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (res.flush) res.flush();
}

/** Set up SSE headers */
function sSEHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/** Run yt-dlp and get JSON info for a single video */
async function ytInfo(videoId: string): Promise<any> {
  const { stdout } = await execAsync(
    `yt-dlp -j --no-playlist --no-check-certificates "https://www.youtube.com/watch?v=${videoId}"`,
    { timeout: 30000 }
  );
  return JSON.parse(stdout);
}

/** Search YouTube for a query, return first video ID */
async function ytSearch(query: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp "ytsearch1:${query.replace(/"/g, '')}" --get-id --no-playlist --no-check-certificates`,
      { timeout: 30000 }
    );
    return stdout.trim().split("\n")[0] || null;
  } catch { return null; }
}

/** Fetch a URL with curl (avoids Node.js TLS issues on cloud) */
async function curlJson(url: string, timeoutSec = 15): Promise<any> {
  const { stdout } = await execAsync(
    `curl -s -L --max-time ${timeoutSec} --retry 0 --insecure -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
    { timeout: (timeoutSec + 5) * 1000 }
  );
  const trimmed = stdout.trim();
  if (!trimmed || trimmed[0] !== '{' && trimmed[0] !== '[') throw new Error("Not JSON: " + trimmed.slice(0, 80));
  return JSON.parse(trimmed);
}

/** Fetch playlist via public Invidious instances (no bot-blocking, cloud-safe) */
async function invidiousFetchPlaylist(playlistId: string): Promise<{ videoId: string; title: string; channel: string }[]> {
  // Maintained list: https://api.invidious.io/instances.json
  const INSTANCES = [
    "https://inv.nadeko.net",
    "https://invidious.privacydev.net",
    "https://invidious.epicsite.xyz",
    "https://iv.ggtyler.dev",
    "https://invidious.nikkosphere.com",
    "https://yt.artemislena.eu",
    "https://invidious.perennialte.ch",
    "https://invidious.fdn.fr",
    "https://invidious.slipfox.xyz",
  ];
  const errors: string[] = [];
  for (const base of INSTANCES) {
    try {
      const videos: any[] = [];
      let page = 1;
      while (true) {
        const data = await curlJson(`${base}/api/v1/playlists/${playlistId}?page=${page}`, 12);
        if (!data || data.error || !Array.isArray(data.videos) || data.videos.length === 0) break;
        videos.push(...data.videos);
        const total: number = data.videoCount || videos.length;
        if (videos.length >= total || page >= 10) break;
        page++;
      }
      if (videos.length > 0) {
        console.log(`✅ Invidious: got ${videos.length} videos from ${base}`);
        return videos.map(v => ({
          videoId: v.videoId,
          title: v.title || "Unknown",
          channel: v.author || "Unknown Artist",
        }));
      }
      errors.push(`${base}: empty response`);
    } catch (e: any) {
      errors.push(`${base}: ${e.message?.slice(0, 60)}`);
      console.warn(`⚠️  Invidious ${base} failed:`, e.message?.slice(0, 80));
      continue;
    }
  }
  throw new Error("All Invidious instances failed. Errors: " + errors.slice(0, 3).join(" | "));
}

/** Save a song to DB (returns the saved song row) */
function saveSong(s: { title: string; artist: string; album?: string; coverUrl?: string; duration?: number; audioUrl: string; youtubeId?: string }) {
  // Check for duplicate youtubeId
  if (s.youtubeId) {
    const existing: any = db.prepare("SELECT * FROM songs WHERE youtubeId = ?").get(s.youtubeId);
    if (existing) return existing;
  }
  const id = genId();
  db.prepare(
    "INSERT INTO songs (id, title, artist, album, coverUrl, duration, audioUrl, youtubeId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, s.title, s.artist, s.album || "Unknown Album",
    s.coverUrl || `https://picsum.photos/seed/${id}/400/400`,
    s.duration || 0, s.audioUrl, s.youtubeId || "");
  return db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
}

/** Make an HTTPS request and return parsed JSON with clear error messages */
async function httpsJson(options: https.RequestOptions, body?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        const raw = data.trim();
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Not JSON — show the raw text so it's clear what went wrong
          return reject(new Error(`Spotify returned non-JSON (HTTP ${res.statusCode}): "${raw.slice(0, 120)}"`));
        }
        if (parsed.error) {
          return reject(new Error(`Spotify error: ${parsed.error_description || parsed.error?.message || JSON.stringify(parsed.error)}`));
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Get Spotify OAuth token */
async function spotifyToken(): Promise<string> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)
    throw new Error("Spotify credentials not set. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your Railway service → Variables tab.");
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const body = "grant_type=client_credentials";
  const data = await httpsJson({
    hostname: "accounts.spotify.com", path: "/api/token", method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);
  if (!data.access_token) throw new Error("Spotify did not return an access token. Check your Client ID and Secret.");
  return data.access_token;
}

/** Fetch all tracks from a Spotify playlist */
async function spotifyPlaylistTracks(playlistId: string, token: string): Promise<{ title: string; artist: string; album: string; coverUrl: string }[]> {
  const tracks: any[] = [];
  let url: string | null = `/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,album(name,images)))`;
  while (url) {
    const data = await httpsJson({
      hostname: "api.spotify.com", path: url, method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
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

// ─── Express App ───────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000");
  app.use(express.json());

  // ── Songs CRUD ────────────────────────────────────────────────────────────
  app.get("/api/songs", (_req, res) => {
    res.json(db.prepare("SELECT * FROM songs ORDER BY rowid").all());
  });

  app.post("/api/songs", (req, res) => {
    const { title, artist, album, coverUrl, duration, audioUrl, youtubeId } = req.body;
    if (!title || !artist || !audioUrl)
      return res.status(400).json({ error: "title, artist, and audioUrl are required" });
    try {
      const song = saveSong({ title, artist, album, coverUrl, duration, audioUrl, youtubeId });
      res.json(song);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/songs/:id", (req, res) => {
    db.prepare("DELETE FROM playlist_songs WHERE song_id = ?").run(req.params.id);
    db.prepare("DELETE FROM songs WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ── YouTube: single video info ─────────────────────────────────────────────
  app.post("/api/youtube/info", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    const videoId = extractYoutubeId(url);
    if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });
    try {
      const info = await ytInfo(videoId);
      const duration = Math.floor(info.duration || 0);
      const rawTitle: string = info.title || "Unknown";
      const channel: string = info.channel || info.uploader || "Unknown Artist";
      let title = rawTitle, artist = channel;
      if (rawTitle.includes(" - ")) { const [a, ...r] = rawTitle.split(" - "); artist = a.trim(); title = r.join(" - ").trim(); }
      const thumbs: any[] = info.thumbnails || [];
      const thumb = thumbs.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || "";
      res.json({ videoId, title, artist, album: "YouTube", coverUrl: thumb, duration, audioUrl: `/api/stream/${videoId}` });
    } catch (err: any) {
      res.status(500).json({ error: "Could not fetch video info. It may be unavailable or region-locked." });
    }
  });

  // ── YouTube: audio proxy stream ────────────────────────────────────────────
  app.get("/api/stream/:videoId", async (req, res) => {
    const { videoId } = req.params;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return res.status(400).json({ error: "Invalid video ID" });

    // Collect the full audio into a buffer first so we can serve byte-range
    // requests (which browsers require for seeking in <audio>).
    const ytdlp = spawn("yt-dlp", [
      "-f", "bestaudio[ext=m4a]/bestaudio/best",
      "--no-playlist", "--no-check-certificates", "-o", "-",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    const chunks: Buffer[] = [];
    ytdlp.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ytdlp.stderr.on("data", (d: Buffer) => { if (d.toString().includes("ERROR")) console.error("yt-dlp:", d.toString()); });
    req.on("close", () => ytdlp.kill());
    ytdlp.on("error", (e) => { if (!res.headersSent) res.status(500).end(); });

    ytdlp.stdout.on("end", () => {
      const buf = Buffer.concat(chunks);
      const total = buf.length;
      const rangeHeader = req.headers.range;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "audio/mpeg");

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunkSize = end - start + 1;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", chunkSize);
        res.status(206).end(buf.slice(start, end + 1));
      } else {
        res.setHeader("Content-Length", total);
        res.status(200).end(buf);
      }
    });
  });

  // ── YouTube: import playlist (SSE) ─────────────────────────────────────────
  app.post("/api/import/youtube-playlist", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });

    sSEHeaders(res);

    // Accept both youtube.com and music.youtube.com URLs
    const normalizedUrl = url.replace("music.youtube.com", "www.youtube.com");
    const playlistId = extractYoutubePlaylistId(normalizedUrl);
    if (!playlistId) {
      sseWrite(res, { type: "error", message: "Invalid YouTube playlist URL. URL must contain ?list=..." });
      return res.end();
    }

    try {
      sseWrite(res, { type: "info", message: "Fetching playlist info..." });

      // ── Strategy 1: Invidious API (cloud-safe, no bot detection) ───────────
      let entries: { videoId: string; title: string; channel: string }[] = [];
      let fetchedVia = "invidious";

      try {
        const invVideos = await invidiousFetchPlaylist(playlistId);
        entries = invVideos;
        sseWrite(res, { type: "info", message: `Found ${entries.length} tracks via Invidious.` });
      } catch (invErr: any) {
        // ── Strategy 2: yt-dlp fallback ────────────────────────────────────
        sseWrite(res, { type: "info", message: "Invidious unavailable, trying yt-dlp fallback..." });
        fetchedVia = "yt-dlp";
        const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
        try {
          const result = await execAsync(
            `yt-dlp --flat-playlist --dump-single-json --no-warnings --no-check-certificates "${playlistUrl}"`,
            { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
          );
          const playlistData = JSON.parse(result.stdout);
          const rawEntries: any[] = playlistData?.entries || [];
          for (const item of rawEntries) {
            const videoId = item?.id || (item?.url || "").replace("https://www.youtube.com/watch?v=", "");
            if (!videoId) continue;
            entries.push({
              videoId,
              title: item?.title || "Unknown",
              channel: item?.uploader || item?.channel || item?.uploader_id || "Unknown Artist",
            });
          }
          sseWrite(res, { type: "info", message: `Found ${entries.length} tracks via yt-dlp.` });
        } catch (ytErr: any) {
          const msg: string = ytErr.stderr || ytErr.message || "";
          sseWrite(res, { type: "error", message: "Import failed: " + (msg.includes("private") ? "Playlist is private or unavailable." : msg.slice(0, 200)) });
          return res.end();
        }
      }

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
          artist = a.trim(); title = r.join(" - ").trim();
        }
        const thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
        try {
          const song = saveSong({ title, artist, album: "YouTube Playlist", coverUrl: thumb, duration: 0, audioUrl: `/api/stream/${videoId}`, youtubeId: videoId });
          importedSongs.push(song);
          sseWrite(res, { type: "progress", current: i + 1, total, song });
        } catch {
          sseWrite(res, { type: "skip", current: i + 1, total, reason: "Duplicate" });
        }
      }

      sseWrite(res, { type: "done", songs: importedSongs });
    } catch (err: any) {
      console.error("Playlist import error:", err.message);
      sseWrite(res, { type: "error", message: "Failed to import playlist: " + err.message });
    }
    res.end();
  });

  // ── Spotify: import playlist (SSE) ─────────────────────────────────────────
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
      const total = tracks.length;

      if (total === 0) {
        sseWrite(res, { type: "error", message: "Playlist is empty or private." });
        return res.end();
      }

      sseWrite(res, { type: "total", total });
      const importedSongs: any[] = [];

      for (let i = 0; i < tracks.length; i++) {
        const { title, artist, album, coverUrl } = tracks[i];
        sseWrite(res, { type: "searching", current: i + 1, total, track: `${artist} - ${title}` });
        try {
          const videoId = await ytSearch(`${artist} ${title} official audio`);
          if (!videoId) { sseWrite(res, { type: "skip", current: i + 1, total, reason: `No YouTube match for: ${title}` }); continue; }
          const song = saveSong({ title, artist, album, coverUrl, audioUrl: `/api/stream/${videoId}`, youtubeId: videoId });
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
  app.get("/api/playlists", (_req, res) => {
    const pls = db.prepare("SELECT * FROM playlists").all();
    res.json(pls.map((p: any) => ({
      ...p,
      songs: db.prepare("SELECT s.* FROM songs s JOIN playlist_songs ps ON s.id = ps.song_id WHERE ps.playlist_id = ?").all(p.id),
    })));
  });

  app.post("/api/playlists", (req, res) => {
    const { id, name, songs } = req.body;
    db.prepare("INSERT INTO playlists (id, name) VALUES (?, ?)").run(id, name);
    const ins = db.prepare("INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)");
    for (const s of songs) ins.run(id, s.id);
    res.json({ success: true });
  });

  app.delete("/api/playlists/:id", (req, res) => {
    db.prepare("DELETE FROM playlist_songs WHERE playlist_id = ?").run(req.params.id);
    db.prepare("DELETE FROM playlists WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.put("/api/playlists/:id", (req, res) => {
    db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(req.body.name, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/playlists/:id/songs", (req, res) => {
    db.prepare("INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)").run(req.params.id, req.body.songId);
    res.json({ success: true });
  });

  app.delete("/api/playlists/:id/songs/:songId", (req, res) => {
    db.prepare("DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?").run(req.params.id, req.params.songId);
    res.json({ success: true });
  });

  // ── Vite ──────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`🎵 SonicStream running on http://localhost:${PORT}`));
}

startServer();

