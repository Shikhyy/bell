import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { TOKENS } from "./config";

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org", { retryCount: 3, timeout: 15_000 }),
});

const AGGREGATOR = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export type FeedState = { symbol: string; price: number | null; updatedAt: number | null };

/** Latest value of each Coinbase/Chainlink feed, in one multicall. */
export async function readFeeds(): Promise<FeedState[]> {
  try {
    const res = await client.multicall({
      allowFailure: true,
      contracts: TOKENS.map((t) => ({
        address: getAddress(t.feed.toLowerCase()),
        abi: AGGREGATOR,
        functionName: "latestRoundData" as const,
      })),
    });
    return TOKENS.map((t, i) => {
      const r = res[i];
      if (r.status !== "success") return { symbol: t.symbol, price: null, updatedAt: null };
      const [, answer, , updatedAt] = r.result;
      return { symbol: t.symbol, price: Number(answer) / 1e8, updatedAt: Number(updatedAt) };
    });
  } catch {
    return TOKENS.map((t) => ({ symbol: t.symbol, price: null, updatedAt: null }));
  }
}
