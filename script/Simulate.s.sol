// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RoastArena.sol";

/**
 * @notice Full workflow simulation against Anvil (with staking).
 * Run:
 *   forge script script/Simulate.s.sol --rpc-url http://127.0.0.1:8545 -vv
 */
contract Simulate is Script {
    address constant CREATOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ALICE   = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant BOB     = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant VOTER1  = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant VOTER2  = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address constant VOTER3  = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    uint256 constant ROAST_STAKE = 1 ether;
    uint256 constant VOTE_STAKE  = 0.5 ether;
    uint256 constant OPEN        = 3 minutes;
    uint256 constant VOTING      = 4 minutes;

    RoastArena arena;

    function run() external {
        vm.prank(CREATOR);
        arena = new RoastArena();

        console.log("");
        console.log("====================================================");
        console.log("  RoastArena - Full Workflow Simulation (with Staking)");
        console.log("====================================================");
        console.log("Contract:", address(arena));
        console.log("roastStake:", ROAST_STAKE);
        console.log("voteStake: ", VOTE_STAKE);
        console.log("");

        _scenario1_HappyPath();
        _scenario2_OnlyCreator();
        _scenario3_NoVotes();
        _scenario4_TieSplit();
        _scenario5_PredictionMarket();
        _scenario6_RoasterAlsoVotes();
        _scenario7_Reverts();

        console.log("====================================================");
        console.log("   ALL SCENARIOS PASSED");
        console.log("====================================================");
    }

    // ─── S1: Happy Path ──────────────────────────────────────────
    function _scenario1_HappyPath() internal {
        console.log("--- S1: Happy Path (alice wins, winner voters rewarded) ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        vm.warp(block.timestamp + OPEN + 1);

        // 2 voters back alice, 1 backs bob
        vm.prank(VOTER1); arena.vote{value: VOTE_STAKE}(id, ALICE);
        vm.prank(VOTER2); arena.vote{value: VOTE_STAKE}(id, ALICE);
        vm.prank(VOTER3); arena.vote{value: VOTE_STAKE}(id, BOB);

        vm.warp(block.timestamp + VOTING + 1);
        vm.prank(VOTER1); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        require(r.state == RoastArena.RoastState.SETTLED, "s1: not SETTLED");
        require(r.numWinners == 1, "s1: wrong numWinners");
        require(arena.isWinner(id, ALICE), "s1: alice not winner");
        console.log("  Winner: ALICE (correct)");

        // Alice claims roaster reward (all 3 stakes)
        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE); arena.claimRoasterReward(id);
        console.log("  Alice roaster claim:", ALICE.balance - aliceBefore);
        require(ALICE.balance - aliceBefore == 3 * ROAST_STAKE, "s1: wrong roaster reward");

        // VOTER1 and VOTER2 split voterPool (3 * VOTE_STAKE), VOTER3 loses stake
        uint256 v1Before = VOTER1.balance;
        uint256 v2Before = VOTER2.balance;
        vm.prank(VOTER1); arena.claimVoterReward(id);
        vm.prank(VOTER2); arena.claimVoterReward(id);
        // winnerVoterCount = 1 * 2 = 2, each gets 3*VOTE_STAKE/2
        uint256 expectedVoterShare = (3 * VOTE_STAKE) / 2;
        require(VOTER1.balance - v1Before == expectedVoterShare, "s1: wrong voter1 reward");
        require(VOTER2.balance - v2Before == expectedVoterShare, "s1: wrong voter2 reward");
        console.log("  VOTER1 claim (1.5x stake):", VOTER1.balance - v1Before);
        console.log("  VOTER3: no reward (backed loser)");
        console.log("");
    }

    // ─── S2: Only Creator ────────────────────────────────────────
    function _scenario2_OnlyCreator() internal {
        console.log("--- S2: Only Creator, No Competition -> CANCELLED ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);

        vm.warp(block.timestamp + OPEN + VOTING + 1);
        vm.prank(CREATOR); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        require(r.state == RoastArena.RoastState.CANCELLED, "s2: not CANCELLED");

        uint256 before = CREATOR.balance;
        vm.prank(CREATOR); arena.claimRefund(id);
        require(CREATOR.balance - before == ROAST_STAKE, "s2: wrong refund");
        console.log("  RESULT: CANCELLED, creator refunded");
        console.log("");
    }

    // ─── S3: No Votes -> CANCELLED ───────────────────────────────
    function _scenario3_NoVotes() internal {
        console.log("--- S3: No Votes Cast -> CANCELLED, roasters refunded ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        vm.warp(block.timestamp + OPEN + VOTING + 1);
        vm.prank(ALICE); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        require(r.state == RoastArena.RoastState.CANCELLED, "s3: not CANCELLED");

        uint256 aBefore = ALICE.balance;
        vm.prank(ALICE); arena.claimRefund(id);
        require(ALICE.balance - aBefore == ROAST_STAKE, "s3: wrong refund");
        console.log("  RESULT: CANCELLED, all roasters can claim refund");
        console.log("");
    }

    // ─── S4: Tie -> Split ────────────────────────────────────────
    function _scenario4_TieSplit() internal {
        console.log("--- S4: Tie -> roasterPool split, voterPool split ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        vm.warp(block.timestamp + OPEN + 1);
        vm.prank(VOTER1); arena.vote{value: VOTE_STAKE}(id, ALICE);
        vm.prank(VOTER2); arena.vote{value: VOTE_STAKE}(id, BOB);

        vm.warp(block.timestamp + VOTING + 1);
        vm.prank(VOTER1); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        require(r.numWinners == 2, "s4: should be 2 winners");
        require(arena.isWinner(id, ALICE), "s4: alice not winner");
        require(arena.isWinner(id, BOB), "s4: bob not winner");

        // roasterPool = 3 ETH, each gets 1.5 ETH
        uint256 aBefore = ALICE.balance;
        uint256 bBefore = BOB.balance;
        vm.prank(ALICE); arena.claimRoasterReward(id);
        vm.prank(BOB);   arena.claimRoasterReward(id);
        require(ALICE.balance - aBefore == (3 * ROAST_STAKE) / 2, "s4: alice wrong reward");
        require(BOB.balance   - bBefore == (3 * ROAST_STAKE) / 2, "s4: bob wrong reward");
        console.log("  Alice roaster share:", ALICE.balance - aBefore);
        console.log("  Bob roaster share  :", BOB.balance - bBefore);

        // voterPool = 2 * VOTE_STAKE, winnerVoterCount = 2*1 = 2, each voter gets VOTE_STAKE
        uint256 v1B = VOTER1.balance;
        uint256 v2B = VOTER2.balance;
        vm.prank(VOTER1); arena.claimVoterReward(id);
        vm.prank(VOTER2); arena.claimVoterReward(id);
        require(VOTER1.balance - v1B == VOTE_STAKE, "s4: voter1 wrong");
        require(VOTER2.balance - v2B == VOTE_STAKE, "s4: voter2 wrong");
        console.log("  Voter1 share (break-even):", VOTER1.balance - v1B);
        console.log("  Voter2 share (break-even):", VOTER2.balance - v2B);
        console.log("");
    }

    // ─── S5: Prediction Market Multiplier ────────────────────────
    function _scenario5_PredictionMarket() internal {
        console.log("--- S5: Prediction Market (winner voters share loser's stake) ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        vm.warp(block.timestamp + OPEN + 1);
        // VOTER1 and VOTER2 correctly pick ALICE; VOTER3 picks BOB (wrong)
        // ALICE wins 2-1. voterPool = 3 * VOTE_STAKE.
        // winnerVoterCount = 1 winner * 2 votes = 2
        // Each winner voter gets 3 * VOTE_STAKE / 2 = 1.5x their stake
        vm.prank(VOTER1); arena.vote{value: VOTE_STAKE}(id, ALICE);  // correct
        vm.prank(VOTER2); arena.vote{value: VOTE_STAKE}(id, ALICE);  // correct
        vm.prank(VOTER3); arena.vote{value: VOTE_STAKE}(id, BOB);    // wrong -- stake redistributed

        vm.warp(block.timestamp + VOTING + 1);
        vm.prank(VOTER1); arena.settle(id);

        uint256 expectedShare = (3 * VOTE_STAKE) / 2;

        uint256 before1 = VOTER1.balance;
        vm.prank(VOTER1); arena.claimVoterReward(id);
        require(VOTER1.balance - before1 == expectedShare, "s5: voter1 wrong payout");

        uint256 before2 = VOTER2.balance;
        vm.prank(VOTER2); arena.claimVoterReward(id);
        require(VOTER2.balance - before2 == expectedShare, "s5: voter2 wrong payout");

        console.log("  VOTER1 staked 0.5 ETH, won:", VOTER1.balance - before1, "(1.5x)");
        console.log("  VOTER2 staked 0.5 ETH, won:", VOTER2.balance - before2, "(1.5x)");
        console.log("  VOTER3: lost 0.5 ETH stake (backed loser BOB)");
        console.log("");
    }

    // ─── S6: Roaster Also Votes ──────────────────────────────────
    function _scenario6_RoasterAlsoVotes() internal {
        console.log("--- S6: Roaster pays extra voteStake to vote ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        vm.warp(block.timestamp + OPEN + 1);
        // Creator (roaster) also votes — pays extra VOTE_STAKE
        vm.prank(CREATOR); arena.vote{value: VOTE_STAKE}(id, ALICE);
        require(arena.getRoast(id).voterPool == VOTE_STAKE, "s6: voterPool wrong");
        require(arena.votedFor(id, CREATOR) == ALICE, "s6: votedFor wrong");

        vm.warp(block.timestamp + VOTING + 1);
        vm.prank(CREATOR); arena.settle(id);

        // alice wins, creator gets voter reward
        uint256 before = CREATOR.balance;
        vm.prank(CREATOR); arena.claimVoterReward(id);
        require(CREATOR.balance - before == VOTE_STAKE, "s6: creator voter reward wrong");
        console.log("  Creator voted AND won voter reward:", CREATOR.balance - before);
        console.log("");
    }

    // ─── S7: Revert Edge Cases ───────────────────────────────────
    function _scenario7_Reverts() internal {
        console.log("--- S7: Revert Edge Cases ---");

        vm.prank(CREATOR);
        uint256 id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
        vm.prank(ALICE); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(BOB);   arena.joinRoast{value: ROAST_STAKE}(id);

        // Zero stakes
        _expectRevert(abi.encodeWithSelector(
            arena.createRoast.selector, 0, VOTE_STAKE
        ), CREATOR, 0, "zero roastStake");
        console.log("  [OK] Zero roastStake reverts");

        // Wrong ETH on join
        _expectRevert(abi.encodeWithSelector(
            arena.joinRoast.selector, id
        ), VOTER1, ROAST_STAKE - 1, "wrong ETH join");
        console.log("  [OK] Wrong ETH on joinRoast reverts");

        // Wrong ETH on vote (after warping)
        vm.warp(block.timestamp + OPEN + 1);
        _expectRevert(abi.encodeWithSelector(
            arena.vote.selector, id, ALICE
        ), VOTER1, VOTE_STAKE - 1, "wrong ETH vote");
        console.log("  [OK] Wrong ETH on vote reverts");

        // Self-vote
        _expectRevert(abi.encodeWithSelector(
            arena.vote.selector, id, ALICE
        ), ALICE, VOTE_STAKE, "self vote");
        console.log("  [OK] Self-vote reverts");

        // Stranger calls settle
        vm.prank(VOTER1); arena.vote{value: VOTE_STAKE}(id, ALICE);
        vm.warp(block.timestamp + VOTING + 1);
        _expectRevert(abi.encodeWithSelector(
            arena.settle.selector, id
        ), VOTER3, 0, "stranger settle");
        console.log("  [OK] Stranger settle reverts");

        // Settle by voter - ok, then double settle
        vm.prank(VOTER1); arena.settle(id);
        _expectRevert(abi.encodeWithSelector(
            arena.settle.selector, id
        ), VOTER1, 0, "double settle");
        console.log("  [OK] Double-settle reverts");

        // Loser tries to claim roaster reward
        _expectRevert(abi.encodeWithSelector(
            arena.claimRoasterReward.selector, id
        ), BOB, 0, "loser claim roaster");
        console.log("  [OK] Loser claimRoasterReward reverts");

        // Voter who backed loser (VOTER3 never voted in this roast)
        // NothingToClaim since they never voted
        _expectRevert(abi.encodeWithSelector(
            arena.claimVoterReward.selector, id
        ), VOTER3, 0, "non-voter claim voter");
        console.log("  [OK] Non-voter claimVoterReward reverts");

        // claimRefund on SETTLED
        _expectRevert(abi.encodeWithSelector(
            arena.claimRefund.selector, id
        ), ALICE, 0, "refund on settled");
        console.log("  [OK] claimRefund on SETTLED reverts");

        console.log("");
    }

    function _expectRevert(
        bytes memory callData,
        address caller,
        uint256 value,
        string memory label
    ) internal {
        vm.deal(caller, caller.balance + value);
        vm.prank(caller);
        (bool success,) = address(arena).call{value: value}(callData);
        require(!success, string.concat("Expected revert: ", label));
    }
}
