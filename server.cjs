const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 4100;
const APP_NAME = "KyokaMusic";

// Load data
const tracks = JSON.parse(fs.readFileSync(path.join(__dirname, "audius_tracks.json"), "utf8"));
const byId = new Map(tracks.map(t => [t.id, t]));
console.log(`[+] ${tracks.length} track loaded`);

// Cache resolve URL (biar ga spam API Audius)
const streamCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

async function resolveStream(trackId) {
  const cached = streamCache.get(trackId);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.url;
  
  try {
    const r = await axios.get(
      `https://api.audius.co/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`,
      { maxRedirects: 0, validateStatus: () => true, timeout: 10000 }
    );
    if (r.status === 302 && r.headers.location) {
      streamCache.set(trackId, { url: r.headers.location, time: Date.now() });
      return r.headers.location;
    }
  } catch (e) {}
  return null;
}

// CORS biar member bisa akses dari domain mereka
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ============ ENDPOINTS ============

// 1. Stats
app.get("/api/stats", (req, res) => {
  res.json({
    total_tracks: tracks.length,
    total_artists: new Set(tracks.map(t => t.artist)).size,
    total_genres: new Set(tracks.map(t => t.genre)).size,
  });
});

// 2. List genre
app.get("/api/genres", (req, res) => {
  const g = [...new Set(tracks.map(t => t.genre))].sort();
  res.json(g);
});

// 3. List track (pagination + search + filter)
app.get("/api/tracks", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const q = (req.query.q || "").toLowerCase();
  const genre = req.query.genre;

  let list = tracks;
  if (genre) list = list.filter(t => t.genre === genre);
  if (q) list = list.filter(t =>
    t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  );

  const total = list.length;
  const items = list.slice((page - 1) * limit, page * limit).map(t => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    cover: t.cover,
    duration: t.duration,
    genre: t.genre,
    plays: t.plays,
  }));

  res.json({ 
    success: true,
    page, 
    limit, 
    total, 
    pages: Math.ceil(total / limit), 
    items 
  });
});

// 4. Detail track
app.get("/api/tracks/:id", (req, res) => {
  const t = byId.get(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: "not found" });
  res.json({ success: true, data: t });
});

// 5. Stream audio (redirect ke CDN Audius)
app.get("/api/stream/:id", async (req, res) => {
  const url = await resolveStream(req.params.id);
  if (!url) return res.status(404).json({ success: false, error: "stream not found" });
  const up = await axios.get(url, { responseType: "stream", timeout: 30000, headers: { "User-Agent": req.headers["user-agent"] || "Mozilla/5.0" } }); res.setHeader("Content-Type", up.headers["content-type"] || "audio/mpeg"); if (up.headers["content-length"]) res.setHeader("Content-Length", up.headers["content-length"]); res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Cache-Control", "public, max-age=3600"); up.data.pipe(res);
});

// 6. Random track
app.get("/api/random", (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 10, 50);
  const shuffled = [...tracks].sort(() => Math.random() - 0.5).slice(0, n);
  res.json({ success: true, items: shuffled.map(t => ({
    id: t.id, title: t.title, artist: t.artist, cover: t.cover, duration: t.duration,
  })) });
});

// Start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[+] Kyoka Music API: http://127.0.0.1:${PORT}`);
  console.log(`[+] Endpoints:`);
  console.log(`    GET /api/stats`);
  console.log(`    GET /api/genres`);
  console.log(`    GET /api/tracks?page=1&limit=30&q=search&genre=x`);
  console.log(`    GET /api/tracks/:id`);
  console.log(`    GET /api/stream/:id`);
  console.log(`    GET /api/random?n=10`);
});
