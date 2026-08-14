require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const multer  = require("multer");
const path    = require("path");
const { ethers } = require("ethers");
const { startListener } = require("./listener");
const { saveFile, detectImageType, UPLOAD_DIR } = require("./storage");
const { profileMessage, contentMessage, challengeMessage, verifySigned } = require("./auth");
const { isArenaCreator, isParticipant } = require("./chain");
const {
  initDB,
  upsertProfile,
  getProfile,
  upsertContent,
  getExistingContent,
  getContentForRoast,
  upsertChallengeContent,
  getChallengeContentById,
  getRecentRoasts,
  getRoastById,
  getParticipantRoasts,
} = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

// Multer — memory storage so saveFile() decides where bytes go
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.use(cors());
app.use(express.json());
// Serve uploaded files as static assets.
// Everything in here is user-supplied — lock down how browsers interpret it.
app.use("/uploads", express.static(UPLOAD_DIR, {
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Neutralizes script execution even if a non-image ever slips in
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
  },
}));

// Only our own /uploads paths or absolute https URLs may be stored as media —
// anything else (javascript:, data:, protocol-relative, …) is rejected.
function isSafeMediaUrl(url) {
  if (url === "") return true;
  if (url.startsWith("/uploads/") && !url.includes("..")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true }));

// ─── File Upload ─────────────────────────────────────────────────────────────

/**
 * POST /upload
 * Multipart form-data field: "file" (image/jpeg, png, gif, webp — max 10 MB)
 * Returns: { url } — public path to the saved file.
 */
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file or unsupported type (jpeg/png/gif/webp only)" });
  }
  // The multer fileFilter only sees the client-declared mimetype;
  // verify the actual bytes and derive the extension from them.
  const detected = detectImageType(req.file.buffer);
  if (!detected) {
    return res.status(400).json({ error: "File is not a valid JPEG/PNG/GIF/WebP image" });
  }
  try {
    const url = await saveFile(req.file.buffer, detected.ext);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── Profiles ────────────────────────────────────────────────────────────────

/**
 * GET /profile/:address
 * Returns profile for a wallet address. 200 with defaults if not set yet.
 */
app.get("/profile/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const profile = await getProfile(address);
    if (!profile) {
      return res.json({ address, username: "", avatar_url: "", bio: "" });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * POST /profile
 * Body: { address, username, avatar_url?, bio?, ts, signature }
 * Upserts profile. The wallet must sign the payload — see auth.js.
 */
app.post("/profile", async (req, res) => {
  const { address, username, avatar_url = "", bio = "", ts, signature } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  const authError = verifySigned({
    address,
    ts,
    signature,
    message: profileMessage({ address, username: username ?? "", bio, avatar_url, ts }),
  });
  if (authError) {
    return res.status(401).json({ error: authError });
  }
  if (!username || username.trim().length === 0) {
    return res.status(400).json({ error: "Username required" });
  }
  if (username.trim().length > 32) {
    return res.status(400).json({ error: "Username max 32 chars" });
  }

  try {
    await upsertProfile({
      address: address.toLowerCase(),
      username: username.trim(),
      avatar_url: avatar_url.slice(0, 200),
      bio: bio.slice(0, 160),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Roast Content ───────────────────────────────────────────────────────────

/**
 * POST /roast/:roastId/content
 * Body: { author, content, ts, signature }
 * Stores the actual roast text off-chain. One per address per roast.
 * The author wallet must sign the payload — see auth.js.
 */
app.post("/roast/:roastId/content", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  const { author, content, ts, signature } = req.body;

  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  if (!author || !ethers.isAddress(author)) {
    return res.status(400).json({ error: "Invalid author address" });
  }
  const authError = verifySigned({
    address: author,
    ts,
    signature,
    message: contentMessage({ roastId, author, content: content ?? "", ts }),
  });
  if (authError) {
    return res.status(401).json({ error: authError });
  }
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: "Content required" });
  }
  if (content.trim().length > 500) {
    return res.status(400).json({ error: "Content max 500 chars" });
  }

  try {
    let joined;
    try {
      joined = await isParticipant(roastId, author);
    } catch {
      return res.status(503).json({ error: "Could not verify participation — try again" });
    }
    if (!joined) {
      return res.status(403).json({ error: "Join the arena on-chain before submitting a roast" });
    }

    const existing = await getExistingContent(roastId, author.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "You have already submitted a roast for this arena" });
    }

    await upsertContent({
      roast_id: roastId,
      author:   author.toLowerCase(),
      content:  content.trim(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /roast/:roastId/content
 * Returns all roast submissions for an arena, joined with profiles.
 */
app.get("/roast/:roastId/content", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  try {
    const rows = await getContentForRoast(roastId);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Challenge Content ────────────────────────────────────────────────────────

/**
 * POST /roast/:roastId/challenge
 * Body: { creator, title, description?, media_url?, ts, signature }
 * Saves what the arena is about (the subject being roasted). One per arena.
 * The creator wallet must sign the payload — see auth.js.
 */
app.post("/roast/:roastId/challenge", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  const { creator, title, description = "", media_url = "", ts, signature } = req.body;

  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  if (!creator || !ethers.isAddress(creator)) {
    return res.status(400).json({ error: "Invalid creator address" });
  }
  const authError = verifySigned({
    address: creator,
    ts,
    signature,
    message: challengeMessage({ roastId, creator, title: title ?? "", description, media_url, ts }),
  });
  if (authError) {
    return res.status(401).json({ error: authError });
  }
  if (!title || title.trim().length === 0) {
    return res.status(400).json({ error: "Title required" });
  }
  if (title.trim().length > 100) {
    return res.status(400).json({ error: "Title max 100 chars" });
  }
  if (description.length > 500) {
    return res.status(400).json({ error: "Description max 500 chars" });
  }
  if (media_url.length > 500) {
    return res.status(400).json({ error: "Media URL max 500 chars" });
  }
  if (!isSafeMediaUrl(media_url.trim())) {
    return res.status(400).json({ error: "Media URL must be an /uploads/ path or an https:// URL" });
  }

  try {
    let isCreator;
    try {
      isCreator = await isArenaCreator(roastId, creator);
    } catch {
      return res.status(503).json({ error: "Could not verify arena creator — try again" });
    }
    if (!isCreator) {
      return res.status(403).json({ error: "Only the arena creator can set the challenge" });
    }

    await upsertChallengeContent({
      roast_id:    roastId,
      creator:     creator.toLowerCase(),
      title:       title.trim(),
      description: description.trim(),
      media_url:   media_url.trim(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /roast/:roastId/challenge
 * Returns the challenge subject content for an arena, or 404 if none.
 */
app.get("/roast/:roastId/challenge", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  try {
    const row = await getChallengeContentById(roastId);
    res.json(row ?? null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Roast Index ─────────────────────────────────────────────────────────────

/**
 * GET /roasts?limit=20
 * Returns recent roasts, newest first.
 */
app.get("/roasts", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  try {
    const rows = await getRecentRoasts(limit);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /roast/:roastId
 * Returns a single roast from the index.
 */
app.get("/roast/:roastId", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  try {
    const row = await getRoastById(roastId);
    if (!row) return res.status(404).json({ error: "Roast not found in index" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── User Roast History ───────────────────────────────────────────────────────

/**
 * GET /profile/:address/roasts
 * Returns all roasts a wallet has participated in.
 */
app.get("/profile/:address/roasts", async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const rows = await getParticipantRoasts(address);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[server] RoastArena backend running on port ${PORT}`);

  try {
    await initDB();
    console.log("[server] DB initialized successfully");
  } catch (err) {
    console.error("[server] DB init error:", err);
  }

  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.warn("[server] CONTRACT_ADDRESS not set — listener not started.");
    console.warn("[server] Deploy the contract first, then add it to .env");
    return;
  }

  startListener(contractAddress).catch(err =>
    console.error("[server] Listener startup error:", err.message)
  );
});
