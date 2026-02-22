// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RoastArena
 * @notice Open roast battles on Monad with dual staking pools.
 *
 * ---- Pools ----
 *   Roasters Pool  : every roaster pays `roastStake` MON on join.
 *                    Tied winners split this pool equally.
 *   Voters Pool    : every voter pays `voteStake` MON on vote.
 *                    Voters who backed a winner share this pool.
 *                    Losing voters' stakes flow to winning voters
 *                    (prediction-market incentive).
 *
 * ---- Timeline ----
 *   [0, openUntil)  : OPEN   — roasters join
 *   [openUntil, voteUntil) : VOTING — anyone votes
 *   >= voteUntil    : settle() callable by any participant or voter
 *
 * ---- Edge cases ----
 *   - Zero stakes not allowed (mandatory minimum enforced)
 *   - Only 1 roaster        => CANCELLED, roaster refunded
 *   - 0 votes cast          => CANCELLED, roasters refunded
 *   - Tied vote count       => roasterPool split equally among all tied winners
 *                             voterPool split among voters who backed any winner
 *   - Roasters can also vote (pay extra voteStake on top of roastStake)
 *   - settle() restricted to participants OR voters
 *   - All claims use pull pattern with reentrancy guard
 */
contract RoastArena {

    // ─────────────────────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────────────────────

    enum RoastState {
        OPEN,
        VOTING,
        SETTLED,
        CANCELLED
    }

    struct Roast {
        uint256 id;
        address creator;
        uint256 openUntil;
        uint256 voteUntil;
        uint256 roastStake;       // MON required per roaster (> 0)
        uint256 voteStake;        // MON required per voter  (> 0)
        RoastState state;
        uint256 participantCount;
        uint256 totalVotes;
        uint256 roasterPool;      // accumulated roaster stakes
        uint256 voterPool;        // accumulated voter stakes
        uint256 highestVotes;     // peak vote count — identifies winners at settle
        uint256 numWinners;       // set at settle: number of tied winners
        uint256 winnerVoterCount; // numWinners * highestVotes — denominator for voter share
    }

    // ─────────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────────

    uint256 public roastCounter;
    bool    private _locked;

    mapping(uint256 => Roast)                         public  roasts;
    mapping(uint256 => address[])                     private _participants;
    mapping(uint256 => address[])                     private _winners;

    mapping(uint256 => mapping(address => bool))      public  hasJoined;
    mapping(uint256 => mapping(address => bool))      public  hasVoted;
    mapping(uint256 => mapping(address => uint256))   public  votesFor;
    mapping(uint256 => mapping(address => address))   public  votedFor;      // voter => candidate
    mapping(uint256 => mapping(address => bool))      public  isWinner;
    mapping(uint256 => mapping(address => bool))      public  hasClaimedRoaster;
    mapping(uint256 => mapping(address => bool))      public  hasClaimedVoter;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RoastCreated(
        uint256 indexed roastId,
        address indexed creator,
        uint256 roastStake,
        uint256 voteStake,
        uint256 openUntil,
        uint256 voteUntil
    );
    event ParticipantJoined(uint256 indexed roastId, address indexed participant);
    event VoteCast(uint256 indexed roastId, address indexed voter, address indexed candidate);
    event RoastSettled(
        uint256 indexed roastId,
        uint256 numWinners,
        uint256 roasterPool,
        uint256 voterPool,
        uint256 winnerVoterCount
    );
    event RoastCancelled(uint256 indexed roastId, string reason);
    event RewardClaimed(
        uint256 indexed roastId,
        address indexed claimer,
        uint256 amount,
        bool    isRoasterReward   // true = roaster pool, false = voter pool
    );
    event RefundClaimed(uint256 indexed roastId, address indexed claimer, uint256 amount);

    // ─────────────────────────────────────────────────────────────
    //  Custom Errors
    // ─────────────────────────────────────────────────────────────

    error RoastNotFound();
    error StakeTooLow();
    error IncorrectStakeAmount();
    error JoinWindowClosed();
    error AlreadyJoined();
    error NotInVotingWindow();
    error AlreadyVoted();
    error CandidateNotParticipant();
    error SelfVoteNotAllowed();
    error VotingNotEnded();
    error AlreadyFinalized();
    error NotParticipantOrVoter();
    error NotSettled();
    error NotCancelled();
    error NotWinner();
    error VotedForLoser();
    error AlreadyClaimed();
    error NothingToClaim();

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier exists(uint256 roastId) {
        if (roastId >= roastCounter) revert RoastNotFound();
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    // ─────────────────────────────────────────────────────────────
    //  Core Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a roast arena. Creator sets both stake amounts and
     *         auto-joins as the first roaster (must send exactly roastStake).
     * @param roastStake MON each roaster must stake to join.
     * @param voteStake  MON each voter must stake to vote.
     */
    function createRoast(
        uint256 roastStake,
        uint256 voteStake
    ) external payable returns (uint256 roastId) {
        if (roastStake == 0 || voteStake == 0) revert StakeTooLow();
        if (msg.value != roastStake)            revert IncorrectStakeAmount();

        roastId = roastCounter++;
        uint256 openUntil = block.timestamp + 3 minutes;
        uint256 voteUntil = openUntil + 4 minutes;

        roasts[roastId] = Roast({
            id:               roastId,
            creator:          msg.sender,
            openUntil:        openUntil,
            voteUntil:        voteUntil,
            roastStake:       roastStake,
            voteStake:        voteStake,
            state:            RoastState.OPEN,
            participantCount: 0,
            totalVotes:       0,
            roasterPool:      0,
            voterPool:        0,
            highestVotes:     0,
            numWinners:       0,
            winnerVoterCount: 0
        });

        _join(roastId, msg.sender, roastStake);

        emit RoastCreated(roastId, msg.sender, roastStake, voteStake, openUntil, voteUntil);
    }

    /**
     * @notice Join as a roaster. Must send exactly roast.roastStake MON.
     *         Open only during the 3-minute join window.
     */
    function joinRoast(uint256 roastId) external payable exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (block.timestamp >= roast.openUntil)  revert JoinWindowClosed();
        if (hasJoined[roastId][msg.sender])       revert AlreadyJoined();
        if (msg.value != roast.roastStake)        revert IncorrectStakeAmount();

        _join(roastId, msg.sender, roast.roastStake);
        emit ParticipantJoined(roastId, msg.sender);
    }

    /**
     * @notice Cast a vote for a participant. Must send exactly roast.voteStake MON.
     *         - Anyone can vote, including roasters (they pay voteStake on top).
     *         - Participants cannot vote for themselves.
     *         - One vote per wallet per roast.
     *         - Losing voters' stakes flow to winning voters (prediction-market).
     */
    function vote(uint256 roastId, address candidate) external payable exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (block.timestamp < roast.openUntil)   revert NotInVotingWindow();
        if (block.timestamp >= roast.voteUntil)  revert NotInVotingWindow();
        if (hasVoted[roastId][msg.sender])        revert AlreadyVoted();
        if (!hasJoined[roastId][candidate])       revert CandidateNotParticipant();
        if (msg.sender == candidate)              revert SelfVoteNotAllowed();
        if (msg.value != roast.voteStake)         revert IncorrectStakeAmount();

        // Lazy OPEN -> VOTING on first vote
        if (roast.state == RoastState.OPEN) {
            roast.state = RoastState.VOTING;
        }

        hasVoted[roastId][msg.sender]    = true;
        votedFor[roastId][msg.sender]    = candidate;
        votesFor[roastId][candidate]++;
        roast.totalVotes++;
        roast.voterPool += msg.value;

        if (votesFor[roastId][candidate] > roast.highestVotes) {
            roast.highestVotes = votesFor[roastId][candidate];
        }

        emit VoteCast(roastId, msg.sender, candidate);
    }

    /**
     * @notice Settle the roast after the voting window closes.
     *         Only callable by roasters or voters of this roast.
     *
     *         Tie rule: ALL candidates tied at highestVotes are winners.
     *         roasterPool splits equally among winners.
     *         voterPool splits among voters who backed ANY winner.
     *
     *         CANCELLED when: < 2 roasters OR 0 votes cast.
     */
    function settle(uint256 roastId) external exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (block.timestamp < roast.voteUntil)  revert VotingNotEnded();
        if (
            roast.state == RoastState.SETTLED ||
            roast.state == RoastState.CANCELLED
        ) revert AlreadyFinalized();

        // Access: must be a roaster or a voter
        if (
            !hasJoined[roastId][msg.sender] &&
            !hasVoted[roastId][msg.sender]
        ) revert NotParticipantOrVoter();

        // ── Cancellation paths ────────────────────────────────────
        if (roast.participantCount <= 1) {
            roast.state = RoastState.CANCELLED;
            emit RoastCancelled(roastId, "Not enough participants");
            return;
        }
        if (roast.totalVotes == 0) {
            roast.state = RoastState.CANCELLED;
            emit RoastCancelled(roastId, "No votes cast");
            return;
        }

        // ── Find all winners (O(n), n = participantCount) ─────────
        address[] memory parts = _participants[roastId];
        uint256 numWinners;
        for (uint256 i = 0; i < parts.length; i++) {
            if (votesFor[roastId][parts[i]] == roast.highestVotes) {
                isWinner[roastId][parts[i]] = true;
                _winners[roastId].push(parts[i]);
                numWinners++;
            }
        }

        roast.numWinners       = numWinners;
        roast.winnerVoterCount = numWinners * roast.highestVotes;
        roast.state            = RoastState.SETTLED;

        emit RoastSettled(
            roastId,
            numWinners,
            roast.roasterPool,
            roast.voterPool,
            roast.winnerVoterCount
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  Claim Functions  (pull pattern, nonReentrant)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Winners claim their share of the roasterPool.
     *         share = roasterPool / numWinners
     *         (integer division; dust stays in contract)
     */
    function claimRoasterReward(uint256 roastId) external nonReentrant exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (roast.state != RoastState.SETTLED)           revert NotSettled();
        if (!isWinner[roastId][msg.sender])              revert NotWinner();
        if (hasClaimedRoaster[roastId][msg.sender])      revert AlreadyClaimed();

        hasClaimedRoaster[roastId][msg.sender] = true;
        uint256 share = roast.roasterPool / roast.numWinners;

        payable(msg.sender).transfer(share);
        emit RewardClaimed(roastId, msg.sender, share, true);
    }

    /**
     * @notice Voters who backed a winner claim their share of the voterPool.
     *         share = voterPool / winnerVoterCount
     *
     *         Payout multiplier = totalVotes / (numWinners * highestVotes)
     *         If ALL votes backed winners, each voter breaks even.
     *         Losing voters' stakes enrich winning voters.
     */
    function claimVoterReward(uint256 roastId) external nonReentrant exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (roast.state != RoastState.SETTLED)                    revert NotSettled();
        if (!hasVoted[roastId][msg.sender])                       revert NothingToClaim();
        if (!isWinner[roastId][votedFor[roastId][msg.sender]])    revert VotedForLoser();
        if (hasClaimedVoter[roastId][msg.sender])                 revert AlreadyClaimed();

        hasClaimedVoter[roastId][msg.sender] = true;
        uint256 share = roast.voterPool / roast.winnerVoterCount;

        payable(msg.sender).transfer(share);
        emit RewardClaimed(roastId, msg.sender, share, false);
    }

    /**
     * @notice Claim refunds from a CANCELLED roast.
     *         Roasters get roastStake back.
     *         Voters (if any) get voteStake back.
     *         Both can be claimed in a single call.
     */
    function claimRefund(uint256 roastId) external nonReentrant exists(roastId) {
        Roast storage roast = roasts[roastId];

        if (roast.state != RoastState.CANCELLED) revert NotCancelled();

        uint256 refund;

        if (hasJoined[roastId][msg.sender] && !hasClaimedRoaster[roastId][msg.sender]) {
            hasClaimedRoaster[roastId][msg.sender] = true;
            refund += roast.roastStake;
        }
        if (hasVoted[roastId][msg.sender] && !hasClaimedVoter[roastId][msg.sender]) {
            hasClaimedVoter[roastId][msg.sender] = true;
            refund += roast.voteStake;
        }

        if (refund == 0) revert NothingToClaim();

        payable(msg.sender).transfer(refund);
        emit RefundClaimed(roastId, msg.sender, refund);
    }

    // ─────────────────────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Effective current state based on block.timestamp.
     *         Stored state lags until settle() is called.
     */
    function currentState(uint256 roastId)
        external
        view
        exists(roastId)
        returns (RoastState)
    {
        Roast storage roast = roasts[roastId];
        if (
            roast.state == RoastState.SETTLED ||
            roast.state == RoastState.CANCELLED
        ) return roast.state;
        if (block.timestamp < roast.openUntil) return RoastState.OPEN;
        return RoastState.VOTING;
    }

    function getRoast(uint256 roastId)
        external
        view
        exists(roastId)
        returns (Roast memory)
    {
        return roasts[roastId];
    }

    function getParticipants(uint256 roastId)
        external
        view
        exists(roastId)
        returns (address[] memory)
    {
        return _participants[roastId];
    }

    /**
     * @notice Returns winner addresses (populated after settle()).
     */
    function getWinners(uint256 roastId)
        external
        view
        exists(roastId)
        returns (address[] memory)
    {
        return _winners[roastId];
    }

    function getVoteCounts(uint256 roastId, address[] calldata candidates)
        external
        view
        exists(roastId)
        returns (uint256[] memory counts)
    {
        counts = new uint256[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            counts[i] = votesFor[roastId][candidates[i]];
        }
    }

    function getRecentRoasts(uint256 count)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256 total = roastCounter;
        if (count > total) count = total;
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = total - 1 - i;
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────

    function _join(uint256 roastId, address participant, uint256 stakeAmount) internal {
        hasJoined[roastId][participant] = true;
        _participants[roastId].push(participant);
        roasts[roastId].participantCount++;
        roasts[roastId].roasterPool += stakeAmount;
    }
}
