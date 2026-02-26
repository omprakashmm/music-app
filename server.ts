import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
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
    `yt-dlp -j --no-playlist "https://www.youtube.com/watch?v=${videoId}"`,
    { timeout: 30000 }
  );
  return JSON.parse(stdout);
}

/** Search YouTube for a query, return first video ID */
async function ytSearch(query: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp "ytsearch1:${query.replace(/"/g, '')}" --get-id --no-playlist`,
      { timeout: 20000 }
    );
    return stdout.trim().split("\n")[0] || null;
  } catch { return null; }
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

/** Get Spotify OAuth token */
async function spotifyToken(): Promise<string> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)
    throw new Error("Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.");
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  return new Promise((resolve, reject) => {
    const body = "grant_type=client_credentials";
    const req = https.request({
      hostname: "accounts.spotify.com", path: "/api/token", method: "POST",
      headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": body.length },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data).access_token); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Fetch all tracks from a Spotify playlist */
async function spotifyPlaylistTracks(playlistId: string, token: string): Promise<{ title: string; artist: string; album: string; coverUrl: string }[]> {
  const tracks: any[] = [];
  let url: string | null = `/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,album(name,images)))`;
  while (url) {
    const data: any = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.spotify.com", path: url, method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      }, (res) => {
        let d = ""; res.on("data", c => d += c);
        res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req.on("error", reject); req.end();
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
      "--no-playlist", "-o", "-",
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
      sseWrite(res, { type: "info", message: "Fetching playlist info via yt-dlp..." });

      // Use yt-dlp to fetch all playlist entries (no HTML scraping, works in cloud)
      const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      let ytdlpOut: string;
      try {
        const result = await execAsync(
          `yt-dlp --flat-playlist --dump-single-json --no-warnings "${playlistUrl}"`,
          { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
        );
        ytdlpOut = result.stdout;
      } catch (e: any) {
        const msg: string = e.stderr || e.message || "";
        if (msg.includes("private") || msg.includes("unavailable")) {
          sseWrite(res, { type: "error", message: "Playlist is private or unavailable." });
        } else {
          sseWrite(res, { type: "error", message: "yt-dlp failed: " + msg.slice(0, 200) });
        }
        return res.end();
      }

      let playlistData: any;
      try { playlistData = JSON.parse(ytdlpOut); } catch {
        sseWrite(res, { type: "error", message: "Failed to parse yt-dlp playlist output." });
        return res.end();
      }

      const rawEntries: any[] = playlistData?.entries || [];

      if (rawEntries.length === 0) {
        sseWrite(res, { type: "error", message: "Playlist is empty or private." });
        return res.end();
      }

      // Extract video entries
      const entries: { videoId: string; title: string; channel: string }[] = [];
      for (const item of rawEntries) {
        const videoId = item?.id || item?.url?.replace("https://www.youtube.com/watch?v=", "");
        if (!videoId) continue;
        const title = item?.title || "Unknown";
        const channel = item?.uploader || item?.channel || item?.uploader_id || "Unknown Artist";
        entries.push({ videoId, title, channel });
      }

      if (entries.length === 0) {
        sseWrite(res, { type: "error", message: "No playable videos found in this playlist." });
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
        // Use YouTube thumbnail URL directly (no extra API call needed)
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

