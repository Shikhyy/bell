import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { TOKENS } from "./config";
import { etParts, weekHour } from "./session";

/** Reads the research pipeline's outputs (../research/data). Nothing here is mocked: if a
 *  file is missing the page shows that the data is not available yet. */
// Deployed builds ship a copy in ./data (see scripts/sync-data.mjs); locally the pipeline's own output is used.
const DIR = process.env.RESEARCH_DATA_DIR ?? (existsSync(path.join(process.cwd(), "data", "ledger_summary.json"))
  ? path.join(process.cwd(), "data")
  : path.join(process.cwd(), "..", "research", "data"));
const MIN_GAP_H = 6;

async function readCsv(rel: string): Promise<Record<string, string>[]> {
  try {
    const txt = await fs.readFile(path.join(DIR, rel), "utf8");
    const [head, ...rows] = txt.trim().split(/\r?\n/); // Python's csv module writes CRLF
    const keys = head.split(",");
    return rows.map((r) => {
      const v = r.split(",");
      return Object.fromEntries(keys.map((k, i) => [k, v[i] ?? ""]));
    });
  } catch (e) {
    console.error(`[research] could not read ${path.join(DIR, rel)}: ${(e as Error).message}`);
    return [];
  }
}

export type Update = { t: number; price: number };

export async function feedUpdates(ticker: string): Promise<Update[]> {
  const rows = await readCsv(`feeds/${ticker}.csv`);
  return rows
    .map((r) => ({ t: Number(r.updated_at), price: Number(r.answer) / 1e8 }))
    .filter((u) => Number.isFinite(u.t) && u.t > 0)
    .sort((a, b) => a.t - b.t);
}

export type DarkWindow = {
  ticker: string;
  from: number;
  to: number;
  gapH: number;
  pre: number;
  post: number;
  jumpPct: number;
  weeklyReopen: boolean;
  exactBell: boolean;
  wakeLabel: string;
};

/** Long silences in a feed, and the price jump across each one. */
export function darkWindows(ticker: string, ups: Update[]): DarkWindow[] {
  const out: DarkWindow[] = [];
  for (let i = 1; i < ups.length; i++) {
    const gapH = (ups[i].t - ups[i - 1].t) / 3600;
    if (gapH < MIN_GAP_H) continue;
    const p = etParts(new Date(ups[i].t * 1000));
    const weeklyReopen = p.dow === 0 && p.mins >= 1200 && p.mins < 1230;
    out.push({
      ticker,
      from: ups[i - 1].t,
      to: ups[i].t,
      gapH,
      pre: ups[i - 1].price,
      post: ups[i].price,
      jumpPct: (ups[i].price / ups[i - 1].price - 1) * 100,
      weeklyReopen,
      exactBell: weeklyReopen && p.mins === 1200,
      wakeLabel: `${p.weekday} ${p.monthDay} ${p.hhmm}`,
    });
  }
  return out;
}

export type DarkStats = { n: number; exact: number; medianAbsJump: number | null; sigma: number | null };

export function darkStats(ws: DarkWindow[]): DarkStats {
  const sun = ws.filter((w) => w.weeklyReopen);
  if (!sun.length) return { n: 0, exact: 0, medianAbsJump: null, sigma: null };
  const abs = sun.map((w) => Math.abs(w.jumpPct)).sort((a, b) => a - b);
  const median = abs[Math.floor(abs.length / 2)];
  const sigma = Math.sqrt(sun.reduce((s, w) => s + w.jumpPct ** 2, 0) / sun.length);
  return { n: sun.length, exact: sun.filter((w) => w.exactBell).length, medianAbsJump: median, sigma };
}

export async function allDark(): Promise<Record<string, DarkWindow[]>> {
  const entries = await Promise.all(TOKENS.map(async (t) => [t.symbol, darkWindows(t.ticker, await feedUpdates(t.ticker))] as const));
  return Object.fromEntries(entries);
}

/** Oracle updates per hour of the week (Monday 00:00 ET = 0), across all 10 feeds. */
export async function weekActivity(): Promise<number[]> {
  const buckets = new Array<number>(168).fill(0);
  for (const t of TOKENS) {
    for (const u of await feedUpdates(t.ticker)) buckets[Math.floor(weekHour(new Date(u.t * 1000))) % 168]++;
  }
  return buckets;
}

export type ModelScore = {
  crps_bp: number;
  mae_bp: number;
  coverage80: number;
  pit_hist: number[];
  reliability: { nominal: number; realised: number }[];
};
export type Scores = { n: number; no_change?: ModelScore; dex?: ModelScore; skill_dex_vs_no_change?: number };
export type LedgerSummary = { method: string; warmup_events: number; first: string; last: string; overall: Scores; by_kind: Record<string, Scores> };
export type LedgerRow = {
  ticker: string; wakeNy: string; kind: string; model: string; center: number; feedPost: number;
  scaleBp: number; band80Bp: number; errBp: number; pit: number; crpsBp: number; in80: boolean;
};

export async function ledgerSummary(): Promise<LedgerSummary | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, "ledger_summary.json"), "utf8")) as LedgerSummary;
  } catch {
    return null;
  }
}

export async function ledgerRows(): Promise<LedgerRow[]> {
  return (await readCsv("ledger.csv")).map((r) => ({
    ticker: r.ticker, wakeNy: r.wake_ny, kind: r.kind, model: r.model, center: Number(r.center), feedPost: Number(r.feed_post),
    scaleBp: Number(r.scale_bp), band80Bp: Number(r.band80_bp), errBp: Number(r.err_bp), pit: Number(r.pit),
    crpsBp: Number(r.crps_bp), in80: r.in80 === "true",
  }));
}

export type Jump = {
  ticker: string;
  wakeTs: number;
  jumpPct: number;
  weekendShare: number | null;
  gap2sBp: number | null;
  lvrUsd: number | null;
  poolPre: number | null;
  feedPost: number;
};

export async function jumps(): Promise<Jump[]> {
  const num = (s: string) => (s === "" || s === "nan" ? null : Number(s));
  return (await readCsv("jumps.csv")).map((r) => ({
    ticker: r.ticker,
    wakeTs: Number(r.wake_ts),
    jumpPct: Number(r.jump_pct),
    weekendShare: num(r.weekend_share),
    gap2sBp: num(r.gap_left_2s_bp),
    lvrUsd: num(r.lvr_usd),
    poolPre: num(r.pool_pre),
    feedPost: Number(r.feed_post),
  }));
}

/** Same classification as research/src/bell_research/forecast.py::kind_of. */
export function kindOf(ts: number): string {
  const p = etParts(new Date(ts * 1000));
  if (p.dow === 0 && p.hhmm >= "20:00" && p.hhmm <= "20:29") return "sun_reopen";
  if (p.hhmm >= "09:30" && p.hhmm <= "09:59") return "open_0930";
  if (p.hhmm >= "04:00" && p.hhmm <= "04:29") return "pre_0400";
  if (p.hhmm >= "20:00" && p.hhmm <= "20:29") return "overnight_2000";
  return "other";
}
