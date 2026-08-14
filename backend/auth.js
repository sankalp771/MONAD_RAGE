/**
 * auth.js — wallet-signature verification for write endpoints.
 *
 * Every write (profile, roast content, challenge) must carry:
 *   { ts, signature } alongside its normal fields.
 *
 * The client signs a deterministic plain-text message (personal_sign) built
 * from the request fields; the server rebuilds the exact same message and
 * recovers the signer. The message embeds the payload, so a captured
 * signature can't be replayed with different content, and embeds a
 * timestamp, so it expires after MAX_AGE_SECONDS.
 *
 * The message builders here MUST stay byte-identical to
 * frontend/lib/signing.ts.
 */

const { ethers } = require("ethers");

const MAX_AGE_SECONDS = 10 * 60;

function profileMessage({ address, username, bio, avatar_url, ts }) {
  return (
    `RoastArena profile update\n` +
    `address: ${address.toLowerCase()}\n` +
    `username: ${username}\n` +
    `bio: ${bio}\n` +
    `avatar: ${avatar_url}\n` +
    `ts: ${ts}`
  );
}

function contentMessage({ roastId, author, content, ts }) {
  return (
    `RoastArena roast submission\n` +
    `roast: ${roastId}\n` +
    `address: ${author.toLowerCase()}\n` +
    `ts: ${ts}\n\n` +
    content
  );
}

function challengeMessage({ roastId, creator, title, description, media_url, ts }) {
  return (
    `RoastArena challenge\n` +
    `roast: ${roastId}\n` +
    `address: ${creator.toLowerCase()}\n` +
    `ts: ${ts}\n` +
    `title: ${title}\n` +
    `description: ${description}\n` +
    `media: ${media_url}`
  );
}

/**
 * Verify that `signature` over `message` recovers `address` and that `ts`
 * is a fresh unix timestamp. Returns null on success, or an error string.
 */
function verifySigned({ address, message, signature, ts }) {
  const tsNum = Number(ts);
  if (!Number.isInteger(tsNum)) return "Missing or invalid ts";
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_AGE_SECONDS) return "Signature expired — retry";
  if (!signature || typeof signature !== "string") return "Missing signature";

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return "Invalid signature";
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return "Signature does not match address";
  }
  return null;
}

module.exports = { profileMessage, contentMessage, challengeMessage, verifySigned };
