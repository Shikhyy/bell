/**
 * bell keeper: before each scheduled bell, post the auction reserve to BellHook.
 *
 * The reserve is the forecast's latest out-of-sample 80% band for that kind of boundary
 * (research/data/ledger.csv). BellHook detects the bell itself onchain; the keeper only sets
 * the floor price of the auction, and can never make a swap revert.
 *
 * Dry run by default. Sends only with --send AND KEEPER_PRIVATE_KEY in the environment.
 *
 *   pnpm --dir keeper start                 # one pass, dry run
 *   pnpm --dir keeper watch                 # every 5 minutes, dry run
 *   KEEPER_PRIVATE_KEY=... pnpm --dir keeper start -- --send
 *
 * Env: RPC_URL, CHAIN (base | base-sepolia), HOOK, CURRENCY0, CURRENCY1, TICK_SPACING,
 *      LEAD_MINUTES (default 90), LEDGER_CSV
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import * as sessionModule from "../../terminal/src/lib/session";
import type { Boundary } from "../../terminal/src/lib/session";

// The terminal package is CommonJS to Node, so its exports may arrive on `default`.
type SessionApi = typeof sessionModule;
const session: SessionApi = (sessionModule as SessionApi & { default?: SessionApi }).default ?? sessionModule;
const { nextBoundaries } = session;

const here = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = process.env.LEDGER_CSV ?? path.join(here, "..", "..", "research", "data", "ledger.csv");
const SEND = process.argv.includes("--send");
const WATCH = process.argv.includes("--watch");
const LEAD_MIN = Number(process.env.LEAD_MINUTES ?? 90);
const LIVE_FEE_FLAG_DYNAMIC = 0x800000;

const HOOK_ABI = parseAbi([
  "function setReserveFee((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint24 fee)",
  "function pools(bytes32 id) view returns (uint64 lastSeenUpdatedAt, uint64 auctionEndBlock, uint24 reserveFee)",
  "function config() view returns (uint24 liveFee, uint24 darkFee, uint24 maxAuctionFee, uint32 minDarkGap, uint16 auctionBlocks, uint64 pipsPerGwei)",
  "function keeper() view returns (address)",
]);

function kindOf(b: Boundary): string | null {
  if (b.label === "Weekly reopen") return "sun_reopen";
  if (b.label === "Regular open") return "open_0930";
  if (b.label === "Pre-market") return "pre_0400";
  return null;
}

/** Latest out-of-sample 80% DEX band (bp) per boundary kind. */
function latestBands(): Record<string, number> {
  const txt = fs.readFileSync(LEDGER, "utf8").trim().split(/\r?\n/);
  const keys = txt[0].split(",");
  const iKind = keys.indexOf("kind"), iModel = keys.indexOf("model"), iBand = keys.indexOf("band80_bp");
  const out: Record<string, number> = {};
  for (const line of txt.slice(1)) {
    const v = line.split(",");
    if (v[iModel] === "dex") out[v[iKind]] = Number(v[iBand]);
  }
  return out;
}

function poolKey() {
  const { HOOK, CURRENCY0, CURRENCY1 } = process.env;
  if (!HOOK || !CURRENCY0 || !CURRENCY1) return null;
  const [c0, c1] = [getAddress(CURRENCY0), getAddress(CURRENCY1)].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  return {
    currency0: c0,
    currency1: c1,
    fee: LIVE_FEE_FLAG_DYNAMIC,
    tickSpacing: Number(process.env.TICK_SPACING ?? 60),
    hooks: getAddress(HOOK),
  };
}

function poolId(k: NonNullable<ReturnType<typeof poolKey>>) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );
}

async function pass() {
  const now = new Date();
  const bell = nextBoundaries(now, 10).find((b) => b.bell && kindOf(b));
  if (!bell) return console.log("no scheduled bell in the next days");
  const kind = kindOf(bell)!;
  const mins = (new Date(bell.at).getTime() - now.getTime()) / 60000;
  const bands = latestBands();
  const bandBp = bands[kind];
  if (bandBp == null) return console.log(`no forecast band for ${kind} yet`);
  const reservePips = Math.round(bandBp * 100); // 1 bp = 100 pips
  console.log(`${now.toISOString()}  next bell: ${bell.label} ${bell.when} ET (${mins.toFixed(0)} min) · ${kind} band ${bandBp.toFixed(1)} bp → reserve ${reservePips} pips`);

  if (mins > LEAD_MIN) return console.log(`  waiting: acts within ${LEAD_MIN} min of the bell`);
  const key = poolKey();
  if (!key) return console.log("  dry run: set HOOK, CURRENCY0, CURRENCY1 to target a pool");

  const chain = process.env.CHAIN === "base" ? base : baseSepolia;
  const transport = http(process.env.RPC_URL);
  const pub = createPublicClient({ chain, transport });
  const [, , maxAuctionFee] = await pub.readContract({ address: key.hooks, abi: HOOK_ABI, functionName: "config" });
  const [, , current] = await pub.readContract({ address: key.hooks, abi: HOOK_ABI, functionName: "pools", args: [poolId(key)] });
  const target = Math.min(reservePips, maxAuctionFee);
  if (Math.abs(current - target) < 100) return console.log(`  reserve already ${current} pips; nothing to do`);

  if (!SEND || !process.env.KEEPER_PRIVATE_KEY) {
    return console.log(`  dry run: would call setReserveFee(${target}) (current ${current}). Pass --send with KEEPER_PRIVATE_KEY set to send.`);
  }
  const account = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as `0x${string}`);
  const onchainKeeper = await pub.readContract({ address: key.hooks, abi: HOOK_ABI, functionName: "keeper" });
  if (onchainKeeper.toLowerCase() !== account.address.toLowerCase()) {
    return console.log(`  refusing: ${account.address} is not the hook's keeper (${onchainKeeper})`);
  }
  const wallet = createWalletClient({ account, chain, transport });
  const hash = await wallet.writeContract({ address: key.hooks as Address, abi: HOOK_ABI, functionName: "setReserveFee", args: [key, target] });
  console.log(`  sent setReserveFee(${target}): ${hash}`);
}

await pass();
if (WATCH) setInterval(() => pass().catch((e) => console.error("pass failed:", (e as Error).message)), 5 * 60_000);
