// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {BellHook, IAggregatorV3} from "../src/BellHook.sol";

/// @notice Testnet stand-in for a Coinbase/Chainlink equity feed (those exist only on Base mainnet).
///         The owner replays real (answer, updatedAt) pairs into it, e.g. a weekend then a Sunday 20:00 print.
contract MockEquityFeed is IAggregatorV3 {
    address public immutable owner;
    uint80 public roundId;
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 _answer) {
        owner = msg.sender;
        roundId = 1;
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function push(int256 _answer, uint256 _updatedAt) external {
        require(msg.sender == owner, "not owner");
        roundId++;
        answer = _answer;
        updatedAt = _updatedAt == 0 ? block.timestamp : _updatedAt; // 0 = "now" (the chain's clock, not the script's)
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}

/// @notice Mines a hook address carrying BEFORE_INITIALIZE | BEFORE_SWAP and deploys BellHook through
///         the CREATE2 deployer proxy.
///
///   POOL_MANAGER=0x... forge script script/DeployBell.s.sol --rpc-url $RPC --account <keystore> --broadcast
///
/// Env (all optional except POOL_MANAGER):
///   FEED                  Chainlink-style feed; unset => deploy MockEquityFeed (testnets)
///   OWNER, KEEPER         default: the broadcasting account
///   LIVE_FEE_PIPS 500     DARK_FEE_PIPS 300     MAX_AUCTION_FEE_PIPS 100000
///   MIN_DARK_GAP_S 21600  AUCTION_BLOCKS 10 (Base blocks are 0.2 s => ~2 s window)
///   PIPS_PER_GWEI 10000000 (0.001 gwei of priority => 1% fee; Base priority fees are tiny)
contract DeployBell is Script {
    function run() external returns (BellHook hook) {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        BellHook.Config memory cfg = BellHook.Config({
            liveFee: uint24(vm.envOr("LIVE_FEE_PIPS", uint256(500))),
            darkFee: uint24(vm.envOr("DARK_FEE_PIPS", uint256(300))),
            maxAuctionFee: uint24(vm.envOr("MAX_AUCTION_FEE_PIPS", uint256(100_000))),
            minDarkGap: uint32(vm.envOr("MIN_DARK_GAP_S", uint256(6 hours))),
            auctionBlocks: uint16(vm.envOr("AUCTION_BLOCKS", uint256(10))),
            pipsPerGwei: uint64(vm.envOr("PIPS_PER_GWEI", uint256(10_000_000)))
        });

        vm.startBroadcast();
        // Inside a broadcast the caller is the broadcasting account. (Before it, msg.sender is Foundry's
        // placeholder, which would make an unreachable owner when deploying with --account / --private-key.)
        (, address sender,) = vm.readCallers();
        address owner = vm.envOr("OWNER", sender);
        address keeper = vm.envOr("KEEPER", sender);
        address feedAddr = vm.envOr("FEED", address(0));
        IAggregatorV3 feed;
        if (feedAddr == address(0)) {
            feed = new MockEquityFeed(int256(vm.envOr("MOCK_PRICE_1E8", uint256(130e8))));
            console2.log("MockEquityFeed", address(feed));
        } else {
            feed = IAggregatorV3(feedAddr);
        }

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory args = abi.encode(manager, feed, owner, keeper, cfg);
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(BellHook).creationCode, args);
        hook = new BellHook{salt: salt}(manager, feed, owner, keeper, cfg);
        require(address(hook) == expected, "hook address mismatch");
        vm.stopBroadcast();

        console2.log("BellHook", address(hook));
        console2.log("owner", owner);
        console2.log("keeper", keeper);
    }
}
