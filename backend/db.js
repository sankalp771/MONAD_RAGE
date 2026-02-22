require("dotenv").config();
const { createClient } = require("@libsql/client");
const path = require("path");

const dbUrl = process.env.TURSO_DATABASE_URL || "file:roastarena.db";

const db = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS profiles (
      address     TEXT PRIMARY KEY,
      username    TEXT NOT NULL DEFAULT '',
      avatar_url  TEXT NOT NULL DEFAULT '',
      bio         TEXT NOT NULL DEFAULT '',
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS roast_content (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      roast_id    INTEGER NOT NULL,
      author      TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      UNIQUE(roast_id, author)
    );

    CREATE TABLE IF NOT EXISTS roast_index (
      roast_id          INTEGER PRIMARY KEY,
      creator           TEXT NOT NULL,
      roast_stake       TEXT NOT NULL DEFAULT '0',   -- wei as string
      vote_stake        TEXT NOT NULL DEFAULT '0',   -- wei as string
      open_until        INTEGER NOT NULL,
      vote_until        INTEGER NOT NULL,
      state             TEXT NOT NULL DEFAULT 'OPEN',
      num_winners       INTEGER,
      roaster_pool      TEXT,                        -- wei as string
      voter_pool        TEXT,                        -- wei as string
      winner_voter_count INTEGER,
      tx_hash           TEXT,
      block_number      INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS participant_index (
      roast_id    INTEGER NOT NULL,
      address     TEXT NOT NULL,
      tx_hash     TEXT,
      PRIMARY KEY (roast_id, address)
    );

    CREATE TABLE IF NOT EXISTS challenge_content (
      roast_id     INTEGER PRIMARY KEY,
      creator      TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      media_url    TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS listener_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_roast    ON roast_content(roast_id);
    CREATE INDEX IF NOT EXISTS idx_content_author   ON roast_content(author);
    CREATE INDEX IF NOT EXISTS idx_participant_addr ON participant_index(address);
  `);
}

// ─── Profile Helpers ────────────────────────────────────────────────────────

async function upsertProfile(data) {
  return await db.execute({
    sql: `
      INSERT INTO profiles (address, username, avatar_url, bio, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(address) DO UPDATE SET
        username   = excluded.username,
        avatar_url = excluded.avatar_url,
        bio        = excluded.bio,
        updated_at = excluded.updated_at
    `,
    args: [data.address, data.username, data.avatar_url, data.bio]
  });
}

async function getProfile(address) {
  const result = await db.execute({
    sql: `SELECT * FROM profiles WHERE address = ?`,
    args: [address]
  });
  return result.rows[0];
}

// ─── Content Helpers ────────────────────────────────────────────────────────

async function upsertContent(data) {
  return await db.execute({
    sql: `
      INSERT INTO roast_content (roast_id, author, content)
      VALUES (?, ?, ?)
      ON CONFLICT(roast_id, author) DO UPDATE SET
        content    = excluded.content,
        created_at = strftime('%s', 'now')
    `,
    args: [data.roast_id, data.author, data.content]
  });
}

async function getExistingContent(roast_id, author) {
  const result = await db.execute({
    sql: `SELECT id FROM roast_content WHERE roast_id = ? AND author = ?`,
    args: [roast_id, author]
  });
  return result.rows[0] || null;
}

async function getContentForRoast(roast_id) {
  const result = await db.execute({
    sql: `
      SELECT rc.*, p.username, p.avatar_url
      FROM roast_content rc
      LEFT JOIN profiles p ON p.address = rc.author
      WHERE rc.roast_id = ?
      ORDER BY rc.created_at ASC
    `,
    args: [roast_id]
  });
  return result.rows;
}

// ─── Challenge Content Helpers ───────────────────────────────────────────────

async function upsertChallengeContent(data) {
  return await db.execute({
    sql: `
      INSERT INTO challenge_content (roast_id, creator, title, description, media_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(roast_id) DO UPDATE SET
        title       = excluded.title,
        description = excluded.description,
        media_url   = excluded.media_url
    `,
    args: [data.roast_id, data.creator, data.title, data.description, data.media_url]
  });
}

async function getChallengeContentById(roast_id) {
  const result = await db.execute({
    sql: `SELECT * FROM challenge_content WHERE roast_id = ?`,
    args: [roast_id]
  });
  return result.rows[0] || null;
}

// ─── Roast Index Helpers ────────────────────────────────────────────────────

async function insertRoast(data) {
  return await db.execute({
    sql: `
      INSERT OR IGNORE INTO roast_index
        (roast_id, creator, roast_stake, vote_stake, open_until, vote_until, tx_hash, block_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      data.roast_id, data.creator, data.roast_stake, data.vote_stake,
      data.open_until, data.vote_until, data.tx_hash, data.block_number
    ]
  });
}

async function updateRoastSettled(data) {
  return await db.execute({
    sql: `
      UPDATE roast_index
      SET state              = 'SETTLED',
          num_winners        = ?,
          roaster_pool       = ?,
          voter_pool         = ?,
          winner_voter_count = ?
      WHERE roast_id = ?
    `,
    args: [
      data.num_winners, data.roaster_pool, data.voter_pool,
      data.winner_voter_count, data.roast_id
    ]
  });
}

async function updateRoastCancelled(data) {
  return await db.execute({
    sql: `UPDATE roast_index SET state = 'CANCELLED' WHERE roast_id = ?`,
    args: [data.roast_id]
  });
}

async function getRecentRoasts(limit) {
  const result = await db.execute({
    sql: `
      SELECT ri.*, p.username as creator_username
      FROM roast_index ri
      LEFT JOIN profiles p ON p.address = ri.creator
      ORDER BY ri.roast_id DESC
      LIMIT ?
    `,
    args: [limit]
  });
  return result.rows;
}

async function getRoastById(roast_id) {
  const result = await db.execute({
    sql: `
      SELECT ri.*, p.username as creator_username
      FROM roast_index ri
      LEFT JOIN profiles p ON p.address = ri.creator
      WHERE ri.roast_id = ?
    `,
    args: [roast_id]
  });
  return result.rows[0];
}

// ─── Participant Index Helpers ──────────────────────────────────────────────

async function insertParticipant(data) {
  return await db.execute({
    sql: `
      INSERT OR IGNORE INTO participant_index (roast_id, address, tx_hash)
      VALUES (?, ?, ?)
    `,
    args: [data.roast_id, data.address, data.tx_hash]
  });
}

async function getParticipantRoasts(address) {
  const result = await db.execute({
    sql: `
      SELECT pi.roast_id, ri.state, ri.open_until, ri.vote_until,
             ri.roast_stake, ri.vote_stake, ri.num_winners
      FROM participant_index pi
      JOIN roast_index ri ON ri.roast_id = pi.roast_id
      WHERE pi.address = ?
      ORDER BY pi.roast_id DESC
    `,
    args: [address]
  });
  return result.rows;
}

// ─── Listener State ──────────────────────────────────────────────────────────

async function getListenerBlock() {
  const result = await db.execute({
    sql: `SELECT value FROM listener_state WHERE key = 'lastPolledBlock'`,
    args: []
  });
  return result.rows[0] ? parseInt(result.rows[0].value, 10) : null;
}

async function setListenerBlock(blockNumber) {
  return await db.execute({
    sql: `INSERT INTO listener_state (key, value) VALUES ('lastPolledBlock', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [String(blockNumber)]
  });
}

module.exports = {
  db,
  initDB,
  upsertProfile,
  getProfile,
  upsertContent,
  getExistingContent,
  getContentForRoast,
  upsertChallengeContent,
  getChallengeContentById,
  insertRoast,
  updateRoastSettled,
  updateRoastCancelled,
  getRecentRoasts,
  getRoastById,
  insertParticipant,
  getParticipantRoasts,
  getListenerBlock,
  setListenerBlock,
};
