/**
 * chain.js — read-only contract checks used to authorize off-chain writes.
 *
 * The DB index (filled by the listener) is checked first to avoid RPC calls;
 * the chain is the fallback so writes that race the listener still work.
 */

const { ethers } = require("ethers");
const { db } = require("./db");

const ABI = [
  "function getRoast(uint256 roastId) view returns (tuple(uint256 id, address creator, uint256 openUntil, uint256 voteUntil, uint256 roastStake, uint256 voteStake, uint8 state, uint256 participantCount, uint256 totalVotes, uint256 roasterPool, uint256 voterPool, uint256 highestVotes, uint256 numWinners, uint256 winnerVoterCount))",
  "function hasJoined(uint256, address) view returns (bool)",
];

let contract = null;
function getContract() {
  if (contract) return contract;
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) return null;
  const provider = new ethers.JsonRpcProvider(
    process.env.MONAD_RPC || "https://testnet-rpc.monad.xyz"
  );
  contract = new ethers.Contract(address, ABI, provider);
  return contract;
}

/**
 * True if `address` is the creator of arena `roastId`.
 * Checks the DB index first, then the chain.
 * Throws if neither source can answer (caller should 503).
 */
async function isArenaCreator(roastId, address) {
  const addr = address.toLowerCase();

  const result = await db.execute({
    sql: `SELECT creator FROM roast_index WHERE roast_id = ?`,
    args: [roastId],
  }).catch(() => null);
  if (result && result.rows[0]) {
    return result.rows[0].creator.toLowerCase() === addr;
  }

  const c = getContract();
  if (!c) throw new Error("Chain verification unavailable");
  const roast = await c.getRoast(roastId);
  return roast.creator.toLowerCase() === addr;
}

/**
 * True if `address` joined arena `roastId` as a roaster.
 * Checks the DB index first, then the chain.
 * Throws if neither source can answer (caller should 503).
 */
async function isParticipant(roastId, address) {
  const addr = address.toLowerCase();

  const result = await db.execute({
    sql: `SELECT 1 FROM participant_index WHERE roast_id = ? AND address = ?`,
    args: [roastId, addr],
  }).catch(() => null);
  if (result && result.rows[0]) return true;

  const c = getContract();
  if (!c) throw new Error("Chain verification unavailable");
  return await c.hasJoined(roastId, addr);
}

module.exports = { isArenaCreator, isParticipant };
