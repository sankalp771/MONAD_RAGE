// Contract ABI — v2 with staking (payable join/vote, dual pools, claims)
export const ROAST_ARENA_ABI = [
  // ── Write (payable) ────────────────────────────────────────────────────────
  "function createRoast(uint256 roastStake, uint256 voteStake) external payable returns (uint256)",
  "function joinRoast(uint256 roastId) external payable",
  "function vote(uint256 roastId, address candidate) external payable",
  "function settle(uint256 roastId) external",
  "function claimRoasterReward(uint256 roastId) external",
  "function claimVoterReward(uint256 roastId) external",
  "function claimRefund(uint256 roastId) external",

  // ── Read ───────────────────────────────────────────────────────────────────
  "function roastCounter() external view returns (uint256)",
  "function currentState(uint256 roastId) external view returns (uint8)",
  "function getRoast(uint256 roastId) external view returns (tuple(uint256 id, address creator, uint256 openUntil, uint256 voteUntil, uint256 roastStake, uint256 voteStake, uint8 state, uint256 participantCount, uint256 totalVotes, uint256 roasterPool, uint256 voterPool, uint256 highestVotes, uint256 numWinners, uint256 winnerVoterCount))",
  "function getParticipants(uint256 roastId) external view returns (address[])",
  "function getWinners(uint256 roastId) external view returns (address[])",
  "function getVoteCounts(uint256 roastId, address[] calldata candidates) external view returns (uint256[])",
  "function getRecentRoasts(uint256 count) external view returns (uint256[])",
  "function hasJoined(uint256, address) external view returns (bool)",
  "function hasVoted(uint256, address) external view returns (bool)",
  "function isWinner(uint256, address) external view returns (bool)",
  "function votedFor(uint256, address) external view returns (address)",
  "function hasClaimedRoaster(uint256, address) external view returns (bool)",
  "function hasClaimedVoter(uint256, address) external view returns (bool)",
  "function votesFor(uint256, address) external view returns (uint256)",

  // ── Custom Errors ──────────────────────────────────────────────────────────
  "error RoastNotFound()",
  "error StakeTooLow()",
  "error IncorrectStakeAmount()",
  "error JoinWindowClosed()",
  "error AlreadyJoined()",
  "error NotInVotingWindow()",
  "error AlreadyVoted()",
  "error CandidateNotParticipant()",
  "error SelfVoteNotAllowed()",
  "error VotingNotEnded()",
  "error AlreadyFinalized()",
  "error NotParticipantOrVoter()",
  "error NotSettled()",
  "error NotCancelled()",
  "error NotWinner()",
  "error VotedForLoser()",
  "error AlreadyClaimed()",
  "error NothingToClaim()",

  // ── Events ─────────────────────────────────────────────────────────────────
  "event RoastCreated(uint256 indexed roastId, address indexed creator, uint256 roastStake, uint256 voteStake, uint256 openUntil, uint256 voteUntil)",
  "event ParticipantJoined(uint256 indexed roastId, address indexed participant)",
  "event VoteCast(uint256 indexed roastId, address indexed voter, address indexed candidate)",
  "event RoastSettled(uint256 indexed roastId, uint256 numWinners, uint256 roasterPool, uint256 voterPool, uint256 winnerVoterCount)",
  "event RoastCancelled(uint256 indexed roastId, string reason)",
  "event RewardClaimed(uint256 indexed roastId, address indexed claimer, uint256 amount, bool isRoasterReward)",
  "event RefundClaimed(uint256 indexed roastId, address indexed claimer, uint256 amount)",
] satisfies string[];

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

// Anvil local chain (for development)
export const ANVIL_LOCAL = {
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  blockExplorers: {
    default: { name: "Local", url: "http://localhost" },
  },
  testnet: true,
};

// Monad Testnet chain definition
export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC || "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
};

// Active chain (driven by env — 31337 = local Anvil, 10143 = Monad testnet)
const configuredChainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "10143", 10);
export const TARGET_CHAIN = configuredChainId === 31337 ? ANVIL_LOCAL : MONAD_TESTNET;

// RoastState enum mirrors the contract
export enum RoastState {
  OPEN      = 0,
  VOTING    = 1,
  SETTLED   = 2,
  CANCELLED = 3,
}

export const STATE_LABEL: Record<RoastState, string> = {
  [RoastState.OPEN]:      "OPEN",
  [RoastState.VOTING]:    "VOTING",
  [RoastState.SETTLED]:   "SETTLED",
  [RoastState.CANCELLED]: "CANCELLED",
};

export const STATE_COLOR: Record<RoastState, string> = {
  [RoastState.OPEN]:      "text-green-400",
  [RoastState.VOTING]:    "text-yellow-400",
  [RoastState.SETTLED]:   "text-blue-400",
  [RoastState.CANCELLED]: "text-red-400",
};
