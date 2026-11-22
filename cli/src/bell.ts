/**
 * bell CLI + MCP server.
 *
 *   pnpm --dir cli bell quotes
 *   pnpm --dir cli bell quote NVDAc --json
 *   pnpm --dir cli bell pretrade NVDAc --side buy --size 25000
 *   pnpm --dir cli bell liquidations positions.json
 *   pnpm --dir cli mcp            # MCP server over stdio (for Claude, agent frameworks, …)
 *
 * Read-only: bell returns data and calibrated estimates. It never signs or sends a transaction.
 */
import fs from "node:fs";
import path from "node:path";

type Signals = typeof import("../../terminal/src/lib/signals");

const HELP = `bell — the oracle for when the oracle is closed (tokenized stocks on Base)

Usage: bell <command> [args] [--json]

  session                                   market session and the next scheduled bells
  quotes                                    all 10 stocks: frozen oracle vs DEX, expected move at the next bell
  quote <SYMBOL>                            fair value with 80/95% bands, expected oracle move, model record
  risk <SYMBOL> [--confidence 0.95]         oracle move range at the next print, collateral haircut
  pretrade <SYMBOL> --side buy|sell --size <USD>
                                            pool fee and price impact from live pool state, oracle context
  liquidations <positions.json>             P(liquidated at the next print) for each lending position
  history <SYMBOL> [--n 12]                 past weekly reopens: timing and jump sizes
  calibration                               out-of-sample scores of the forecast
  tools                                     machine-readable list of tools
  mcp                                       run as an MCP server over stdio

Symbols: NVDAc TSLAc AAPLc MSFTc METAc GOOGLc AMZNc MSTRc SNDKc SPCXc
Data: Base mainnet (BASE_RPC_URL or the public RPC), DexScreener, bell research data.
Not investment advice. bell never trades.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function load(): Promise<Signals> {
  process.env.RESEARCH_DATA_DIR ??= path.resolve(__dirname, "..", "..", "research", "data");
  const mod = (await import("../../terminal/src/lib/signals")) as Signals & { default?: Signals };
  return (typeof mod.quote === "function" ? mod : mod.default) as Signals;
}

const fx = (n: number | null | undefined, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const bp = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(0)}bp`);
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}m`);
const pad = (s: string, n: number, right = false) => (right ? s.padStart(n) : s.padEnd(n));

async function cli(argv: string[]) {
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");
  const [cmd, a1] = args;
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(HELP);
  if (cmd === "mcp") return mcp();
  const S = await load();
  const out = (data: unknown, human?: () => void) => (json || !human ? console.log(JSON.stringify(data, null, 2)) : human());

  switch (cmd) {
    case "tools": return out({ tools: S.TOOLS });
    case "session": {
      const s = S.session();
      return out(s, () => {
        console.log(`${s.label}`);
        for (const b of s.upcoming.slice(0, 5)) console.log(`  ${pad(b.when, 22)} ${pad(b.label, 20)} in ${pad(dur(b.inSeconds), 7, true)}${b.scheduledJump ? "  ● scheduled jump" : ""}`);
      });
    }
    case "quotes": {
      const qs = await S.quotes();
      return out(qs, () => {
        const n = qs[0]?.nextOracleUpdate;
        console.log(`${qs[0]?.session ?? ""}${n ? ` · next bell: ${n.label} in ${dur(n.inSeconds)}` : ""}\n`);
        console.log(`${pad("SYMBOL", 8)}${pad("ORACLE", 11, true)}${pad("AGE", 8, true)}${pad("DEX", 11, true)}${pad("EXP MOVE", 10, true)}${pad("±80%", 8, true)}${pad("DRIFT", 8, true)}`);
        for (const q of qs) {
          const u = q.nextOracleUpdate;
          console.log(`${pad(q.symbol, 8)}${pad(fx(q.oracle.price), 11, true)}${pad(q.oracle.ageSeconds != null ? dur(q.oracle.ageSeconds) : "—", 8, true)}${pad(fx(q.dex.price), 11, true)}${pad(bp(u?.expectedMoveBp), 10, true)}${pad(u?.band80Bp != null ? `${u.band80Bp.toFixed(0)}bp` : "—", 8, true)}${pad(u?.driftSigma != null ? `${u.driftSigma.toFixed(1)}×` : "—", 8, true)}`);
        }
        console.log(`\nEXP MOVE: expected oracle move at the next bell. DRIFT: in units of the stock's typical reopen jump.\n${S.DISCLAIMER}`);
      });
    }
    case "quote": {
      const q = await S.quote(a1 ?? "");
      return out(q, () => {
        const u = q.nextOracleUpdate;
        console.log(`${q.symbol} · ${q.name} · ${q.session}`);
        console.log(`  oracle      ${fx(q.oracle.price)}  ${q.oracle.frozen ? "FROZEN" : "live"} (${q.oracle.ageSeconds != null ? dur(q.oracle.ageSeconds) : "—"} old)`);
        console.log(`  dex         ${fx(q.dex.price)}  liquidity $${fx(q.dex.liquidityUsd, 0)}  24h vol $${fx(q.dex.volume24hUsd, 0)}`);
        console.log(`  fair value  ${fx(q.fairValue.estimate)}  80% [${q.fairValue.band80?.map((x) => fx(x)).join(", ")}]  95% [${q.fairValue.band95?.map((x) => fx(x)).join(", ")}]`);
        if (u) console.log(`  next bell   ${u.label} in ${dur(u.inSeconds)} · oracle expected ${bp(u.expectedMoveBp)} ±${u.band80Bp}bp (80%) · drift ${u.driftSigma}× typical`);
        console.log(`  model       ${q.model.scoredEvents} scored reopens · CRPS skill ${((q.model.crpsSkillVsFrozenOracle ?? 0) * 100).toFixed(0)}% vs frozen oracle\n  ${q.disclaimer}`);
      });
    }
    case "risk": return out(await S.risk(a1 ?? "", Number(opt(args, "confidence") ?? 0.95)));
    case "pretrade": return out(await S.pretrade(a1 ?? "", (opt(args, "side") ?? "buy") as "buy" | "sell", Number(opt(args, "size") ?? 10000)));
    case "liquidations": {
      if (!a1) throw new Error("usage: bell liquidations <positions.json>");
      const raw = JSON.parse(fs.readFileSync(path.resolve(a1), "utf8"));
      return out(await S.liquidations(Array.isArray(raw) ? raw : raw.positions));
    }
    case "history": return out(await S.history(a1 ?? "", Number(opt(args, "n") ?? 12)));
    case "calibration": return out(await S.calibration());
    default: console.log(HELP); process.exitCode = 1;
  }
}

/** MCP server over stdio. Nothing may be written to stdout except protocol messages. */
async function mcp() {
  const S = await load();
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");
  const server = new McpServer({ name: "bell", version: "0.1.0" });
  const reply = (fn: () => Promise<unknown> | unknown) => async () => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await fn(), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
    }
  };
  const symbol = z.string().describe("Tokenized stock symbol on Base, e.g. NVDAc, TSLAc, AAPLc, MSTRc");

  server.tool("bell_session", "US market session and the next scheduled oracle bells for tokenized stocks on Base, to the second (New York time).", {}, reply(() => S.session()));
  server.tool("bell_quotes", "All 10 Chainlink-backed Coinbase tokenized stocks on Base: frozen oracle vs live DEX price, expected oracle move at the next bell with 80% band, drift vs typical reopen jump. Sorted by drift.", {}, reply(() => S.quotes()));
  server.tool("bell_quote", "Fair value of one tokenized stock while its oracle is frozen: estimate with 80/95% bands, expected oracle move and timing at the next bell, and the model's out-of-sample track record.", { symbol }, async (a) => reply(() => S.quote(a.symbol))());
  server.tool("bell_risk", "Range the oracle's next print will fall in at a given confidence, and the collateral haircut that keeps oracle-valued collateral covered through it.", { symbol, confidence: z.number().min(0.5).max(0.999).default(0.95) }, async (a) => reply(() => S.risk(a.symbol, a.confidence))());
  server.tool("bell_pretrade", "Pre-trade check for a tokenized-stock swap on Base: pool fee, price impact from live pool state, and how far the oracle may move at the next bell. Read-only; does not trade.", { symbol, side: z.enum(["buy", "sell"]), sizeUsd: z.number().positive().describe("trade size in USD") }, async (a) => reply(() => S.pretrade(a.symbol, a.side, a.sizeUsd))());
  server.tool(
    "bell_liquidations",
    "For lending positions valued by the Chainlink feed: health now and probability each is liquidated by the next scheduled oracle print.",
    { positions: z.array(z.object({ id: z.string().optional(), symbol, collateralTokens: z.number().positive(), debtUsd: z.number().positive(), liquidationThreshold: z.number().gt(0).max(1) })).min(1).max(500) },
    async (a) => reply(() => S.liquidations(a.positions))(),
  );
  server.tool("bell_history", "Past weekly reopens of one tokenized stock: when the oracle woke and how far it jumped.", { symbol, n: z.number().int().min(1).max(52).default(12) }, async (a) => reply(() => S.history(a.symbol, a.n))());
  server.tool("bell_calibration", "Out-of-sample scores of bell's reopen forecast, overall and by boundary type.", {}, reply(() => S.calibration()));

  await server.connect(new StdioServerTransport());
}

cli(process.argv.slice(2)).catch((e) => {
  console.error(`bell: ${(e as Error).message}`);
  process.exitCode = 1;
});
