// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {BellHook, IAggregatorV3} from "../src/BellHook.sol";
import {MockEquityFeed} from "./DeployBell.s.sol";

/// @notice End-to-end testnet demo of BellHook. Deploys mock tokens, a mock equity feed, the hook and a pool
///         (reusing Uniswap's deployed PoolManager and test routers when given, else deploying its own for a
///         local anvil rehearsal), then drives the hook through its phases so `FeeApplied` events show them.
///         Run through `contracts/demo.sh`; entry points:
///           setup()               deploy + initialise the pool + add liquidity, write demo/state.env
///           push(int256 answer)   feed prints a new price "now" (the reopen)
///           swap(uint256 usdcIn)  buy stock with `usdcIn` USDC (raw, 6 decimals) through the hook
///         State between runs comes from env: SWAP_ROUTER, HOOK, FEED, STOCK, USDC.
contract DemoBell is Script {
    int24 internal constant SPACING = 60;
    int24 internal constant CENTER = 2580; // 1.0001^2580 ≈ 1.2945 raw ≈ $129.45 at 8 / 6 decimals
    int24 internal constant HALF_RANGE = 1200;

    struct S {
        address mgr;
        address swapRouter;
        address liqRouter;
        address stock;
        address usdc;
        address feed;
        address hook;
        uint256 minDarkGap;
        uint256 auctionBlocks;
    }

    function _key(address stock, address usdc, address hook) internal pure returns (PoolKey memory key, bool usdcIsToken0) {
        usdcIsToken0 = usdc < stock;
        (address a, address b) = usdcIsToken0 ? (usdc, stock) : (stock, usdc);
        key = PoolKey(Currency.wrap(a), Currency.wrap(b), LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING, IHooks(hook));
    }

    function setup() external {
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        S memory s;
        _infra(s, sender);
        _tokens(s, sender);
        _hook(s, sender);
        _pool(s);
        vm.stopBroadcast();

        string memory out = "";
        out = _line(out, "MANAGER", s.mgr);
        out = _line(out, "SWAP_ROUTER", s.swapRouter);
        out = _line(out, "LIQ_ROUTER", s.liqRouter);
        out = _line(out, "HOOK", s.hook);
        out = _line(out, "FEED", s.feed);
        out = _line(out, "STOCK", s.stock);
        out = _line(out, "USDC", s.usdc);
        out = string.concat(out, "MIN_DARK_GAP_S=", vm.toString(s.minDarkGap), "\nAUCTION_BLOCKS=", vm.toString(s.auctionBlocks), "\n");
        vm.writeFile("demo/state.env", out);
        console2.log("BellHook", s.hook);
        console2.log("Pool initialised and funded. State written to demo/state.env");
    }

    function _line(string memory acc, string memory k, address v) internal pure returns (string memory) {
        return string.concat(acc, k, "=", vm.toString(v), "\n");
    }

    function _infra(S memory s, address sender) internal {
        s.mgr = vm.envOr("POOL_MANAGER", address(0));
        if (s.mgr == address(0)) s.mgr = address(new PoolManager(sender));
        s.swapRouter = vm.envOr("SWAP_ROUTER", address(0));
        if (s.swapRouter == address(0)) s.swapRouter = address(new PoolSwapTest(IPoolManager(s.mgr)));
        s.liqRouter = vm.envOr("LIQ_ROUTER", address(0));
        if (s.liqRouter == address(0)) s.liqRouter = address(new PoolModifyLiquidityTest(IPoolManager(s.mgr)));
    }

    function _tokens(S memory s, address sender) internal {
        MockERC20 stock = new MockERC20("Mock NVIDIA", "mNVDAc", 8);
        MockERC20 usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        stock.mint(sender, 1e15);
        usdc.mint(sender, 1e15);
        stock.approve(s.swapRouter, type(uint256).max);
        usdc.approve(s.swapRouter, type(uint256).max);
        stock.approve(s.liqRouter, type(uint256).max);
        usdc.approve(s.liqRouter, type(uint256).max);
        s.stock = address(stock);
        s.usdc = address(usdc);
        s.feed = address(new MockEquityFeed(int256(130e8)));
    }

    function _hook(S memory s, address sender) internal {
        BellHook.Config memory cfg = BellHook.Config({
            liveFee: uint24(vm.envOr("LIVE_FEE_PIPS", uint256(500))), // 0.05%
            darkFee: uint24(vm.envOr("DARK_FEE_PIPS", uint256(300))), // 0.03%
            maxAuctionFee: uint24(vm.envOr("MAX_AUCTION_FEE_PIPS", uint256(100_000))), // 10%
            minDarkGap: uint32(vm.envOr("DEMO_DARK_GAP_S", uint256(90))),
            auctionBlocks: uint16(vm.envOr("DEMO_AUCTION_BLOCKS", uint256(20))),
            pipsPerGwei: uint64(vm.envOr("PIPS_PER_GWEI", uint256(10_000_000))) // 0.001 gwei priority => 1%
        });
        bytes memory args = abi.encode(IPoolManager(s.mgr), IAggregatorV3(s.feed), sender, sender, cfg);
        (address expected, bytes32 salt) = HookMiner.find(
            CREATE2_FACTORY, uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG), type(BellHook).creationCode, args
        );
        BellHook hook = new BellHook{salt: salt}(IPoolManager(s.mgr), IAggregatorV3(s.feed), sender, sender, cfg);
        require(address(hook) == expected, "hook address mismatch");
        s.hook = address(hook);
        s.minDarkGap = cfg.minDarkGap;
        s.auctionBlocks = cfg.auctionBlocks;
    }

    function _pool(S memory s) internal {
        (PoolKey memory key, bool usdcIsToken0) = _key(s.stock, s.usdc, s.hook);
        // raw price is token1/token0: stock-as-token0 prices at +CENTER, stock-as-token1 at -CENTER
        int24 center = usdcIsToken0 ? -CENTER : CENTER;
        IPoolManager(s.mgr).initialize(key, TickMath.getSqrtPriceAtTick(center));
        PoolModifyLiquidityTest(s.liqRouter).modifyLiquidity(
            key, ModifyLiquidityParams(center - HALF_RANGE, center + HALF_RANGE, int256(3e12), bytes32(0)), ""
        );
    }

    function push(int256 answer) external {
        vm.startBroadcast();
        MockEquityFeed(vm.envAddress("FEED")).push(answer, 0);
        vm.stopBroadcast();
    }

    function swap(uint256 usdcIn) external {
        (PoolKey memory key, bool usdcIsToken0) = _key(vm.envAddress("STOCK"), vm.envAddress("USDC"), vm.envAddress("HOOK"));
        vm.startBroadcast();
        PoolSwapTest(vm.envAddress("SWAP_ROUTER")).swap(
            key,
            SwapParams({
                zeroForOne: usdcIsToken0, // buying the stock means spending USDC
                amountSpecified: -int256(usdcIn),
                sqrtPriceLimitX96: usdcIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();
    }
}
