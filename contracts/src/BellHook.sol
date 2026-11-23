// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Minimal Chainlink aggregator interface (the Coinbase tokenized-stock feeds on Base).
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title BellHook — an opening auction for tokenized-stock pools
/// @notice Tokenized stocks trade 24/7 but their reference market jumps at scheduled reopens
///         (on Base the Coinbase feeds resume inside the Sunday 20:00 ET minute). Under continuous
///         trading the first arbitrageur after the reopen takes the whole gap from LPs.
///         BellHook detects the reopen trustlessly — the price feed starts updating again after
///         a long silence — and, for a short window of blocks, prices swaps with a fee that rises
///         with the transaction's priority fee (an "MEV tax", Robinson & White 2024). Competing
///         arbitrageurs bid priority fees up until most of the gap is paid to LPs as swap fees.
///         While the market is closed, flow is mostly uninformed, so fees stay low.
/// @dev One hook per reference feed. Pools must use the dynamic-fee flag.
contract BellHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    enum Phase {
        LIVE,
        DARK,
        AUCTION
    }

    struct Config {
        uint24 liveFee; // pips (1e6 = 100%) while the reference market is open
        uint24 darkFee; // pips while the reference market is closed
        uint24 maxAuctionFee; // cap on the auction fee, pips
        uint32 minDarkGap; // seconds of feed silence that count as a closed market
        uint16 auctionBlocks; // blocks the auction window stays open, starting with the bell block
        uint64 pipsPerGwei; // auction fee per gwei of priority fee
    }

    struct PoolState {
        uint64 lastSeenUpdatedAt; // last feed timestamp this hook has observed for the pool
        uint64 auctionEndBlock; // last block (inclusive) of the current auction window
        uint24 reserveFee; // keeper-set floor for the auction fee, from the dark-variance forecast
    }

    IPoolManager public immutable poolManager;
    IAggregatorV3 public immutable feed;
    address public immutable owner;
    address public keeper;
    Config public config;
    mapping(PoolId => PoolState) public pools;

    event Bell(PoolId indexed id, uint64 feedUpdatedAt, uint64 darkSeconds, uint64 auctionEndBlock);
    event FeeApplied(PoolId indexed id, Phase phase, uint24 fee, uint256 priorityFeeWei);
    event ReserveFeeSet(PoolId indexed id, uint24 fee);
    event KeeperSet(address keeper);

    error NotPoolManager();
    error NotKeeper();
    error NotOwner();
    error MustUseDynamicFee();
    error FeeTooHigh();
    error InvalidConfig();
    error HookNotImplemented();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @param _owner Set explicitly: hooks are deployed through a CREATE2 factory to mine their
    ///        flag-bearing address, so msg.sender here would be the factory, not the deployer.
    constructor(IPoolManager _poolManager, IAggregatorV3 _feed, address _owner, address _keeper, Config memory _config) {
        if (
            _config.liveFee > LPFeeLibrary.MAX_LP_FEE || _config.darkFee > LPFeeLibrary.MAX_LP_FEE
                || _config.maxAuctionFee > LPFeeLibrary.MAX_LP_FEE || _config.auctionBlocks == 0
                || _config.minDarkGap == 0
        ) revert InvalidConfig();
        if (_owner == address(0)) revert InvalidConfig();
        poolManager = _poolManager;
        feed = _feed;
        owner = _owner;
        keeper = _keeper;
        config = _config;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ───────────────────────────── hooks ─────────────────────────────

    function beforeInitialize(address, PoolKey calldata key, uint160) external onlyPoolManager returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert MustUseDynamicFee();
        pools[key.toId()].lastSeenUpdatedAt = _feedUpdatedAt();
        return IHooks.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        (Phase phase, uint24 fee, uint256 priority) = _syncAndPrice(id);
        emit FeeApplied(id, phase, fee, priority);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    // ─────────────────────────── public views ───────────────────────────

    /// @notice Phase and fee a swap would pay right now (ignores a bell not yet observed onchain).
    function quote(PoolKey calldata key) external view returns (Phase phase, uint24 fee) {
        PoolState memory s = pools[key.toId()];
        uint64 u = _feedUpdatedAt();
        bool bell = s.lastSeenUpdatedAt != 0 && u > s.lastSeenUpdatedAt && u - s.lastSeenUpdatedAt >= config.minDarkGap;
        if (bell || block.number <= s.auctionEndBlock) {
            (fee,) = _auctionFee(s.reserveFee);
            return (Phase.AUCTION, fee);
        }
        return _openOrDark(u);
    }

    // ─────────────────────────── permissionless ───────────────────────────

    /// @notice Sync the pool with the feed without swapping. Anyone may call it. A poke that
    ///         observes a reopen starts the auction, so poking cannot be used to skip it.
    function poke(PoolKey calldata key) external {
        _sync(key.toId());
    }

    // ───────────────────────────── keeper ─────────────────────────────

    /// @notice Set the auction reserve (floor fee) from the dark-variance forecast.
    function setReserveFee(PoolKey calldata key, uint24 fee) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (fee > config.maxAuctionFee) revert FeeTooHigh();
        PoolId id = key.toId();
        pools[id].reserveFee = fee;
        emit ReserveFeeSet(id, fee);
    }

    function setKeeper(address _keeper) external {
        if (msg.sender != owner) revert NotOwner();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _syncAndPrice(PoolId id) internal returns (Phase, uint24, uint256) {
        uint64 u = _sync(id);
        PoolState storage s = pools[id];
        if (block.number <= s.auctionEndBlock) {
            (uint24 fee, uint256 priority) = _auctionFee(s.reserveFee);
            return (Phase.AUCTION, fee, priority);
        }
        (Phase phase, uint24 f) = _openOrDark(u);
        return (phase, f, 0);
    }

    /// @dev Observes the feed; if it advanced after a silence of at least `minDarkGap`, rings the bell.
    function _sync(PoolId id) internal returns (uint64 u) {
        u = _feedUpdatedAt();
        PoolState storage s = pools[id];
        uint64 last = s.lastSeenUpdatedAt;
        if (u > last) {
            uint64 gap = u - last;
            if (last != 0 && gap >= config.minDarkGap) {
                uint64 end = uint64(block.number) + config.auctionBlocks - 1;
                s.auctionEndBlock = end;
                emit Bell(id, u, gap, end);
            }
            s.lastSeenUpdatedAt = u;
        }
    }

    function _auctionFee(uint24 reserve) internal view returns (uint24 fee, uint256 priority) {
        priority = tx.gasprice > block.basefee ? tx.gasprice - block.basefee : 0;
        uint256 f = (priority * config.pipsPerGwei) / 1 gwei;
        if (f < reserve) f = reserve;
        if (f > config.maxAuctionFee) f = config.maxAuctionFee;
        fee = uint24(f);
    }

    function _openOrDark(uint64 u) internal view returns (Phase, uint24) {
        if (u != 0 && block.timestamp >= u && block.timestamp - u >= config.minDarkGap) {
            return (Phase.DARK, config.darkFee);
        }
        return (Phase.LIVE, config.liveFee);
    }

    /// @dev A broken or reverting feed must never brick the pool: fall back to "unknown" (0).
    function _feedUpdatedAt() internal view returns (uint64) {
        try feed.latestRoundData() returns (uint80, int256, uint256, uint256 updatedAt, uint80) {
            return uint64(updatedAt);
        } catch {
            return 0;
        }
    }

    // ───────────────────────── unused hook entrypoints ─────────────────────────

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
