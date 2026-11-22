// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {BellHook, IAggregatorV3} from "../src/BellHook.sol";

contract MockFeed is IAggregatorV3 {
    uint256 public updatedAt;
    bool public broken;

    function set(uint256 u) external {
        updatedAt = u;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed down");
        return (1, 130e8, updatedAt, updatedAt, 1);
    }
}

contract BellHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    BellHook hook;
    MockFeed feed;
    PoolId id;
    address keeper = makeAddr("keeper");

    uint24 constant LIVE_FEE = 3000; // 0.30%
    uint24 constant DARK_FEE = 500; // 0.05%
    uint24 constant MAX_FEE = 100_000; // 10%
    uint32 constant GAP = 6 hours;
    uint16 constant AUCTION_BLOCKS = 2;
    uint64 constant PIPS_PER_GWEI = 100_000; // 0.1 gwei of priority => 1% fee
    uint256 constant BASEFEE = 0.01 gwei;

    event Bell(PoolId indexed id, uint64 feedUpdatedAt, uint64 darkSeconds, uint64 auctionEndBlock);
    event FeeApplied(PoolId indexed id, BellHook.Phase phase, uint24 fee, uint256 priorityFeeWei);

    function setUp() public {
        vm.warp(1_795_000_000);
        vm.roll(100);
        vm.fee(BASEFEE);
        vm.txGasPrice(BASEFEE);

        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        feed = new MockFeed();
        feed.set(block.timestamp);

        address flags = address(uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x4444 << 144));
        BellHook.Config memory cfg =
            BellHook.Config(LIVE_FEE, DARK_FEE, MAX_FEE, GAP, AUCTION_BLOCKS, PIPS_PER_GWEI);
        deployCodeTo("BellHook.sol:BellHook", abi.encode(manager, feed, address(this), keeper, cfg), flags);
        hook = BellHook(flags);

        (key, id) =
            initPoolAndAddLiquidity(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);
    }

    // ─── helpers ───

    function _swap() internal returns (BalanceDelta) {
        return swap(key, true, -1e15, ZERO_BYTES); // exact input 0.001 token0
    }

    function _expectFee(BellHook.Phase phase, uint24 fee, uint256 prio) internal {
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(id, phase, fee, prio);
    }

    /// Market closes, stays dark for `darkFor`, then the feed wakes up at the current time.
    function _weekendThenWake(uint256 darkFor) internal {
        vm.warp(block.timestamp + darkFor);
        vm.roll(block.number + darkFor / 2);
        feed.set(block.timestamp);
    }

    // ─── setup / permissions ───

    function test_rejectsStaticFeePool() public {
        vm.expectRevert();
        initPool(currency0, currency1, IHooks(address(hook)), 3000, SQRT_PRICE_1_1);
    }

    function test_onlyPoolManagerCanCallHooks() public {
        vm.expectRevert(BellHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, SwapParams(true, -1, 0), ZERO_BYTES);
    }

    function test_invalidConfigReverts() public {
        BellHook.Config memory bad = BellHook.Config(LIVE_FEE, DARK_FEE, MAX_FEE, GAP, 0, PIPS_PER_GWEI);
        vm.expectRevert(BellHook.InvalidConfig.selector);
        new BellHook(manager, feed, address(this), keeper, bad);
    }

    function test_zeroOwnerReverts() public {
        BellHook.Config memory cfg = BellHook.Config(LIVE_FEE, DARK_FEE, MAX_FEE, GAP, AUCTION_BLOCKS, PIPS_PER_GWEI);
        vm.expectRevert(BellHook.InvalidConfig.selector);
        new BellHook(manager, feed, address(0), keeper, cfg);
    }

    /// Deploying through a CREATE2 factory (as the deploy script does) must still give the
    /// deployer ownership, not the factory.
    function test_create2DeploymentKeepsExplicitOwner() public {
        address deployer = makeAddr("deployer");
        BellHook.Config memory cfg = BellHook.Config(LIVE_FEE, DARK_FEE, MAX_FEE, GAP, AUCTION_BLOCKS, PIPS_PER_GWEI);
        bytes memory args = abi.encode(manager, feed, deployer, keeper, cfg);
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address expected, bytes32 salt) = HookMiner.find(address(this), flags, type(BellHook).creationCode, args);
        BellHook h = new BellHook{salt: salt}(manager, feed, deployer, keeper, cfg);
        assertEq(address(h), expected);
        assertEq(h.owner(), deployer);
        vm.prank(deployer);
        h.setKeeper(address(7));
        assertEq(h.keeper(), address(7));
    }

    // ─── phases ───

    function test_liveFeeWhileMarketOpen() public {
        _expectFee(BellHook.Phase.LIVE, LIVE_FEE, 0);
        _swap();
    }

    function test_darkFeeWhileMarketClosed() public {
        vm.warp(block.timestamp + GAP + 1);
        _expectFee(BellHook.Phase.DARK, DARK_FEE, 0);
        _swap();
    }

    function test_bellStartsAuctionPricedByPriorityFee() public {
        _weekendThenWake(48 hours);
        vm.txGasPrice(BASEFEE + 0.2 gwei); // 0.2 gwei priority => 2%
        vm.expectEmit(true, false, false, true, address(hook));
        emit Bell(id, uint64(block.timestamp), uint64(48 hours), uint64(block.number + AUCTION_BLOCKS - 1));
        _expectFee(BellHook.Phase.AUCTION, 20_000, 0.2 gwei);
        _swap();
    }

    function test_auctionFeeHasKeeperReserveFloor() public {
        vm.prank(keeper);
        hook.setReserveFee(key, 30_000);
        _weekendThenWake(48 hours);
        _expectFee(BellHook.Phase.AUCTION, 30_000, 0); // no priority fee, reserve applies
        _swap();
    }

    function test_auctionFeeIsCapped() public {
        _weekendThenWake(48 hours);
        vm.txGasPrice(BASEFEE + 10 gwei); // would be 100%
        _expectFee(BellHook.Phase.AUCTION, MAX_FEE, 10 gwei);
        _swap();
    }

    function test_auctionLastsExactlyAuctionBlocks() public {
        _weekendThenWake(48 hours);
        _swap(); // bell block
        vm.roll(block.number + 1);
        _expectFee(BellHook.Phase.AUCTION, 0, 0);
        _swap();
        vm.roll(block.number + 1);
        _expectFee(BellHook.Phase.LIVE, LIVE_FEE, 0);
        _swap();
    }

    function test_shortSilenceDoesNotRingBell() public {
        vm.warp(block.timestamp + 1 hours);
        feed.set(block.timestamp);
        _expectFee(BellHook.Phase.LIVE, LIVE_FEE, 0);
        _swap();
    }

    function test_bellRingsOncePerReopen() public {
        _weekendThenWake(48 hours);
        _swap();
        vm.roll(block.number + AUCTION_BLOCKS);
        vm.warp(block.timestamp + 60);
        feed.set(block.timestamp); // normal intraday update
        _expectFee(BellHook.Phase.LIVE, LIVE_FEE, 0);
        _swap();
    }

    function test_pokeCannotSkipTheAuction() public {
        _weekendThenWake(48 hours);
        hook.poke(key); // someone syncs first, in the same block
        vm.txGasPrice(BASEFEE + 0.05 gwei);
        _expectFee(BellHook.Phase.AUCTION, 5_000, 0.05 gwei);
        _swap();
    }

    function test_quoteMatchesSwap() public {
        _weekendThenWake(48 hours);
        vm.txGasPrice(BASEFEE + 0.3 gwei);
        (BellHook.Phase phase, uint24 fee) = hook.quote(key);
        assertEq(uint8(phase), uint8(BellHook.Phase.AUCTION));
        assertEq(fee, 30_000);
        _expectFee(BellHook.Phase.AUCTION, 30_000, 0.3 gwei);
        _swap();
    }

    // ─── robustness ───

    function test_brokenFeedFallsBackToLiveAndNeverBricksPool() public {
        feed.setBroken(true);
        _expectFee(BellHook.Phase.LIVE, LIVE_FEE, 0);
        _swap();
    }

    function test_onlyKeeperSetsReserve() public {
        vm.expectRevert(BellHook.NotKeeper.selector);
        hook.setReserveFee(key, 1000);
    }

    function test_reserveAboveCapReverts() public {
        vm.prank(keeper);
        vm.expectRevert(BellHook.FeeTooHigh.selector);
        hook.setReserveFee(key, MAX_FEE + 1);
    }

    function test_onlyOwnerSetsKeeper() public {
        vm.prank(keeper);
        vm.expectRevert(BellHook.NotOwner.selector);
        hook.setKeeper(address(1));
    }

    // ─── economics: the auction moves the reopen gap from the arbitrageur to LPs ───

    function test_auctionArbGetsLessThanContinuousArb() public {
        uint256 snap = vm.snapshotState();
        _weekendThenWake(48 hours);
        // Baseline: same reopen, no competition (no priority) and no reserve => near-zero fee
        BalanceDelta cheap = _swap();
        vm.revertToState(snap);

        _weekendThenWake(48 hours);
        vm.txGasPrice(BASEFEE + 0.5 gwei); // competitive searchers bid 0.5 gwei => 5% fee to LPs
        BalanceDelta taxed = _swap();

        // Same input, the taxed arb receives strictly less output: the difference stays in the pool.
        assertGt(cheap.amount1(), taxed.amount1());
    }

    function testFuzz_auctionFeeMonotoneInPriorityAndBounded(uint64 prioGwei100) public {
        uint256 prio = uint256(prioGwei100 % 10_000) * 0.01 gwei; // 0 .. 100 gwei
        _weekendThenWake(48 hours);
        vm.txGasPrice(BASEFEE + prio);
        (, uint24 fee) = hook.quote(key);
        assertLe(fee, MAX_FEE);
        uint256 expected = (prio * PIPS_PER_GWEI) / 1 gwei;
        assertEq(fee, expected > MAX_FEE ? MAX_FEE : expected);
    }
}
