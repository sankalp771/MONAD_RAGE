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
 * Detect a real image type from the file's magic bytes.
 * Client-declared mimetypes and filenames are untrusted — an "image" that is
 * actually HTML would otherwise be stored with an .html extension and served
 * as text/html from our origin (stored XSS).
 *
 * @param {Buffer} buffer - File contents
 * @returns {{ext: string, mime: string} | null} null if not a supported image
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: ".jpg", mime: "image/jpeg" };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: ".png", mime: "image/png" };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { ext: ".gif", mime: "image/gif" };
  }
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { ext: ".webp", mime: "image/webp" };
  }
  return null;
}

/**
 * Save a file buffer to storage and return its public URL.
 * The extension comes from magic-byte detection, never from the client.
 *
 * @param {Buffer} buffer - File contents (must be a supported image)
 * @param {string} ext    - Extension from detectImageType (e.g. ".png")
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
async function saveFile(buffer, ext) {
  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveFile, detectImageType, UPLOAD_DIR };
