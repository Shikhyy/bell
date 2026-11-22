import { TOKENS } from "./config";

export type Market = {
  mark: number | null;
  liquidity: number | null;
  volume24h: number | null;
  change24h: number | null;
  pair: string | null;
  dex: string | null;
  url: string | null;
};

type DexPair = {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
};

const EMPTY: Market = { mark: null, liquidity: null, volume24h: null, change24h: null, pair: null, dex: null, url: null };

/** Deepest Base USDC pool per token, from DexScreener (refreshed every 30s). */
export async function readMarkets(): Promise<Record<string, Market>> {
  const out: Record<string, Market> = Object.fromEntries(TOKENS.map((t) => [t.symbol, EMPTY]));
  // One request per token: a combined request is capped at 30 pairs, which drops some tokens.
  await Promise.all(TOKENS.map(async (t) => {
    try {
      const addr = t.token.toLowerCase();
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, { next: { revalidate: 30 } });
      const j = (await r.json()) as { pairs?: DexPair[] };
      const best = (j.pairs ?? [])
        .filter((p) => p.chainId === "base" && p.baseToken.address.toLowerCase() === addr && p.quoteToken.symbol === "USDC")
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (best) {
        out[t.symbol] = {
          mark: best.priceUsd ? Number(best.priceUsd) : null,
          liquidity: best.liquidity?.usd ?? null,
          volume24h: best.volume?.h24 ?? null,
          change24h: best.priceChange?.h24 ?? null,
          pair: best.pairAddress,
          dex: best.dexId,
          url: best.url ?? null,
        };
      }
    } catch {
      /* keep EMPTY values; the UI shows dashes */
    }
  }));
  return out;
}

export type TokenMeta = { name: string; multiplier: number | null; supply: number | null };

/** Names, multipliers and supply from the public Coinbase Tokenized Stocks API (hourly). */
export async function readMeta(): Promise<Record<string, TokenMeta>> {
  const out: Record<string, TokenMeta> = {};
  try {
    const r = await fetch("https://api.coinbase.com/v1/tokenized-stocks?page_size=500", { next: { revalidate: 3600 } });
    const j = (await r.json()) as Record<string, unknown>;
    const list = Object.values(j).find(Array.isArray) as
      | { symbol: string; name?: string; multiplier?: number | string; total_supply?: number | string }[]
      | undefined;
    for (const x of list ?? []) {
      out[x.symbol] = {
        name: x.name ?? x.symbol,
        multiplier: x.multiplier != null ? Number(x.multiplier) : null,
        supply: x.total_supply != null ? Number(x.total_supply) : null,
      };
    }
  } catch {
    /* names fall back to tickers */
  }
  return out;
}
