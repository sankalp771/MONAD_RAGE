const { ethers } = require("ethers");
const {
  insertRoast,
  updateRoastSettled,
  updateRoastCancelled,
  insertParticipant,
  getListenerBlock,
  setListenerBlock,
} = require("./db");

const ABI = [
  "event RoastCreated(uint256 indexed roastId, address indexed creator, uint256 roastStake, uint256 voteStake, uint256 openUntil, uint256 voteUntil)",
  "event ParticipantJoined(uint256 indexed roastId, address indexed participant)",
  "event VoteCast(uint256 indexed roastId, address indexed voter, address indexed candidate)",
  "event RoastSettled(uint256 indexed roastId, uint256 numWinners, uint256 roasterPool, uint256 voterPool, uint256 winnerVoterCount)",
  "event RoastCancelled(uint256 indexed roastId, string reason)",
];

// Monad RPC hard-limits getLogs to 100 blocks per call
const CHUNK_SIZE          = 100;
// Cold-start lookback when no persisted block exists.
// Keep small (2 chunks) to avoid rate limits — persistence is the real fix.
const COLD_START_LOOKBACK = 200;

let contract        = null;
let lastPolledBlock = 0;  // in-memory; loaded from DB on startup

async function processLog(log) {
  const parsedLog = contract.interface.parseLog({
    topics: [...log.topics],
    data: log.data,
  });
  if (!parsedLog) return;

  if (parsedLog.name === "RoastCreated") {
    const [roastId, creator, roastStake, voteStake, openUntil, voteUntil] = parsedLog.args;
    await insertRoast({
      roast_id:    Number(roastId),
      creator:     creator.toLowerCase(),
      roast_stake: roastStake.toString(),
      vote_stake:  voteStake.toString(),
      open_until:  Number(openUntil),
      vote_until:  Number(voteUntil),
      tx_hash:     log.transactionHash,
      block_number: log.blockNumber,
    });
    console.log(`[listener] RoastCreated   id=${roastId} creator=${creator}`);

  } else if (parsedLog.name === "ParticipantJoined") {
    const [roastId, participant] = parsedLog.args;
    await insertParticipant({
      roast_id: Number(roastId),
      address:  participant.toLowerCase(),
      tx_hash:  log.transactionHash,
    });
    console.log(`[listener] ParticipantJoined id=${roastId} addr=${participant}`);

  } else if (parsedLog.name === "VoteCast") {
    const [roastId, voter, candidate] = parsedLog.args;
    console.log(`[listener] VoteCast       id=${roastId} voter=${voter} -> ${candidate}`);

  } else if (parsedLog.name === "RoastSettled") {
    const [roastId, numWinners, roasterPool, voterPool, winnerVoterCount] = parsedLog.args;
    await updateRoastSettled({
      roast_id:           Number(roastId),
      num_winners:        Number(numWinners),
      roaster_pool:       roasterPool.toString(),
      voter_pool:         voterPool.toString(),
      winner_voter_count: Number(winnerVoterCount),
    });
    console.log(`[listener] RoastSettled   id=${roastId} numWinners=${numWinners}`);

  } else if (parsedLog.name === "RoastCancelled") {
    const [roastId, reason] = parsedLog.args;
    await updateRoastCancelled({ roast_id: Number(roastId) });
    console.log(`[listener] RoastCancelled id=${roastId} reason="${reason}"`);
  }
}

async function pollEvents() {
  if (!contract) return;

  try {
    const currentBlock = await contract.runner.provider.getBlockNumber();
    if (currentBlock <= lastPolledBlock) return;

    const fromBlock = lastPolledBlock + 1;
    const toBlock   = currentBlock;

    // Process in CHUNK_SIZE blocks per getLogs call (Monad limit = 100)
    for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
      const end  = Math.min(start + CHUNK_SIZE - 1, toBlock);
      const logs = await contract.runner.provider.getLogs({
        address:   contract.target,
        fromBlock: start,
        toBlock:   end,
      });

      for (const log of logs) {
        try {
          await processLog(log);
        } catch (dbErr) {
          if (!dbErr.message.includes("UNIQUE constraint failed")) {
            console.error(`[listener] DB error:`, dbErr.message);
          }
        }
      }
    }

    lastPolledBlock = toBlock;
    // Persist so restarts don't lose our position
    await setListenerBlock(lastPolledBlock);

  } catch (err) {
    console.error("[listener] Polling error:", err.message);
  }
}

async function startListener(contractAddress) {
  const provider = new ethers.JsonRpcProvider(
    process.env.MONAD_RPC || "https://testnet-rpc.monad.xyz"
  );

  contract = new ethers.Contract(contractAddress, ABI, provider);
  console.log(`[listener] Watching ${contractAddress} via Manual Polling`);

  // Load persisted block position from DB
  const storedBlock = await getListenerBlock();
  if (storedBlock !== null) {
    lastPolledBlock = storedBlock;
    console.log(`[listener] Resuming from persisted block ${lastPolledBlock}`);
  } else {
    // Cold start — scan the last COLD_START_LOOKBACK blocks to catch recent arenas
    const currentBlock  = await provider.getBlockNumber();
    lastPolledBlock = Math.max(0, currentBlock - COLD_START_LOOKBACK);
    console.log(`[listener] Cold start — scanning from block ${lastPolledBlock} (last ${COLD_START_LOOKBACK} blocks)`);
  }

  // Immediate first poll (catches up on backlog)
  await pollEvents();

  // Then poll every 5 seconds
  setInterval(pollEvents, 5000);
}

module.exports = { startListener };
