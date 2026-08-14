"use client";
import { useEffect, useState, useCallback, useRef, use } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import {
  ROAST_ARENA_ABI, CONTRACT_ADDRESS, NATIVE_SYMBOL, TARGET_CHAIN,
  RoastState, STATE_LABEL, STATE_COLOR,
} from "@/lib/contract";
import { BASE, getRoastContent, submitContent, getChallengeContent, type RoastContent, type ChallengeContent } from "@/lib/api";
import { useCountdown, useNow, formatCountdown } from "@/lib/useCountdown";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OnChainRoast {
  id: bigint;
  creator: string;
  openUntil: bigint;
  voteUntil: bigint;
  roastStake: bigint;
  voteStake: bigint;
  state: number;
  participantCount: bigint;
  totalVotes: bigint;
  roasterPool: bigint;
  voterPool: bigint;
  highestVotes: bigint;
  numWinners: bigint;
  winnerVoterCount: bigint;
}

// One provider/contract for the whole page lifetime. Previously a new
// JsonRpcProvider was constructed on every 4s poll (and never destroyed),
// leaking connections — and its RPC fallback was localhost, which broke
// production whenever NEXT_PUBLIC_MONAD_RPC was unset. The chain config is
// the single source of truth for the RPC URL now.
const readProvider = new ethers.JsonRpcProvider(TARGET_CHAIN.rpcUrls.default.http[0]);
const readContract = new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], readProvider);

function fmt(wei: bigint) {
  return parseFloat(ethers.formatEther(wei)).toFixed(4).replace(/\.?0+$/, "") + ` ${NATIVE_SYMBOL}`;
}

// ─── Phase banner ─────────────────────────────────────────────────────────────
function PhaseBanner({
  state, openUntil, voteUntil,
}: { state: number; openUntil: number; voteUntil: number }) {
  const now = useNow();
  const effectiveState =
    state === RoastState.SETTLED || state === RoastState.CANCELLED ? state
    : now < openUntil ? RoastState.OPEN
    : RoastState.VOTING;

  const target = effectiveState === RoastState.OPEN ? openUntil : voteUntil;
  const secs   = useCountdown(target);
  const label  = STATE_LABEL[effectiveState];
  const color  = STATE_COLOR[effectiveState];

  const phaseText =
    effectiveState === RoastState.OPEN    ? "Roasters joining — drop your best roast below"
    : effectiveState === RoastState.VOTING  ? "Voting is LIVE — pick your favourite roaster"
    : effectiveState === RoastState.SETTLED ? "Arena settled — winners crowned"
    : "Arena cancelled — refunds available";

  return (
    <div className="border border-zinc-800 rounded-lg p-5 mb-6 flex items-center justify-between">
      <div>
        <div className={`text-xl font-bold ${color}`}>{label}</div>
        <div className="text-zinc-500 text-sm mt-1">{phaseText}</div>
      </div>
      {(effectiveState === RoastState.OPEN || effectiveState === RoastState.VOTING) && (
        <div className={`text-3xl font-bold tabular-nums ${secs < 30 ? "text-red-400 animate-pulse" : "text-white"}`}>
          {formatCountdown(secs)}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const roastId = parseInt(id, 10);

  const { address, signer, connect, isWrongNetwork, switchNetwork } = useWallet();

  const [roast, setRoast]               = useState<OnChainRoast | null>(null);
  const [participants, setParticipants]   = useState<string[]>([]);
  const [winners, setWinners]             = useState<string[]>([]);
  const [voteCounts, setVoteCounts]       = useState<Record<string, number>>({});
  const [contents, setContents]           = useState<RoastContent[]>([]);
  const [challengeContent, setChallengeContent] = useState<ChallengeContent | null>(null);
  const [myContent, setMyContent]         = useState("");
  const [hasJoined, setHasJoined]         = useState(false);
  const [hasVoted, setHasVoted]           = useState(false);
  const [iAmWinner, setIAmWinner]         = useState(false);
  const [iVotedRight, setIVotedRight]     = useState(false);
  const [myVote, setMyVote]               = useState("");
  const [claimedRoaster, setClaimedRoaster] = useState(false);
  const [claimedVoter, setClaimedVoter]   = useState(false);

  const [joining, setJoining]             = useState(false);
  const [voting, setVoting]               = useState<string | null>(null);
  const [settling, setSettling]           = useState(false);
  const [settled, setSettled]             = useState(false); // immediate hide after settle
  const [claiming, setClaiming]           = useState<"roaster"|"voter"|"refund"|null>(null);
  const [submittingContent, setSubmittingContent] = useState(false);
  const [error, setError]                 = useState("");
  const [txMsg, setTxMsg]                 = useState("");
  const [chainError, setChainError]       = useState("");

  // Guards against overlapping polls: on a slow RPC a stale response could
  // land after a fresh one and overwrite newer state (e.g. reset hasVoted
  // right after a successful vote). Each load takes a generation number and
  // only the latest generation is allowed to write state.
  const loadGen = useRef(0);

  const loadChainData = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const c = readContract;

      const [r, pList, wList] = await Promise.all([
        c.getRoast(roastId),
        c.getParticipants(roastId),
        c.getWinners(roastId),
      ]);

      if (gen !== loadGen.current) return; // a newer load superseded this one

      // ethers v6 returns readonly Result proxies — convert to plain JS before
      // setting as React state (React's reconciler may try to mutate index [0])
      const parts: string[] = Array.from(pList);
      const wins: string[]  = Array.from(wList);
      setRoast({
        id: r.id, creator: r.creator,
        openUntil: r.openUntil, voteUntil: r.voteUntil,
        roastStake: r.roastStake, voteStake: r.voteStake,
        state: r.state,
        participantCount: r.participantCount, totalVotes: r.totalVotes,
        roasterPool: r.roasterPool, voterPool: r.voterPool,
        highestVotes: r.highestVotes, numWinners: r.numWinners,
        winnerVoterCount: r.winnerVoterCount,
      });
      setParticipants(parts);
      setWinners(wins);
      setChainError("");

      if (parts.length > 0) {
        const counts: bigint[] = Array.from(await c.getVoteCounts(roastId, parts));
        if (gen !== loadGen.current) return;
        const map: Record<string, number> = {};
        parts.forEach((addr: string, i: number) => {
          map[addr.toLowerCase()] = Number(counts[i]);
        });
        setVoteCounts(map);
      }

      if (!address) {
        // Wallet disconnected or switched away — clear the previous
        // account's flags so its buttons don't linger.
        setHasJoined(false);
        setHasVoted(false);
        setIAmWinner(false);
        setIVotedRight(false);
        setMyVote("");
        setClaimedRoaster(false);
        setClaimedVoter(false);
      }

      if (address) {
        const [joined, voted, winner, clRoaster, clVoter] = await Promise.all([
          c.hasJoined(roastId, address),
          c.hasVoted(roastId, address),
          c.isWinner(roastId, address),
          c.hasClaimedRoaster(roastId, address),
          c.hasClaimedVoter(roastId, address),
        ]);
        if (gen !== loadGen.current) return;
        setHasJoined(joined);
        setHasVoted(voted);
        setIAmWinner(winner);
        setClaimedRoaster(clRoaster);
        setClaimedVoter(clVoter);

        if (voted) {
          const voteAddr: string = await c.votedFor(roastId, address);
          const votedForWinner: boolean = await c.isWinner(roastId, voteAddr);
          if (gen !== loadGen.current) return;
          setMyVote(voteAddr);
          setIVotedRight(votedForWinner);
        } else {
          setMyVote("");
          setIVotedRight(false);
        }

        // If chain says settled, sync local flag too (handles page refreshes)
        if (Number(r.state) === RoastState.SETTLED || Number(r.state) === RoastState.CANCELLED) {
          setSettled(true);
        }
      }
    } catch (err) {
      console.error("loadChainData:", err);
      setChainError("Could not reach the Monad RPC — retrying…");
    }
  }, [roastId, address]);

  const loadContent = useCallback(async () => {
    try {
      const rows = await getRoastContent(roastId);
      setContents(rows);
    } catch { /* backend may not be running */ }
  }, [roastId]);

  const loadChallengeContent = useCallback(async () => {
    try {
      const data = await getChallengeContent(roastId);
      setChallengeContent(data);
    } catch { /* no challenge content set, or backend not running */ }
  }, [roastId]);

  useEffect(() => {
    loadChainData();
    loadContent();
    loadChallengeContent();
    const tid = setInterval(() => { loadChainData(); loadContent(); }, 4000);
    return () => {
      clearInterval(tid);
      loadGen.current++; // invalidate any in-flight load on unmount/re-key
    };
  }, [loadChainData, loadContent, loadChallengeContent]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const writeContract = () => {
    if (!signer) throw new Error("No signer");
    return new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], signer);
  };

  const handleJoin = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    if (!roast) return;
    setJoining(true); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.joinRoast(roastId, { value: roast.roastStake });
      setTxMsg(`Joining arena… (staking ${fmt(roast.roastStake)})`);
      await tx.wait();
      setTxMsg("Joined! Drop your roast below.");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Failed to join");
    } finally {
      setJoining(false);
    }
  };

  const handleSubmitContent = async () => {
    if (!address || !signer || !myContent.trim()) return;
    setSubmittingContent(true);
    try {
      await submitContent(signer, roastId, address, myContent.trim());
      setMyContent("");
      await loadContent();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save roast content");
    } finally {
      setSubmittingContent(false);
    }
  };

  const handleVote = async (candidate: string) => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    if (!roast) return;
    setVoting(candidate); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.vote(roastId, candidate, { value: roast.voteStake });
      setTxMsg(`Casting vote… (staking ${fmt(roast.voteStake)})`);
      await tx.wait();
      setTxMsg("Vote cast!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Vote failed");
    } finally {
      setVoting(null);
    }
  };

  const handleSettle = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    setSettling(true); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.settle(roastId);
      setTxMsg("Settling arena…");
      await tx.wait();
      setSettled(true); // immediately hide button — don't wait for next poll
      setTxMsg("Arena settled!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Settle failed");
    } finally {
      setSettling(false);
    }
  };

  const handleClaimRoaster = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    setClaiming("roaster"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimRoasterReward(roastId);
      setTxMsg("Claiming roaster reward…");
      await tx.wait();
      setTxMsg("Roaster reward claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  const handleClaimVoter = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    setClaiming("voter"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimVoterReward(roastId);
      setTxMsg("Claiming voter reward…");
      await tx.wait();
      setTxMsg("Voter reward claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  const handleClaimRefund = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }
    setClaiming("refund"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimRefund(roastId);
      setTxMsg("Claiming refund…");
      await tx.wait();
      setTxMsg("Refund claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Refund failed");
    } finally {
      setClaiming(null);
    }
  };

  // ─── Derived state ─────────────────────────────────────────────────────────

  // On-chain deadlines (unix seconds). Monad block timestamps track wall time
  // closely, so we compare them against real time directly — the previous
  // "block offset" correction pushed deadlines later than the contract
  // enforces and kept Join/Settle buttons alive on actions that would revert.
  const openUntil    = roast ? Number(roast.openUntil)  : 0;
  const voteUntil    = roast ? Number(roast.voteUntil)  : 0;
  const storedState  = roast ? roast.state : -1;

  // Ticks every second so the phase flips the moment a deadline passes,
  // instead of lagging until the next 4s data poll.
  const now = useNow();

  const effectiveState: RoastState =
    storedState === RoastState.SETTLED || storedState === RoastState.CANCELLED
      ? storedState
      : now < openUntil ? RoastState.OPEN
      : RoastState.VOTING;

  const canJoin   = effectiveState === RoastState.OPEN && !hasJoined;
  const canVote   = effectiveState === RoastState.VOTING && !hasVoted;
  // +2s buffer: the chain's clock can trail wall time slightly; settling at
  // the exact boundary would revert with VotingNotEnded.
  const canSettle = !settled &&
    now >= voteUntil + 2 &&
    storedState !== RoastState.SETTLED &&
    storedState !== RoastState.CANCELLED &&
    (hasJoined || hasVoted);

  const isSettled   = storedState === RoastState.SETTLED;
  const isCancelled = storedState === RoastState.CANCELLED;

  const contentByAuthor: Record<string, RoastContent> = {};
  contents.forEach((c) => { contentByAuthor[c.author.toLowerCase()] = c; });

  const myAddr    = address?.toLowerCase() ?? "";
  const alreadyPosted = !!contentByAuthor[myAddr];
  // Only show the roast textarea if joined, OPEN window, and NOT yet submitted.
  const canPost   = hasJoined && effectiveState === RoastState.OPEN && !alreadyPosted;

  const maxVotes  = Math.max(1, ...Object.values(voteCounts));

  const roasterShare = roast && roast.numWinners > 0n
    ? roast.roasterPool / roast.numWinners
    : 0n;
  const voterShare = roast && roast.winnerVoterCount > 0n
    ? roast.voterPool / roast.winnerVoterCount
    : 0n;

  if (!roast) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2">
          <span>Loading arena #{roastId}…</span>
          {chainError && <span className="text-red-400 text-sm">{chainError}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        <Link href="/" className="text-zinc-600 hover:text-white text-sm mb-6 inline-block">
          ← All Arenas
        </Link>

        <h1 className="text-3xl font-bold mb-1">Arena <span className="text-orange-500">#{roastId}</span></h1>
        <p className="text-zinc-600 text-sm mb-1">
          {Number(roast.participantCount)} roasters · {Number(roast.totalVotes)} votes
        </p>
        <p className="text-zinc-600 text-xs mb-6">
          Roaster stake: {fmt(roast.roastStake)} · Vote stake: {fmt(roast.voteStake)}
        </p>

        {/* Challenge subject — what this arena is about */}
        {challengeContent && (
          <div className="border border-orange-500/30 bg-orange-500/5 rounded-xl p-5 mb-6">
            <p className="text-orange-400 text-xs uppercase tracking-widest mb-2">What we&apos;re roasting</p>
            <h2 className="text-white font-bold text-xl mb-2">{challengeContent.title}</h2>
            {challengeContent.description && (
              <p className="text-zinc-400 text-sm mb-3 whitespace-pre-wrap">{challengeContent.description}</p>
            )}
            {challengeContent.media_url && (() => {
              // Defense in depth: only render our own /uploads paths or
              // https URLs, whatever the backend stored.
              const raw = challengeContent.media_url;
              let src: string | null = null;
              if (raw.startsWith("/uploads/") && !raw.includes("..")) {
                src = `${BASE}${raw}`;
              } else {
                try {
                  if (new URL(raw).protocol === "https:") src = raw;
                } catch { /* not a valid absolute URL — don't render it */ }
              }
              if (!src) return null;
              return /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(src) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt="Challenge media"
                  className="max-h-64 rounded-lg object-contain border border-zinc-700"
                />
              ) : (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 text-sm underline break-all"
                >
                  {src}
                </a>
              );
            })()}
          </div>
        )}

        <PhaseBanner state={storedState} openUntil={openUntil} voteUntil={voteUntil} />

        {/* Pool sizes */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="border border-zinc-800 rounded-lg p-4 text-center">
            <div className="text-zinc-500 text-xs uppercase tracking-widest mb-1">Roaster Pool</div>
            <div className="text-white font-bold text-lg">{fmt(roast.roasterPool)}</div>
            {isSettled && roast.numWinners > 0n && (
              <div className="text-zinc-500 text-xs mt-1">{fmt(roasterShare)} / winner</div>
            )}
          </div>
          <div className="border border-zinc-800 rounded-lg p-4 text-center">
            <div className="text-zinc-500 text-xs uppercase tracking-widest mb-1">Voter Pool</div>
            <div className="text-white font-bold text-lg">{fmt(roast.voterPool)}</div>
            {isSettled && roast.winnerVoterCount > 0n && (
              <div className="text-zinc-500 text-xs mt-1">{fmt(voterShare)} / winner voter</div>
            )}
          </div>
        </div>

        {/* Winner banner */}
        {isSettled && winners.length > 0 && (
          <div className="bg-orange-950 border border-orange-500 rounded-lg p-5 mb-6">
            <div className="text-orange-400 text-xs uppercase tracking-widest mb-2 text-center">
              {winners.length === 1 ? "Winner" : `${winners.length}-Way Tie`}
            </div>
            {winners.map((w) => (
              <div key={w} className="text-white font-bold text-sm break-all text-center">{w}</div>
            ))}
            <div className="text-orange-400 text-sm mt-2 text-center">
              {Number(roast.highestVotes)} vote{Number(roast.highestVotes) !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="bg-red-950 border border-red-700 rounded-lg p-5 mb-6 text-center text-red-400">
            Arena cancelled — not enough participants or no votes cast.
          </div>
        )}

        {isWrongNetwork && (
          <p className="text-yellow-400 text-sm mb-4">
            Wrong network — actions will switch you to {TARGET_CHAIN.name}.{" "}
            <button onClick={switchNetwork} className="underline">Switch now</button>
          </p>
        )}
        {error  && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {txMsg  && <p className="text-green-400 text-sm mb-4">{txMsg}</p>}

        {/* Claim / Refund buttons */}
        {isSettled && iAmWinner && !claimedRoaster && (
          <button onClick={handleClaimRoaster} disabled={claiming !== null}
            className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg mb-3">
            {claiming === "roaster" ? "Claiming…" : `Claim Roaster Reward (${fmt(roasterShare)})`}
          </button>
        )}
        {isSettled && iAmWinner && claimedRoaster && (
          <p className="text-center text-yellow-600 text-sm mb-3">Roaster reward already claimed.</p>
        )}

        {isSettled && hasVoted && iVotedRight && !claimedVoter && (
          <button onClick={handleClaimVoter} disabled={claiming !== null}
            className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg mb-3">
            {claiming === "voter" ? "Claiming…" : `Claim Voter Reward (${fmt(voterShare)})`}
          </button>
        )}
        {isSettled && hasVoted && !iVotedRight && (
          <p className="text-center text-zinc-600 text-sm mb-3">You backed the losing side — no voter reward.</p>
        )}
        {isSettled && hasVoted && iVotedRight && claimedVoter && (
          <p className="text-center text-green-700 text-sm mb-3">Voter reward already claimed.</p>
        )}

        {isCancelled && (hasJoined || hasVoted) && (
          <button onClick={handleClaimRefund} disabled={claiming !== null}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg mb-3">
            {claiming === "refund" ? "Claiming refund…" : "Claim Refund"}
          </button>
        )}

        {/* Join button */}
        {canJoin && (
          <button onClick={handleJoin} disabled={joining}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg mb-6">
            {joining ? "Joining…" : `Join Arena as Roaster (stake ${fmt(roast.roastStake)})`}
          </button>
        )}

        {/* Roast content — shown only if joined, OPEN window, and not yet submitted */}
        {canPost && (
          <div className="mb-6 border border-zinc-800 rounded-lg p-4">
            <p className="text-zinc-400 text-sm mb-3">Your roast (saved off-chain, linked to your wallet):</p>
            <textarea
              value={myContent}
              onChange={(e) => setMyContent(e.target.value)}
              maxLength={500} rows={3}
              placeholder="Drop your roast here..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-white text-sm resize-none focus:outline-none focus:border-orange-500"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-zinc-600 text-xs">{myContent.length}/500</span>
              <button onClick={handleSubmitContent} disabled={submittingContent || !myContent.trim()}
                className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded">
                {submittingContent ? "Saving…" : "Save Roast"}
              </button>
            </div>
          </div>
        )}

        {/* If already posted, show the submitted content with a note */}
        {hasJoined && effectiveState === RoastState.OPEN && alreadyPosted && (
          <div className="mb-6 border border-zinc-700 rounded-lg p-4 bg-zinc-900/50">
            <p className="text-zinc-500 text-xs mb-2 uppercase tracking-widest">Your roast (submitted)</p>
            <p className="text-zinc-300 text-sm">{contentByAuthor[myAddr].content}</p>
          </div>
        )}

        {/* Settle button */}
        {canSettle && (
          <button onClick={handleSettle} disabled={settling}
            className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg mb-6">
            {settling ? "Settling…" : "Settle Arena (Voting Closed)"}
          </button>
        )}

        {/* Participants / vote cards */}
        <h2 className="text-zinc-500 text-xs uppercase tracking-widest mb-3">Roasters</h2>

        {participants.length === 0 ? (
          <p className="text-zinc-700 text-sm">No participants yet.</p>
        ) : (
          <div className="space-y-4">
            {participants.map((addr) => {
              const lower   = addr.toLowerCase();
              const content = contentByAuthor[lower];
              const votes   = voteCounts[lower] ?? 0;
              const isWin   = winners.some((w) => w.toLowerCase() === lower);
              const pct     = Math.round((votes / maxVotes) * 100);
              const isMe    = address?.toLowerCase() === lower;
              const canVoteThis = canVote && !isMe;

              return (
                <div key={addr}
                  className={`border rounded-lg p-4 ${isWin ? "border-orange-500 bg-orange-950/20" : "border-zinc-800"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-zinc-300 text-sm font-bold truncate">
                          {isMe ? "You" : `${addr.slice(0, 6)}…${addr.slice(-4)}`}
                        </span>
                        {isWin && <span className="text-orange-400 text-xs font-bold">WINNER</span>}
                      </div>

                      {content ? (
                        <p className="text-zinc-300 text-sm leading-relaxed">{content.content}</p>
                      ) : (
                        <p className="text-zinc-700 text-sm italic">No roast submitted yet…</p>
                      )}

                      {(effectiveState === RoastState.VOTING || isSettled) && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                              <div className="bg-orange-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-zinc-400 text-xs w-12 text-right">
                              {votes} vote{votes !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {canVoteThis && (
                      <button onClick={() => handleVote(addr)} disabled={voting !== null}
                        className="shrink-0 bg-zinc-800 hover:bg-orange-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded transition-all">
                        {voting === addr ? "Voting…" : `Vote (${roast ? fmt(roast.voteStake) : "…"})`}
                      </button>
                    )}
                    {canVote && isMe && (
                      <span className="shrink-0 text-zinc-600 text-xs py-2">can&apos;t self-vote</span>
                    )}
                    {hasVoted && myVote.toLowerCase() === lower &&
                      (effectiveState === RoastState.VOTING || isSettled) && (
                      <span className="shrink-0 text-green-600 text-xs py-2">your vote ✓</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
