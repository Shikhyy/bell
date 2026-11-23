import Link from "next/link";
import { Reveal, Scramble } from "@/components/Motion";
import { allDark, darkStats, jumps, kindOf, ledgerSummary } from "@/lib/research";

export const revalidate = 300;
export const metadata = { title: "Research — bell" };

const BELL_KINDS = new Set(["sun_reopen", "open_0930", "pre_0400"]);
const pct = (x: number | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);

export default async function Research() {
  const [summary, js, dark] = await Promise.all([ledgerSummary(), jumps(), allDark()]);
  const stats = Object.values(dark).map(darkStats);
  const reopens = stats.reduce((s, x) => s + x.n, 0);
  const onTime = stats.reduce((s, x) => s + x.exact, 0);
  const bells = js.filter((j) => j.lvrUsd != null && BELL_KINDS.has(kindOf(j.wakeTs)));
  const lvr = bells.map((b) => b.lvrUsd!).sort((a, b) => a - b);
  const lvrTotal = lvr.reduce((a, b) => a + b, 0);
  const lvrMed = lvr.length ? lvr[Math.floor(lvr.length / 2)] : 0;
  const top10share = lvr.length ? lvr.slice(-Math.ceil(lvr.length / 10)).reduce((a, b) => a + b, 0) / (lvrTotal || 1) : 0;
  const o = summary?.overall;
  const sun = summary?.by_kind?.sun_reopen;

  const findings = [
    {
      n: "01",
      value: `${onTime}/${reopens}`,
      title: "The bell rings on time.",
      body: `Coinbase's Chainlink feeds on Base go silent from Friday 20:00 to Sunday 20:00 New York time. On ${onTime} of ${reopens} weekly reopens across 10 stocks, the first new print landed inside the 20:00 minute, typically 35 seconds after the bell. Equity jumps are scheduled to the minute; crypto jumps are not.`,
    },
    {
      n: "02",
      value: pct(o?.skill_dex_vs_no_change),
      title: "The weekend DEX price knows the reopen.",
      body: `Forecasting the first post-bell print, the Aerodrome price 30 s before the bell beats the frozen feed by ${pct(o?.skill_dex_vs_no_change)} in CRPS across ${o?.n ?? "—"} boundaries, out of sample (typical miss ${o?.dex?.mae_bp.toFixed(0) ?? "—"} bp vs ${o?.no_change?.mae_bp.toFixed(0) ?? "—"} bp). At Sunday reopens alone: ${pct(sun?.skill_dex_vs_no_change)}. This contradicts the claim that weekend token prices do not predict Monday.`,
    },
    {
      n: "03",
      value: `$${Math.round(lvrTotal).toLocaleString("en-US")}`,
      title: "Little is left to take at the bell.",
      body: `Because the pool has already moved, LPs lost $${Math.round(lvrTotal).toLocaleString("en-US")} to arbitrage at ${bells.length} scheduled bells (median $${lvrMed.toFixed(0)}). The largest 10% of bells account for ${pct(top10share)} of it. An auction at the bell is tail insurance; the forecast is what keeps the pool priced in the dark.`,
    },
  ];

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
        <span className="label">Working paper · data through {summary?.last?.slice(0, 10) ?? "—"}</span>
        <h1 className="headline" style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>Scheduled jumps.<br /><span className="two">What {o?.n ?? "every"} reopens on Base tell us.</span></h1>
        <p className="haze" style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>
          Tokenized stocks trade around the clock; the prices they track jump only when US markets reopen. We measured every reopen of the 10
          Coinbase stocks that have an onchain feed, from the feed itself and from the Aerodrome pools that trade them.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {findings.map((f, i) => (
          <Reveal key={f.n} delay={i * 70} className="card" style={{ padding: "24px 24px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="mono haze" style={{ fontSize: 12 }}>Finding {f.n}</span>
            <Scramble text={f.value} className="dot" style={{ fontSize: 46, lineHeight: 1, color: "var(--dawn)" }} />
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 500, letterSpacing: "-0.035em" }}>{f.title}</h2>
            <p className="haze" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{f.body}</p>
          </Reveal>
        ))}
      </div>

      <div className="row">
        <Reveal className="card" style={{ flex: "1 1 420px", minWidth: 0, padding: "26px 28px" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--dawn)" }}>Proposition 1 · scheduled-jump LVR</span>
          <p style={{ margin: "14px 0 0", fontFamily: "Georgia, serif", fontSize: 19, lineHeight: 1.6, color: "#E4E7EE" }}>
            A constant-product pool of value <i>V</i> and fee γ facing a jump of log-size <i>J</i> at a time <i>t</i>* known in advance loses
            <i> V</i>·𝔼[(<i>J</i>² − γ²)⁺]/8 to the first arbitrageur under continuous trading. If the first rebalance at <i>t</i>* is sold in a
            priority-taxed auction among <i>n</i> ≥ 2 competing arbitrageurs, LPs recover all but ε of it.
          </p>
          <p className="haze" style={{ margin: "14px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
            Bundi (2026) shows jumps put a floor under LVR that faster blocks cannot remove, because jumps arrive at random. Equity reopens arrive
            on a calendar, so the floor becomes auctionable. BellHook implements the auction; Finding 03 measures how much is at stake on Base today.
          </p>
        </Reveal>
        <Reveal delay={70} className="card" style={{ flex: "1 1 360px", minWidth: 0, padding: "26px 28px" }}>
          <h2 className="label" style={{ marginBottom: 12 }}>Method</h2>
          <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 14, lineHeight: 1.55 }} className="haze">
            <li><span style={{ color: "var(--moon)" }}>Feeds.</span> Every Chainlink round of the 10 feeds since August 2026, read from Base.</li>
            <li><span style={{ color: "var(--moon)" }}>Boundaries.</span> Silences of 6h or more; the first print after each is a bell.</li>
            <li><span style={{ color: "var(--moon)" }}>Pools.</span> Slot0 and liquidity of the live Aerodrome USDC pool at −30 s, +2 s, +60 s and +600 s.</li>
            <li><span style={{ color: "var(--moon)" }}>Forecasts.</span> Laplace bands sized only from earlier events, scored with CRPS, coverage and PIT.</li>
          </ol>
        </Reveal>
      </div>

      <Reveal className="card" style={{ padding: "24px 28px" }}>
        <h2 className="label" style={{ marginBottom: 12 }}>Limits we report, not hide</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "8px 28px", fontSize: 13.5, lineHeight: 1.55 }} className="haze">
          <li>Feeds update on 0.5% moves, so the first print after a bell can lag the true open by minutes.</li>
          <li>LVR uses pre-bell active liquidity and ignores the 3.4 bp fee: slightly high for small events.</li>
          <li>Three months of data; weekday 20:00 opens have only {summary?.by_kind?.overnight_2000?.n ?? "a few"} events.</li>
          <li>Bands are conservative: {pct(o?.dex?.coverage80)} realised against an 80% target.</li>
        </ul>
      </Reveal>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Link className="pill" href="/terminal/ledger">See every forecast</Link>
        <Link className="chip" href="/terminal/auctions" style={{ padding: "0 16px", minHeight: 44, fontSize: 13 }}>Auction economics →</Link>
      </div>
    </>
  );
}
