// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RoastArena.sol";

contract RoastArenaTest is Test {
    RoastArena arena;

    // Use makeAddr to avoid EVM precompile addresses (0x1-0x9)
    address creator  = makeAddr("creator");
    address alice    = makeAddr("alice");
    address bob      = makeAddr("bob");
    address carol    = makeAddr("carol");
    address stranger = makeAddr("stranger");
    address voter1   = makeAddr("voter1");
    address voter2   = makeAddr("voter2");
    address voter3   = makeAddr("voter3");

    uint256 constant ROAST_STAKE     = 1 ether;
    uint256 constant VOTE_STAKE      = 0.5 ether;
    uint256 constant OPEN_DURATION   = 3 minutes;
    uint256 constant VOTE_DURATION   = 4 minutes;
    uint256 constant TOTAL_DURATION  = OPEN_DURATION + VOTE_DURATION;
    uint256 constant START_BALANCE   = 100 ether;

    function setUp() public {
        arena = new RoastArena();
        vm.warp(1_000_000);

        vm.deal(creator,  START_BALANCE);
        vm.deal(alice,    START_BALANCE);
        vm.deal(bob,      START_BALANCE);
        vm.deal(carol,    START_BALANCE);
        vm.deal(stranger, START_BALANCE);
        vm.deal(voter1,   START_BALANCE);
        vm.deal(voter2,   START_BALANCE);
        vm.deal(voter3,   START_BALANCE);
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    function _create() internal returns (uint256 id) {
        vm.prank(creator);
        id = arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, VOTE_STAKE);
    }

    /// Create + alice + bob join, warp to voting window
    function _setupWithTwo() internal returns (uint256 id) {
        id = _create();
        vm.prank(alice); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(bob);   arena.joinRoast{value: ROAST_STAKE}(id);
        vm.warp(block.timestamp + OPEN_DURATION + 1);
    }

    function _warpPastVoting() internal {
        vm.warp(block.timestamp + VOTE_DURATION + 1);
    }

    // ─────────────────────────────────────────────
    //  createRoast
    // ─────────────────────────────────────────────

    function test_Create_CounterIncrements() public {
        assertEq(arena.roastCounter(), 0);
        _create(); assertEq(arena.roastCounter(), 1);
        _create(); assertEq(arena.roastCounter(), 2);
    }

    function test_Create_CreatorAutoJoins() public {
        uint256 id = _create();
        assertTrue(arena.hasJoined(id, creator));
        assertEq(arena.getRoast(id).participantCount, 1);
    }

    function test_Create_SetsStakeAmounts() public {
        uint256 id = _create();
        RoastArena.Roast memory r = arena.getRoast(id);
        assertEq(r.roastStake, ROAST_STAKE);
        assertEq(r.voteStake,  VOTE_STAKE);
    }

    function test_Create_RoasterPoolSeeded() public {
        uint256 id = _create();
        assertEq(arena.getRoast(id).roasterPool, ROAST_STAKE);
    }

    function test_Create_TimestampsCorrect() public {
        uint256 id = _create();
        RoastArena.Roast memory r = arena.getRoast(id);
        assertEq(r.openUntil, block.timestamp + OPEN_DURATION);
        assertEq(r.voteUntil, block.timestamp + TOTAL_DURATION);
    }

    function test_Create_StateIsOpen() public {
        uint256 id = _create();
        assertEq(uint(arena.getRoast(id).state), uint(RoastArena.RoastState.OPEN));
    }

    function test_Create_Revert_ZeroRoastStake() public {
        vm.prank(creator);
        vm.expectRevert(RoastArena.StakeTooLow.selector);
        arena.createRoast{value: 0}(0, VOTE_STAKE);
    }

    function test_Create_Revert_ZeroVoteStake() public {
        vm.prank(creator);
        vm.expectRevert(RoastArena.StakeTooLow.selector);
        arena.createRoast{value: ROAST_STAKE}(ROAST_STAKE, 0);
    }

    function test_Create_Revert_InsufficientETH() public {
        vm.prank(creator);
        vm.expectRevert(RoastArena.IncorrectStakeAmount.selector);
        arena.createRoast{value: ROAST_STAKE - 1}(ROAST_STAKE, VOTE_STAKE);
    }

    function test_Create_Revert_ExcessETH() public {
        vm.prank(creator);
        vm.expectRevert(RoastArena.IncorrectStakeAmount.selector);
        arena.createRoast{value: ROAST_STAKE + 1}(ROAST_STAKE, VOTE_STAKE);
    }

    // ─────────────────────────────────────────────
    //  joinRoast
    // ─────────────────────────────────────────────

    function test_Join_Success() public {
        uint256 id = _create();
        vm.prank(alice);
        arena.joinRoast{value: ROAST_STAKE}(id);
        assertTrue(arena.hasJoined(id, alice));
        assertEq(arena.getRoast(id).participantCount, 2);
    }

    function test_Join_PoolIncrements() public {
        uint256 id = _create();
        vm.prank(alice); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(bob);   arena.joinRoast{value: ROAST_STAKE}(id);
        assertEq(arena.getRoast(id).roasterPool, ROAST_STAKE * 3);
    }

    function test_Join_Revert_WrongETH_Low() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(RoastArena.IncorrectStakeAmount.selector);
        arena.joinRoast{value: ROAST_STAKE - 1}(id);
    }

    function test_Join_Revert_WrongETH_High() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(RoastArena.IncorrectStakeAmount.selector);
        arena.joinRoast{value: ROAST_STAKE + 1}(id);
    }

    function test_Join_Revert_AfterOpenWindow() public {
        uint256 id = _create();
        vm.warp(block.timestamp + OPEN_DURATION + 1);
        vm.prank(alice);
        vm.expectRevert(RoastArena.JoinWindowClosed.selector);
        arena.joinRoast{value: ROAST_STAKE}(id);
    }

    function test_Join_Revert_AtExactOpenDeadline() public {
        uint256 id = _create();
        vm.warp(arena.getRoast(id).openUntil);
        vm.prank(alice);
        vm.expectRevert(RoastArena.JoinWindowClosed.selector);
        arena.joinRoast{value: ROAST_STAKE}(id);
    }

    function test_Join_Revert_AlreadyJoined() public {
        uint256 id = _create();
        vm.prank(alice); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(alice);
        vm.expectRevert(RoastArena.AlreadyJoined.selector);
        arena.joinRoast{value: ROAST_STAKE}(id);
    }

    function test_Join_Revert_CreatorJoinsAgain() public {
        uint256 id = _create();
        vm.prank(creator);
        vm.expectRevert(RoastArena.AlreadyJoined.selector);
        arena.joinRoast{value: ROAST_STAKE}(id);
    }

    function test_Join_Revert_NonExistentRoast() public {
        vm.prank(alice);
        vm.expectRevert(RoastArena.RoastNotFound.selector);
        arena.joinRoast{value: ROAST_STAKE}(999);
    }

    // ─────────────────────────────────────────────
    //  vote
    // ─────────────────────────────────────────────

    function test_Vote_Success_AudienceMember() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1);
        arena.vote{value: VOTE_STAKE}(id, alice);
        assertEq(arena.votesFor(id, alice), 1);
    }

    function test_Vote_VoterPoolIncrements() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        assertEq(arena.getRoast(id).voterPool, VOTE_STAKE * 2);
    }

    function test_Vote_RecordsVotedFor() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1);
        arena.vote{value: VOTE_STAKE}(id, alice);
        assertEq(arena.votedFor(id, voter1), alice);
    }

    function test_Vote_RoasterCanAlsoVote() public {
        // Creator is a roaster — they can vote by paying voteStake on top
        uint256 id = _setupWithTwo();
        vm.prank(creator);
        arena.vote{value: VOTE_STAKE}(id, alice);  // creator pays extra voteStake
        assertEq(arena.getRoast(id).voterPool, VOTE_STAKE);
        assertEq(arena.votedFor(id, creator), alice);
    }

    function test_Vote_Revert_WrongETH() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1);
        vm.expectRevert(RoastArena.IncorrectStakeAmount.selector);
        arena.vote{value: VOTE_STAKE - 1}(id, alice);
    }

    function test_Vote_Revert_TooEarly() public {
        uint256 id = _create();
        vm.prank(alice); arena.joinRoast{value: ROAST_STAKE}(id);
        vm.prank(voter1);
        vm.expectRevert(RoastArena.NotInVotingWindow.selector);
        arena.vote{value: VOTE_STAKE}(id, alice);
    }

    function test_Vote_Revert_TooLate() public {
        uint256 id = _setupWithTwo();
        vm.warp(block.timestamp + VOTE_DURATION + 1);
        vm.prank(voter1);
        vm.expectRevert(RoastArena.NotInVotingWindow.selector);
        arena.vote{value: VOTE_STAKE}(id, alice);
    }

    function test_Vote_Revert_AtExactVoteDeadline() public {
        uint256 id = _setupWithTwo();
        vm.warp(arena.getRoast(id).voteUntil);
        vm.prank(voter1);
        vm.expectRevert(RoastArena.NotInVotingWindow.selector);
        arena.vote{value: VOTE_STAKE}(id, alice);
    }

    function test_Vote_Revert_DoubleVote() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter1);
        vm.expectRevert(RoastArena.AlreadyVoted.selector);
        arena.vote{value: VOTE_STAKE}(id, alice);
    }

    function test_Vote_Revert_SelfVote() public {
        uint256 id = _setupWithTwo();
        vm.prank(alice);
        vm.expectRevert(RoastArena.SelfVoteNotAllowed.selector);
        arena.vote{value: VOTE_STAKE}(id, alice);
    }

    function test_Vote_Revert_CandidateNotParticipant() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1);
        vm.expectRevert(RoastArena.CandidateNotParticipant.selector);
        arena.vote{value: VOTE_STAKE}(id, carol);  // carol never joined
    }

    // ─────────────────────────────────────────────
    //  settle
    // ─────────────────────────────────────────────

    function test_Settle_CorrectWinner_MostVotes() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter3); arena.vote{value: VOTE_STAKE}(id, bob);

        _warpPastVoting();
        vm.prank(alice); // roaster calls settle
        arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        assertEq(uint(r.state),    uint(RoastArena.RoastState.SETTLED));
        assertEq(r.numWinners,     1);
        assertTrue(arena.isWinner(id, alice));
        assertFalse(arena.isWinner(id, bob));
    }

    function test_Settle_TieSetsMultipleWinners() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, bob);

        _warpPastVoting();
        vm.prank(alice); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        assertEq(r.numWinners, 2);
        assertTrue(arena.isWinner(id, alice));
        assertTrue(arena.isWinner(id, bob));
    }

    function test_Settle_TieSetsWinnerVoterCount() public {
        uint256 id = _setupWithTwo();
        // 2 winners, highestVotes = 2 each => winnerVoterCount = 4
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter3); arena.vote{value: VOTE_STAKE}(id, bob);
        vm.prank(carol);  arena.vote{value: VOTE_STAKE}(id, bob);

        _warpPastVoting();
        vm.prank(alice); arena.settle(id);

        RoastArena.Roast memory r = arena.getRoast(id);
        assertEq(r.numWinners,       2);
        assertEq(r.highestVotes,     2);
        assertEq(r.winnerVoterCount, 4); // 2 winners * 2 votes each
    }

    function test_Settle_SingleVoteWins() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, bob);

        _warpPastVoting();
        vm.prank(voter1); arena.settle(id); // voter calls settle

        assertTrue(arena.isWinner(id, bob));
        assertFalse(arena.isWinner(id, alice));
    }

    function test_Settle_ParticipantCanSettle() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();

        vm.prank(bob); // roaster calls settle
        arena.settle(id);
        assertEq(uint(arena.getRoast(id).state), uint(RoastArena.RoastState.SETTLED));
    }

    function test_Settle_VoterCanSettle() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();

        vm.prank(voter1); // voter calls settle
        arena.settle(id);
        assertEq(uint(arena.getRoast(id).state), uint(RoastArena.RoastState.SETTLED));
    }

    function test_Settle_Revert_NotParticipantOrVoter() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();

        vm.prank(stranger); // never joined, never voted
        vm.expectRevert(RoastArena.NotParticipantOrVoter.selector);
        arena.settle(id);
    }

    function test_Settle_Revert_VotingNotEnded() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        // still inside voting window

        vm.prank(voter1);
        vm.expectRevert(RoastArena.VotingNotEnded.selector);
        arena.settle(id);
    }

    function test_Settle_Revert_DoubleSett() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(voter1);
        vm.expectRevert(RoastArena.AlreadyFinalized.selector);
        arena.settle(id);
    }

    function test_Settle_EdgeCase_OnlyCreator_Cancels() public {
        uint256 id = _create();
        vm.warp(block.timestamp + TOTAL_DURATION + 1);

        vm.prank(creator); arena.settle(id);
        assertEq(uint(arena.getRoast(id).state), uint(RoastArena.RoastState.CANCELLED));
    }

    function test_Settle_EdgeCase_NoVotes_Cancels() public {
        uint256 id = _setupWithTwo();
        _warpPastVoting();

        vm.prank(alice); arena.settle(id);
        assertEq(uint(arena.getRoast(id).state), uint(RoastArena.RoastState.CANCELLED));
    }

    function test_Settle_Revert_NotParticipantOrVoter_WhenNoVotes() public {
        // No votes = no hasVoted wallets, stranger has neither hasJoined nor hasVoted
        uint256 id = _setupWithTwo();
        _warpPastVoting();

        vm.prank(stranger);
        vm.expectRevert(RoastArena.NotParticipantOrVoter.selector);
        arena.settle(id);
    }

    // ─────────────────────────────────────────────
    //  claimRoasterReward
    // ─────────────────────────────────────────────

    function test_ClaimRoaster_WinnerGetsFullPool() public {
        uint256 id = _setupWithTwo(); // roasterPool = 3 * ROAST_STAKE
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice); // alice wins
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        arena.claimRoasterReward(id);

        // Alice gets all roasterPool (only 1 winner)
        assertEq(alice.balance - balBefore, 3 * ROAST_STAKE);
    }

    function test_ClaimRoaster_TieSplitsPool() public {
        uint256 id = _setupWithTwo(); // roasterPool = 3 * ROAST_STAKE
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, bob);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id); // 2 winners

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;
        vm.prank(alice); arena.claimRoasterReward(id);
        vm.prank(bob);   arena.claimRoasterReward(id);

        // Each gets half of roasterPool
        uint256 half = (3 * ROAST_STAKE) / 2;
        assertEq(alice.balance - aliceBefore, half);
        assertEq(bob.balance   - bobBefore,   half);
    }

    function test_ClaimRoaster_Revert_NotWinner() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(bob); // loser
        vm.expectRevert(RoastArena.NotWinner.selector);
        arena.claimRoasterReward(id);
    }

    function test_ClaimRoaster_Revert_DoubleClaim() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(alice); arena.claimRoasterReward(id);
        vm.prank(alice);
        vm.expectRevert(RoastArena.AlreadyClaimed.selector);
        arena.claimRoasterReward(id);
    }

    function test_ClaimRoaster_Revert_NotSettled() public {
        uint256 id = _setupWithTwo();
        vm.prank(alice);
        vm.expectRevert(RoastArena.NotSettled.selector);
        arena.claimRoasterReward(id);
    }

    // ─────────────────────────────────────────────
    //  claimVoterReward
    // ─────────────────────────────────────────────

    function test_ClaimVoter_WinnerVoterGetsShare() public {
        uint256 id = _setupWithTwo();
        // voterPool = 2 * VOTE_STAKE, alice wins with 2 votes
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        uint256 before = voter1.balance;
        vm.prank(voter1); arena.claimVoterReward(id);

        // winnerVoterCount = 1 * 2 = 2, each gets voterPool/2 = VOTE_STAKE
        assertEq(voter1.balance - before, VOTE_STAKE);
    }

    function test_ClaimVoter_PredictionMarketMultiplier() public {
        uint256 id = _setupWithTwo();
        // 2 voters back alice (winner), 1 voter backs bob (loser).
        // voterPool = 3 * VOTE_STAKE.
        // bob's losing stake flows to alice's backers:
        //   winnerVoterCount = 1 winner * 2 votes = 2
        //   each winner voter gets 3 * VOTE_STAKE / 2 = 1.5x their stake
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice); // correct pick
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice); // correct pick
        vm.prank(voter3); arena.vote{value: VOTE_STAKE}(id, bob);   // wrong pick — stake lost
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        uint256 before = voter1.balance;
        vm.prank(voter1); arena.claimVoterReward(id);

        // voter1 staked 0.5 ETH, wins 1.5x = 0.75 ETH (voter3's stake redistributed)
        assertEq(voter1.balance - before, (3 * VOTE_STAKE) / 2);
    }

    function test_ClaimVoter_TieSplitsAmongWinnerVoters() public {
        uint256 id = _setupWithTwo();
        // alice and bob both get 1 vote => tie, 2 winners
        // voterPool = 2 * VOTE_STAKE
        // winnerVoterCount = 2 * 1 = 2, each voter gets VOTE_STAKE
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, bob);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        uint256 b1 = voter1.balance;
        uint256 b2 = voter2.balance;
        vm.prank(voter1); arena.claimVoterReward(id);
        vm.prank(voter2); arena.claimVoterReward(id);

        // Both backed winners, each gets voterPool/2 = VOTE_STAKE (break-even)
        assertEq(voter1.balance - b1, VOTE_STAKE);
        assertEq(voter2.balance - b2, VOTE_STAKE);
    }

    function test_ClaimVoter_Revert_VotedForLoser() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice); // alice wins
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter3); arena.vote{value: VOTE_STAKE}(id, bob);   // bob loses
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(voter3); // voted for loser
        vm.expectRevert(RoastArena.VotedForLoser.selector);
        arena.claimVoterReward(id);
    }

    function test_ClaimVoter_Revert_DoubleClaim() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(voter1); arena.claimVoterReward(id);
        vm.prank(voter1);
        vm.expectRevert(RoastArena.AlreadyClaimed.selector);
        arena.claimVoterReward(id);
    }

    function test_ClaimVoter_Revert_NotSettled() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1);
        vm.expectRevert(RoastArena.NotSettled.selector);
        arena.claimVoterReward(id);
    }

    function test_ClaimVoter_Revert_NeverVoted() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(voter2); // never voted
        vm.expectRevert(RoastArena.NothingToClaim.selector);
        arena.claimVoterReward(id);
    }

    // ─────────────────────────────────────────────
    //  claimRefund (CANCELLED)
    // ─────────────────────────────────────────────

    function test_ClaimRefund_RoasterGetsStakeBack() public {
        // CANCELLED — only creator
        uint256 id = _create();
        vm.warp(block.timestamp + TOTAL_DURATION + 1);
        vm.prank(creator); arena.settle(id);

        uint256 before = creator.balance;
        vm.prank(creator); arena.claimRefund(id);
        assertEq(creator.balance - before, ROAST_STAKE);
    }

    function test_ClaimRefund_AllRoastersRefunded() public {
        // CANCELLED — no votes (2+ participants)
        uint256 id = _setupWithTwo(); // creator + alice + bob
        _warpPastVoting();
        vm.prank(alice); arena.settle(id);

        uint256 cBal = creator.balance;
        uint256 aBal = alice.balance;
        uint256 bBal = bob.balance;

        vm.prank(creator); arena.claimRefund(id);
        vm.prank(alice);   arena.claimRefund(id);
        vm.prank(bob);     arena.claimRefund(id);

        assertEq(creator.balance - cBal, ROAST_STAKE);
        assertEq(alice.balance   - aBal, ROAST_STAKE);
        assertEq(bob.balance     - bBal, ROAST_STAKE);
    }

    function test_ClaimRefund_Revert_NotCancelled() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(alice);
        vm.expectRevert(RoastArena.NotCancelled.selector);
        arena.claimRefund(id);
    }

    function test_ClaimRefund_Revert_NothingToClaim() public {
        uint256 id = _create();
        vm.warp(block.timestamp + TOTAL_DURATION + 1);
        vm.prank(creator); arena.settle(id);

        vm.prank(stranger); // was never part of the roast
        vm.expectRevert(RoastArena.NothingToClaim.selector);
        arena.claimRefund(id);
    }

    function test_ClaimRefund_Revert_DoubleRefund() public {
        uint256 id = _create();
        vm.warp(block.timestamp + TOTAL_DURATION + 1);
        vm.prank(creator); arena.settle(id);

        vm.prank(creator); arena.claimRefund(id);
        vm.prank(creator);
        vm.expectRevert(RoastArena.NothingToClaim.selector);
        arena.claimRefund(id);
    }

    // ─────────────────────────────────────────────
    //  ETH balance integrity (contract holds correct funds)
    // ─────────────────────────────────────────────

    function test_ContractBalance_AfterJoinsAndVotes() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, bob);

        // Contract should hold: 3 roastStakes + 2 voteStakes
        assertEq(address(arena).balance, 3 * ROAST_STAKE + 2 * VOTE_STAKE);
    }

    function test_ContractBalance_DrainedAfterAllClaims() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        vm.prank(alice);  arena.claimRoasterReward(id);  // all roasterPool
        vm.prank(voter1); arena.claimVoterReward(id);    // half voterPool
        vm.prank(voter2); arena.claimVoterReward(id);    // half voterPool

        // Dust from integer division (if any) stays. roasterPool = 3e18 / 1 = exact.
        // voterPool = 2 * 0.5e18 = 1e18, winnerVoterCount = 2 => each gets 0.5e18 = exact.
        assertEq(address(arena).balance, 0);
    }

    // ─────────────────────────────────────────────
    //  currentState view
    // ─────────────────────────────────────────────

    function test_CurrentState_Open() public {
        uint256 id = _create();
        assertEq(uint(arena.currentState(id)), uint(RoastArena.RoastState.OPEN));
    }

    function test_CurrentState_Voting_AfterOpenWindow() public {
        uint256 id = _setupWithTwo();
        assertEq(uint(arena.currentState(id)), uint(RoastArena.RoastState.VOTING));
    }

    function test_CurrentState_Voting_PendingSettle() public {
        uint256 id = _setupWithTwo();
        _warpPastVoting();
        assertEq(uint(arena.currentState(id)), uint(RoastArena.RoastState.VOTING));
    }

    function test_CurrentState_Settled() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);
        assertEq(uint(arena.currentState(id)), uint(RoastArena.RoastState.SETTLED));
    }

    function test_CurrentState_Cancelled() public {
        uint256 id = _create();
        vm.warp(block.timestamp + TOTAL_DURATION + 1);
        vm.prank(creator); arena.settle(id);
        assertEq(uint(arena.currentState(id)), uint(RoastArena.RoastState.CANCELLED));
    }

    // ─────────────────────────────────────────────
    //  getWinners view
    // ─────────────────────────────────────────────

    function test_GetWinners_SingleWinner() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        address[] memory winners = arena.getWinners(id);
        assertEq(winners.length, 1);
        assertEq(winners[0], alice);
    }

    function test_GetWinners_TiedWinners() public {
        uint256 id = _setupWithTwo();
        vm.prank(voter1); arena.vote{value: VOTE_STAKE}(id, alice);
        vm.prank(voter2); arena.vote{value: VOTE_STAKE}(id, bob);
        _warpPastVoting();
        vm.prank(voter1); arena.settle(id);

        address[] memory winners = arena.getWinners(id);
        assertEq(winners.length, 2);
    }

    // ─────────────────────────────────────────────
    //  getRecentRoasts pagination
    // ─────────────────────────────────────────────

    function test_GetRecentRoasts_NewestFirst() public {
        _create(); _create(); _create();
        uint256[] memory ids = arena.getRecentRoasts(3);
        assertEq(ids[0], 2);
        assertEq(ids[1], 1);
        assertEq(ids[2], 0);
    }

    function test_GetRecentRoasts_CountLargerThanTotal() public {
        _create();
        uint256[] memory ids = arena.getRecentRoasts(100);
        assertEq(ids.length, 1);
    }
}
