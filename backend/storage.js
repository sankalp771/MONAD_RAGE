/**
 * storage.js — file storage abstraction
 *
 * Currently: local filesystem (./uploads/)
 *
 * To switch to cloud (S3, R2, Cloudinary, etc.), replace saveFile() only.
 * The rest of the app never imports from here directly — only index.js uses it.
 */

const path = require("path");
const fs   = require("fs");
const crypto = require("crypto");

const UPLOAD_DIR = path.join(__dirname, "uploads");

// Ensure the upload directory exists on startup
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Save a file buffer to storage and return its public URL.
 *
 * @param {Buffer} buffer       - File contents
 * @param {string} originalName - Original filename (used for extension)
 * @returns {Promise<string>}   - Public URL to access the file
 *
 * ── To switch to cloud ──────────────────────────────────────────────────────
 * Replace the body of this function with an SDK upload, e.g.:
 *
 *   const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
 *   const s3 = new S3Client({ region: process.env.AWS_REGION });
 *   const key = `uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
 *   await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer }));
 *   return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;
 * ────────────────────────────────────────────────────────────────────────────
 */
async function saveFile(buffer, originalName) {
  const ext  = path.extname(originalName).toLowerCase() || ".bin";
  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveFile, UPLOAD_DIR };
