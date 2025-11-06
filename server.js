// server.js — FREE self-hosted downloader (yt-dlp + ffmpeg)
// Use only for content you own/have permission to download.

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import ytdlp from "yt-dlp-exec";
import ffmpegStatic from "ffmpeg-static";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// ---- basic rate limit ----
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---- helpers ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_PLATFORMS = new Set(["youtube", "instagram", "tiktok", "twitter"]);
const ALLOWED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "youtu.be",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com"
]);

function isAllowedUrl(u) {
  try {
    const url = new URL(u);
    return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function publicBase(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`;
}

app.get("/", (_req, res) => res.send("Backend OK"));

// ---- MAIN API ----
app.post("/api/download", async (req, res) => {
  try {
    let { platform, url, format, quality } = req.body || {};

    platform = String(platform || "").toLowerCase();
    format = (format || "mp4").toLowerCase();
    quality = String(quality || "best");

    if (!ALLOWED_PLATFORMS.has(platform)) {
      return res.status(400).json({ success: false, message: "Invalid platform." });
    }
    if (!isAllowedUrl(url)) {
      return res.status(400).json({ success: false, message: "Invalid/unsupported URL." });
    }

    // MP4 path: return direct media URL (fast, no storage)
    if (format !== "mp3") {
      // pick best available
      const args = ["-f", quality === "highest" ? "best" : "best"];
      // "-g" prints direct media URL(s)
      const out = await ytdlp(url, { dumpSingleJson: false, getUrl: true, sync: true, args });
      // ytdlp returns a string with one or multiple lines; grab first http
      const lines = String(out || "").split(/\r?\n/).filter(Boolean);
      const direct = lines.find((l) => /^https?:\/\//i.test(l));
      if (!direct) {
        return res.status(200).json({ success: false, message: "Could not resolve media URL." });
      }
      return res.json({ success: true, downloadUrl: direct });
    }

    // MP3 path: extract audio -> save to /tmp -> give temporary link
    const id = nanoid(10);
    const outFile = `/tmp/${id}.mp3`;

    // yt-dlp audio extraction (needs ffmpeg)
    const env = { ...process.env, FFMPEG_PATH: ffmpegStatic || "" };

    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",
      output: outFile,
      restrictFilenames: true,
      noPlaylist: true,
      // pass ffmpeg path
      env,
    });

    // file must exist
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
      return res.status(200).json({ success: false, message: "MP3 conversion failed." });
    }

    // give temp link
    const link = `${publicBase(req)}/file/${id}`;
    return res.json({ success: true, downloadUrl: link });

  } catch (err) {
    console.error("Error:", err);
    const msg = (err && err.stderr) || (err && err.message) || "Server error";
    return res.status(500).json({ success: false, message: String(msg).slice(0, 400) });
  }
});

// ---- serve temp files & auto-clean ----
app.get("/file/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const file = `/tmp/${id}.mp3`;
  if (!fs.existsSync(file)) return res.status(404).send("File not found");

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${id}.mp3"`);
  const stream = fs.createReadStream(file);
  stream.pipe(res);
  stream.on("close", () => {
    // delete after send
    fs.unlink(file, () => {});
  });
});

// ---- periodic tmp cleanup (safety) ----
setInterval(() => {
  try {
    const dir = "/tmp";
    const now = Date.now();
    fs.readdirSync(dir)
      .filter((f) => f.endsWith(".mp3"))
      .forEach((f) => {
        const p = path.join(dir, f);
        const age = now - fs.statSync(p).mtimeMs;
        if (age > 30 * 60 * 1000) fs.unlink(p, () => {});
      });
  } catch {}
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
