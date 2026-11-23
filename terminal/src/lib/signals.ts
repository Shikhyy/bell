/**
 * bell signals: decision data for people and agents trading or lending against tokenized stocks
 * on Base while the reference market (and its Chainlink feed) is closed.
 *
 * One core, three surfaces: the terminal's HTTP API (/api/v1/*), the `bell` CLI, and the bell MCP server.
 * Everything here is descriptive data and calibrated model estimates. Nothing executes trades.
 *
 * Model: at each scheduled bell, the pre-bell Aerodrome price forecasts the first post-bell oracle print
 * (out-of-sample CRPS −74% vs the frozen oracle on 629 boundaries). Uncertainty is Laplace in log space,
 * with scale b fitted per boundary type from past errors only (research/src/bell_research/forecast.py).
 */
import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { readFeeds, type FeedState } from "./chain";
import { DARK_AFTER_S, TOKENS, bySymbol, type Token } from "./config";
import { readMarkets, readMeta, type Market } from "./market";
import { allDark, darkStats, ledgerRows, ledgerSummary, type LedgerSummary } from "./research";
import { SESSION_LABEL, isDark, nextBoundaries, sessionAt } from "./session";

export const DISCLAIMER = "Descriptive market data and model estimates, not investment advice. bell does not execute trades.";
export class BellError extends Error {}

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org", { retryCount: 2, timeout: 15_000 }),
});

const BELL_KIND: Record<string, string> = {
  "Weekly reopen": "sun_reopen",
  "Regular open": "open_0930",
  "Pre-market": "pre_0400",
  "Overnight session": "overnight_2000",
};

/** Half-width (bp) of the central `coverage` interval of Laplace(0, b). */
const halfWidth = (b: number, coverage: number) => -b * Math.log(1 - coverage);
/** One-sided lower quantile (bp, negative) of Laplace(0, b) at confidence c (> 0.5). */
const lowerTail = (b: number, c: number) => b * Math.log(2 * (1 - c));
const laplaceCdf = (x: number, b: number) => (x < 0 ? 0.5 * Math.exp(x / b) : 1 - 0.5 * Math.exp(-x / b));
const r2 = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

function token(symbol: string): Token {
  const t = bySymbol(symbol);
  if (!t) throw new BellError(`Unknown symbol "${symbol}". Supported: ${TOKENS.map((x) => x.symbol).join(", ")}`);
  return t;
}

type Model = { scaleBp: Record<string, number>; summary: LedgerSummary | null };
async function model(): Promise<Model> {
  const [rows, summary] = await Promise.all([ledgerRows(), ledgerSummary()]);
  const scaleBp: Record<string, number> = {};
  for (const r of rows) if (r.model === "dex" && Number.isFinite(r.scaleBp)) scaleBp[r.kind] = r.scaleBp; // latest wins
  return { scaleBp, summary };
}

// ───────────────────────────── session ─────────────────────────────

export function session(now = new Date()) {
  const s = sessionAt(now);
  const upcoming = nextBoundaries(now, 8).map((b) => ({
    at: b.at,
    when: `${b.when} ET`,
    label: b.label,
    scheduledJump: b.bell,
    kind: BELL_KIND[b.label] ?? null,
    inSeconds: Math.round((Date.parse(b.at) - now.getTime()) / 1000),
  }));
  return {
    asOf: now.toISOString(),
    session: s,
    label: SESSION_LABEL[s],
    marketClosed: isDark(s),
    nextBell: upcoming.find((b) => b.scheduledJump) ?? null,
    upcoming,
  };
}

// ───────────────────────────── quote ─────────────────────────────

function buildQuote(t: Token, f: FeedState, mk: Market, name: string | undefined, m: Model, sess: ReturnType<typeof session>, jumpRmsPct: number | null) {
  const nowS = Date.now() / 1000;
  const ageSeconds = f.updatedAt != null ? Math.round(nowS - f.updatedAt) : null;
  const frozen = ageSeconds != null && ageSeconds > DARK_AFTER_S;
  const gapBp = f.price && mk.mark ? (mk.mark / f.price - 1) * 1e4 : null;
  const kind = sess.nextBell?.kind ?? "sun_reopen";
  const b = m.scaleBp[kind] ?? m.scaleBp.sun_reopen ?? null;
  const centre = mk.mark ?? f.price;
  const band = (cov: number) =>
    b != null && centre != null ? [r2(centre * Math.exp(-halfWidth(b, cov) / 1e4)), r2(centre * Math.exp(halfWidth(b, cov) / 1e4))] : null;
  const o = m.summary?.overall;
  return {
    symbol: t.symbol,
    name: name ?? t.ticker,
    asOf: new Date().toISOString(),
    session: sess.label,
    oracle: { price: f.price, updatedAt: f.updatedAt, ageSeconds, frozen, feed: t.feed, source: "Chainlink feed for Coinbase tokenized stock, Base" },
    dex: { price: mk.mark, liquidityUsd: mk.liquidity, volume24hUsd: mk.volume24h, pool: mk.pair, venue: mk.dex },
    fairValue: {
      estimate: r2(centre),
      band80: band(0.8),
      band95: band(0.95),
      method: "pre-bell DEX price; Laplace band fitted out of sample on past reopens",
    },
    nextOracleUpdate: sess.nextBell
      ? {
          at: sess.nextBell.at,
          label: sess.nextBell.label,
          inSeconds: sess.nextBell.inSeconds,
          expectedMoveBp: r2(gapBp, 1),
          band80Bp: b != null ? r2(halfWidth(b, 0.8), 1) : null,
          band95Bp: b != null ? r2(halfWidth(b, 0.95), 1) : null,
          // drift relative to this stock's typical weekly reopen jump (RMS of past jumps)
          driftSigma: gapBp != null && jumpRmsPct ? r2(gapBp / (jumpRmsPct * 100)) : null,
          typicalReopenJumpBp: jumpRmsPct ? r2(jumpRmsPct * 100, 1) : null,
        }
      : null,
    model: {
      boundaryKind: kind,
      laplaceScaleBp: r2(b, 2),
      scoredEvents: o?.n ?? null,
      crpsSkillVsFrozenOracle: o?.skill_dex_vs_no_change ?? null,
      realisedCoverage80: o?.dex?.coverage80 ?? null,
      dataThrough: m.summary?.last ?? null,
    },
    disclaimer: DISCLAIMER,
  };
}
export type Quote = ReturnType<typeof buildQuote>;

export async function quote(symbol: string): Promise<Quote> {
  const t = token(symbol);
  const [feeds, markets, meta, m, dark] = await Promise.all([readFeeds(), readMarkets(), readMeta(), model(), allDark()]);
  return buildQuote(t, feeds[TOKENS.indexOf(t)], markets[t.symbol], meta[t.symbol]?.name, m, session(), darkStats(dark[t.symbol] ?? []).sigma);
}

/** All 10 feed-backed stocks, largest |drift| in σ first. */
export async function quotes(): Promise<Quote[]> {
  const [feeds, markets, meta, m, dark] = await Promise.all([readFeeds(), readMarkets(), readMeta(), model(), allDark()]);
  const sess = session();
  return TOKENS.map((t, i) => buildQuote(t, feeds[i], markets[t.symbol], meta[t.symbol]?.name, m, sess, darkStats(dark[t.symbol] ?? []).sigma)).sort(
    (a, b) => Math.abs(b.nextOracleUpdate?.driftSigma ?? 0) - Math.abs(a.nextOracleUpdate?.driftSigma ?? 0),
  );
}

// ───────────────────────────── risk ─────────────────────────────

export async function risk(symbol: string, confidence = 0.95) {
  if (!(confidence > 0.5 && confidence < 1)) throw new BellError("confidence must be between 0.5 and 1, e.g. 0.95");
  const q = await quote(symbol);
  const b = q.model.laplaceScaleBp;
  if (b == null) throw new BellError("No calibrated model yet: run the research pipeline (forecast).");
  const expected = q.nextOracleUpdate?.expectedMoveBp ?? 0;
  const tail = lowerTail(b, confidence);
  const downside = expected + tail;
  const upside = expected - tail;
  return {
    symbol: q.symbol,
    asOf: q.asOf,
    horizon: q.nextOracleUpdate ? `next oracle update: ${q.nextOracleUpdate.label}, in ${q.nextOracleUpdate.inSeconds}s` : "next oracle update",
    confidence,
    oracle: q.oracle.price,
    oracleMoveBp: { expected: r2(expected, 1), downside: r2(downside, 1), upside: r2(upside, 1) },
    oraclePriceRange: q.oracle.price ? [r2(q.oracle.price * Math.exp(downside / 1e4)), r2(q.oracle.price * Math.exp(upside / 1e4))] : null,
    collateralHaircutPct: r2(Math.max(0, -downside) / 100, 3),
    shortSideBufferPct: r2(Math.max(0, upside) / 100, 3),
    interpretation:
      "With the stated confidence the oracle's next print stays inside oraclePriceRange. collateralHaircutPct is the extra haircut that keeps collateral valued at the frozen oracle covered through that print.",
    disclaimer: DISCLAIMER,
  };
}

// ───────────────────────────── pre-trade ─────────────────────────────

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);
const ERC20 = parseAbi(["function decimals() view returns (uint8)"]);
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** Price impact of a trade on the pool's current active liquidity (single-range: a lower bound). */
async function impact(pool: string, side: "buy" | "sell", sizeUsd: number, priceUsd: number) {
  const addr = getAddress(pool.toLowerCase());
  const [slot0, liq, t0, t1, fee] = await Promise.all([
    client.readContract({ address: addr, abi: POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: addr, abi: POOL_ABI, functionName: "liquidity" }),
    client.readContract({ address: addr, abi: POOL_ABI, functionName: "token0" }),
    client.readContract({ address: addr, abi: POOL_ABI, functionName: "token1" }),
    client.readContract({ address: addr, abi: POOL_ABI, functionName: "fee" }),
  ]);
  const usdcIs0 = t0.toLowerCase() === USDC;
  if (!usdcIs0 && t1.toLowerCase() !== USDC) throw new BellError("deepest pool is not quoted in USDC");
  const stock = usdcIs0 ? t1 : t0;
  const dec = await client.readContract({ address: stock, abi: ERC20, functionName: "decimals" });
  const sqrtP = Number(slot0[0]) / 2 ** 96; // sqrt(token1 raw / token0 raw)
  const L = Number(liq);
  if (!(L > 0) || !(sqrtP > 0)) throw new BellError("pool has no active liquidity");
  const usdcRaw = sizeUsd * 1e6;
  const stockRaw = (sizeUsd / priceUsd) * 10 ** dec;
  let ratio: number; // stock price after / before
  if (side === "buy") ratio = usdcIs0 ? (1 + (usdcRaw * sqrtP) / L) ** 2 : (1 + usdcRaw / (L * sqrtP)) ** 2;
  else ratio = usdcIs0 ? 1 / (1 + stockRaw / (L * sqrtP)) ** 2 : 1 / (1 + (stockRaw * sqrtP) / L) ** 2;
  return { endImpactBp: Math.abs(ratio - 1) * 1e4, feeBp: fee / 100, pool: addr };
}

export async function pretrade(symbol: string, side: "buy" | "sell", sizeUsd: number) {
  if (side !== "buy" && side !== "sell") throw new BellError('side must be "buy" or "sell"');
  if (!(sizeUsd > 0)) throw new BellError("size must be a positive USD amount");
  const q = await quote(symbol);
  if (!q.dex.pool || q.dex.price == null) throw new BellError("no live USDC pool found for this token");
  const im = await impact(q.dex.pool, side, sizeUsd, q.dex.price);
  const next = q.nextOracleUpdate;
  const notes: string[] = [];
  if (q.oracle.frozen) notes.push(`The oracle is frozen (${Math.round((q.oracle.ageSeconds ?? 0) / 3600)}h old); the DEX price is the live price.`);
  if (next) {
    notes.push(`Next scheduled oracle update: ${next.label} in ${Math.round(next.inSeconds / 60)} min; expected move ${next.expectedMoveBp ?? "—"} bp (80% ±${next.band80Bp} bp).`);
    if (next.inSeconds < 15 * 60) notes.push("A scheduled bell is less than 15 minutes away; pools with BellHook charge auction fees for a few blocks after it.");
    if (next.driftSigma != null && Math.abs(next.driftSigma) > 2) notes.push(`DEX drift vs the frozen oracle is ${next.driftSigma}× this stock's typical reopen jump: unusually large.`);
  }
  if (im.endImpactBp > 50) notes.push("Size moves this pool by more than 50 bp; impact across ticks may be higher than this single-range estimate.");
  return {
    symbol: q.symbol,
    asOf: q.asOf,
    side,
    sizeUsd,
    dexPrice: q.dex.price,
    pool: im.pool,
    poolFeeBp: r2(im.feeBp, 2),
    priceImpactBp: { end: r2(im.endImpactBp, 2), average: r2(im.endImpactBp / 2, 2), note: "active-range estimate; a lower bound if the trade crosses ticks" },
    estimatedAllInCostBp: r2(im.feeBp + im.endImpactBp / 2, 2),
    oracle: q.oracle,
    nextOracleUpdate: next,
    notes,
    disclaimer: DISCLAIMER,
  };
}

// ───────────────────────────── liquidations ─────────────────────────────

export type Position = { id?: string; symbol: string; collateralTokens: number; debtUsd: number; liquidationThreshold: number };

/** For lending positions valued by the Chainlink feed: health now, and the probability the next scheduled
 *  oracle print liquidates them. */
export async function liquidations(positions: Position[]) {
  if (!Array.isArray(positions) || positions.length === 0) throw new BellError("pass a non-empty positions array");
  if (positions.length > 500) throw new BellError("at most 500 positions per call");
  const all = await quotes();
  const by = new Map(all.map((q) => [q.symbol.toLowerCase(), q]));
  const rows = positions.map((p, i) => {
    const q = by.get(String(p.symbol).toLowerCase());
    if (!q) return { id: p.id ?? String(i), symbol: p.symbol, error: "unsupported symbol" };
    const price = q.oracle.price, b = q.model.laplaceScaleBp, gap = q.nextOracleUpdate?.expectedMoveBp ?? 0;
    if (!price || b == null || !(p.collateralTokens > 0) || !(p.debtUsd > 0) || !(p.liquidationThreshold > 0 && p.liquidationThreshold <= 1)) {
      return { id: p.id ?? String(i), symbol: q.symbol, error: "invalid position or missing data" };
    }
    const hfNow = (p.collateralTokens * price * p.liquidationThreshold) / p.debtUsd;
    const liqPrice = p.debtUsd / (p.collateralTokens * p.liquidationThreshold);
    const rStar = Math.log(liqPrice / price) * 1e4; // bp move of the oracle that hits liquidation
    const prob = laplaceCdf(rStar - gap, b);
    return {
      id: p.id ?? String(i),
      symbol: q.symbol,
      healthFactorNow: r2(hfNow, 4),
      healthFactorAtExpectedPrint: r2(hfNow * Math.exp(gap / 1e4), 4),
      liquidationPrice: r2(liqPrice),
      oraclePrice: price,
      probLiquidatedAtNextPrint: r2(prob, 4),
      nextPrint: q.nextOracleUpdate?.label ?? null,
    };
  });
  rows.sort((a, b) => ("probLiquidatedAtNextPrint" in b ? (b.probLiquidatedAtNextPrint ?? 0) : -1) - ("probLiquidatedAtNextPrint" in a ? (a.probLiquidatedAtNextPrint ?? 0) : -1));
  return { asOf: new Date().toISOString(), positions: rows, disclaimer: DISCLAIMER };
}

// ───────────────────────────── history & calibration ─────────────────────────────

export async function history(symbol: string, n = 12) {
  const t = token(symbol);
  const dark = (await allDark())[t.symbol] ?? [];
  const weekly = dark.filter((w) => w.weeklyReopen);
  const st = darkStats(dark);
  return {
    symbol: t.symbol,
    weeklyReopens: st.n,
    insideBellMinute: st.exact, // first print within the 20:00 ET minute
    medianAbsJumpPct: r2(st.medianAbsJump, 3),
    rmsJumpPct: r2(st.sigma, 3),
    recent: weekly.slice(-Math.max(1, Math.min(52, n))).reverse().map((w) => ({
      wokeAt: new Date(w.to * 1000).toISOString(),
      darkHours: r2(w.gapH, 1),
      before: w.pre,
      after: w.post,
      jumpPct: r2(w.jumpPct, 3),
    })),
  };
}

export async function calibration() {
  const s = await ledgerSummary();
  if (!s) throw new BellError("No backtest yet: run the research pipeline (forecast).");
  const pick = (k: string) => {
    const v = s.by_kind[k];
    return v ? { events: v.n, crpsSkill: v.skill_dex_vs_no_change ?? null, dexMaeBp: v.dex?.mae_bp ?? null, frozenOracleMaeBp: v.no_change?.mae_bp ?? null, coverage80: v.dex?.coverage80 ?? null } : null;
  };
  return {
    method: s.method,
    window: [s.first, s.last],
    overall: { events: s.overall.n, crpsSkill: s.overall.skill_dex_vs_no_change ?? null, dexMaeBp: s.overall.dex?.mae_bp ?? null, frozenOracleMaeBp: s.overall.no_change?.mae_bp ?? null, coverage80: s.overall.dex?.coverage80 ?? null },
    byBoundary: { sun_reopen: pick("sun_reopen"), open_0930: pick("open_0930"), pre_0400: pick("pre_0400"), overnight_2000: pick("overnight_2000") },
  };
}

/** Machine-readable index of the tools, shared by the API, CLI and MCP server. */
export const TOOLS = [
  { name: "session", args: "", about: "US market session and the next scheduled oracle bells, to the second (New York time)." },
  { name: "quotes", args: "", about: "All 10 feed-backed stocks: frozen oracle vs live DEX price, expected oracle move at the next bell, drift in σ." },
  { name: "quote", args: "symbol", about: "One stock: fair value with 80/95% bands, expected oracle move and timing, model track record." },
  { name: "risk", args: "symbol, confidence=0.95", about: "Oracle move range at the next print and the collateral haircut that covers it." },
  { name: "pretrade", args: "symbol, side=buy|sell, size (USD)", about: "Pool fee and price impact from live pool state, plus how far the oracle may move around the trade." },
  { name: "liquidations", args: "positions[] {symbol, collateralTokens, debtUsd, liquidationThreshold}", about: "Health now and probability each position is liquidated by the next scheduled oracle print." },
  { name: "history", args: "symbol, n=12", about: "Past weekly reopens: timing and jump sizes." },
  { name: "calibration", args: "", about: "Out-of-sample scores of the forecast, overall and per boundary type." },
] as const;
