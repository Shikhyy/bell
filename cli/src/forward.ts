/**
 * Pre-registered forward test.
 *
 *   pnpm --dir cli tsx src/forward.ts predict [--dry] [--allow-early]
 *
 * Writes forward/predictions/<bell>.json with the forecasts bell itself serves (the same numbers as
 * `bell quotes`) BEFORE the weekly reopen. Scoring happens afterwards in research/src/bell_research/forward.py,
 * against the first Chainlink print at or after the bell. Nothing here can see the outcome:
 * it refuses to run once any feed has already printed after the bell.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

type Signals = typeof import("../../terminal/src/lib/signals");
const ROOT = path.resolve(__dirname, "..", "..");
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: any; error?: unknown };
  if (j.error || j.result == null) throw new Error(`rpc ${method} failed`);
  return j.result;
}

async function predict(flags: string[]) {
  process.env.RESEARCH_DATA_DIR ??= path.join(ROOT, "research", "data");
  const S = (await import("../../terminal/src/lib/signals")) as Signals & { default?: Signals };
  const sig = S.default ?? S;

  const sess = sig.session();
  const bell = sess.nextBell;
  const rehearsal = flags.includes("--allow-early");
  if (!bell) throw new Error("no upcoming scheduled bell");
  if (bell.label !== "Weekly reopen" && !rehearsal) throw new Error(`next scheduled bell is not the weekly reopen (${bell?.label})`);
  if (bell.inSeconds <= 0) throw new Error("the bell has already rung");
  if (bell.inSeconds > 4 * 3600 && !rehearsal) throw new Error(`bell is ${Math.round(bell.inSeconds / 60)} min away; run within 4 h of it (or pass --allow-early for a rehearsal)`);

  const qs = await sig.quotes();
  const bellTs = Math.floor(Date.parse(bell.at) / 1000);
  const woke = qs.filter((q) => (q.oracle.updatedAt ?? 0) >= bellTs);
  if (woke.length) throw new Error(`refusing: ${woke.map((q) => q.symbol).join(", ")} already printed after the bell`);
  const missing = qs.filter((q) => q.dex.price == null || q.oracle.price == null || q.model.laplaceScaleBp == null);
  const ok = qs.filter((q) => !missing.includes(q));
  if (ok.length < 6) throw new Error(`only ${ok.length} stocks have complete inputs`);

  const blk = await rpc("eth_getBlockByNumber", ["latest", false]);
  const summaryPath = path.join(ROOT, "research", "data", "ledger_summary.json");
  const forecasts = ok.map((q) => ({
    symbol: q.symbol,
    frozenOracle: { price: q.oracle.price, updatedAt: q.oracle.updatedAt },
    dexPrice: q.dex.price,
    dexLiquidityUsd: q.dex.liquidityUsd,
    scaleBp: q.model.laplaceScaleBp,
    band80: q.fairValue.band80,
    band95: q.fairValue.band95,
    expectedMoveBp: q.nextOracleUpdate?.expectedMoveBp ?? null,
  }));
  const body = {
    version: 1,
    bell: { at: bell.at, unix: bellTs, label: bell.label, kind: bell.kind },
    madeAt: new Date().toISOString(),
    secondsBeforeBell: bell.inSeconds,
    baseBlock: { number: parseInt(blk.number, 16), hash: blk.hash, timestamp: parseInt(blk.timestamp, 16) },
    model: { ledgerSummarySha256: crypto.createHash("sha256").update(fs.readFileSync(summaryPath)).digest("hex"), commit: safeGit() },
    skippedForMissingInputs: missing.map((q) => q.symbol),
    forecasts,
  };
  const sha = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const out = { ...body, contentSha256: sha };
  const name = bell.at.replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");
  const file = path.join(ROOT, "forward", "predictions", `${name}.json`);
  if (flags.includes("--dry")) {
    console.log(JSON.stringify(out, null, 1).slice(0, 1800), "\n… (dry run, nothing written)");
    return;
  }
  if (fs.existsSync(file)) throw new Error(`${path.relative(ROOT, file)} already exists; predictions are write-once`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, file)}  ${forecasts.length} forecasts, ${Math.round(bell.inSeconds / 60)} min before the bell, sha256 ${sha.slice(0, 16)}…`);
}

function safeGit() {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return process.env.GITHUB_SHA ?? null; }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "predict") predict(rest).catch((e) => { console.error(`forward: ${e.message}`); process.exit(1); });
else { console.error("usage: forward.ts predict [--dry] [--allow-early]"); process.exit(2); }
