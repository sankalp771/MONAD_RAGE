/**
 * backfill.js — one-time script to insert any arenas into roast_index
 * that exist in challenge_content but were missed by the listener.
 *
 * Run with: node backfill.js
 */
require("dotenv").config();
const { ethers } = require("ethers");
const { createClient } = require("@libsql/client");

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL || "file:roastarena.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ABI = [
  "function getRoast(uint256 roastId) view returns (tuple(uint256 id, address creator, uint256 openUntil, uint256 voteUntil, uint256 roastStake, uint256 voteStake, uint8 state, uint256 participantCount, uint256 totalVotes, uint256 roasterPool, uint256 voterPool, uint256 highestVotes, uint256 numWinners, uint256 winnerVoterCount))",
];

const STATE_NAMES = ["OPEN", "VOTING", "SETTLED", "CANCELLED"];

async function backfill() {
  const [ccResult, riResult] = await Promise.all([
    db.execute("SELECT roast_id FROM challenge_content ORDER BY roast_id"),
    db.execute("SELECT roast_id FROM roast_index"),
  ]);

  const indexed = new Set(riResult.rows.map((r) => Number(r.roast_id)));
  const missing = ccResult.rows
    .map((r) => Number(r.roast_id))
    .filter((id) => !indexed.has(id));

  console.log("challenge_content IDs:", ccResult.rows.map((r) => r.roast_id).join(", ") || "(none)");
  console.log("roast_index IDs:      ", riResult.rows.map((r) => r.roast_id).join(", ") || "(none)");
  console.log("Missing from index:   ", missing.join(", ") || "(none)");

  if (missing.length === 0) {
    console.log("\nNothing to backfill — all arenas are indexed.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.MONAD_RPC || "https://testnet-rpc.monad.xyz"
  );
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);

  for (const roastId of missing) {
    try {
      const r = await contract.getRoast(roastId);
      const state = STATE_NAMES[Number(r.state)] || "OPEN";
      await db.execute({
        sql: `INSERT OR IGNORE INTO roast_index
              (roast_id, creator, roast_stake, vote_stake, open_until, vote_until, state)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          roastId,
          r.creator.toLowerCase(),
          r.roastStake.toString(),
          r.voteStake.toString(),
          Number(r.openUntil),
          Number(r.voteUntil),
          state,
        ],
      });
      console.log(`  Backfilled roast #${roastId} — creator: ${r.creator} state: ${state}`);
    } catch (e) {
      console.error(`  Failed for roast #${roastId}:`, e.message);
    }
  }

  const after = await db.execute("SELECT roast_id, state, creator FROM roast_index ORDER BY roast_id");
  console.log("\nroast_index after backfill:");
  after.rows.forEach((r) => console.log(`  #${r.roast_id} ${r.state} ${r.creator}`));
}

backfill().catch(console.error);
