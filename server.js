// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Backend OK");
});

app.post("/api/download", (req, res) => {
  const { platform, url, format, quality } = req.body || {};
  if (!platform || !url) {
    return res.status(400).json({ success: false, message: "Missing platform or url" });
  }
  try { new URL(url); } catch { return res.status(400).json({ success: false, message: "Invalid URL" }); }

  const ext = (format === "mp3") ? "mp3" : (format === "jpg" ? "jpg" : "mp4");
  const fake = `https://example.com/mock/${encodeURIComponent(platform)}_${Date.now()}.${ext}`;
  return res.json({ success: true, downloadUrl: fake, message: "Mock link (testing only)" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
