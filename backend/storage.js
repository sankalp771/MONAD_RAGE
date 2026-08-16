/**
 * storage.js — file storage abstraction
 *
 * With CLOUDINARY_URL set (cloudinary://api_key:api_secret@cloud_name),
 * uploads go to Cloudinary and survive redeploys. Without it, files land in
 * the local ./uploads/ folder — fine for dev, but ephemeral on Render.
 */

const path = require("path");
const fs   = require("fs");
const crypto = require("crypto");

const UPLOAD_DIR = path.join(__dirname, "uploads");

// Ensure the upload directory exists on startup (local fallback + static serving)
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// The cloudinary SDK configures itself from CLOUDINARY_URL
let cloudinary = null;
if (process.env.CLOUDINARY_URL) {
  cloudinary = require("cloudinary").v2;
  console.log("[storage] Cloudinary enabled — uploads persist in the cloud");
} else {
  console.log("[storage] CLOUDINARY_URL not set — uploads stored locally (ephemeral on Render)");
}

function uploadToCloudinary(buffer, ext) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "roastarena",
        resource_type: "image",
        // Keep the detected extension in the delivered URL so the frontend's
        // image-extension check renders it as an <img>
        format: ext.slice(1),
      },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
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
 */
async function saveFile(buffer, ext) {
  if (cloudinary) {
    return uploadToCloudinary(buffer, ext);
  }
  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveFile, detectImageType, UPLOAD_DIR };
