import { Countdown } from "@/components/Live";
import { jumps, kindOf, ledgerRows } from "@/lib/research";
import { etParts, nextBoundaries } from "@/lib/session";

export const revalidate = 300;
export const metadata = { title: "Auctions — bell" };

const BELLS: Record<string, string> = { sun_reopen: "Sunday 20:00 reopen", open_0930: "Weekday 09:30 open", pre_0400: "Weekday 04:00 pre-market" };
const POOL_FEE_BP = 3.38; // Aerodrome Slipstream NVDAc/USDC fee: 338 pips
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

const PHASES = [
  { name: "Dark", color: "var(--dawn)", when: "feed silent 6h+", note: "Low fee. The keeper posts the reserve from the forecast band." },
  { name: "Bell", color: "var(--sodium)", when: "feed updatedAt advances", note: "BellHook sees the reopen onchain. No keeper needed." },
  { name: "Auction", color: "var(--dawn)", when: "2 blocks", note: "Fee = priority fee × rate, floored at the reserve, capped at 10%." },
  { name: "Dawn", color: "var(--moon)", when: "block n+2 →", note: "Normal fee. Pool price matches the market." },
];

export default async function Auctions() {
  const [js, ledger] = await Promise.all([jumps(), ledgerRows()]);
  const events = js
    .filter((j) => j.lvrUsd != null && j.poolPre != null)
    .map((j) => ({ ...j, kind: kindOf(j.wakeTs), prebellBp: Math.abs((j.poolPre! / j.feedPost - 1) * 1e4) }))
    .filter((e) => e.kind in BELLS);

  // Reserve the keeper would post: latest out-of-sample 80% band for each boundary type.
  const latestBand: Record<string, number> = {};
  for (const r of ledger) if (r.model === "dex" && r.kind in BELLS) latestBand[r.kind] = r.band80Bp;

  const next = nextBoundaries(new Date(), 8).find((b) => b.bell)!;
  const nextKind = kindOf(Math.floor(new Date(next.at).getTime() / 1000));
  const total = events.reduce((s, e) => s + (e.lvrUsd ?? 0), 0);
  const profitable = events.filter((e) => e.prebellBp > POOL_FEE_BP).length;

  const rows = Object.entries(BELLS).map(([k, label]) => {
    const es = events.filter((e) => e.kind === k);
    const l = es.map((e) => e.lvrUsd ?? 0);
    return { k, label, n: es.length, med: q(l, 0.5), p90: q(l, 0.9), sum: l.reduce((a, b) => a + b, 0), share: es.length ? es.filter((e) => e.prebellBp > POOL_FEE_BP).length / es.length : 0, band: latestBand[k] };
  });
  const top = [...events].sort((a, b) => (b.lvrUsd ?? 0) - (a.lvrUsd ?? 0)).slice(0, 10);
  const wake = (ts: number) => { const p = etParts(new Date(ts * 1000)); return `${p.weekday} ${p.monthDay} ${p.hhmm}`; };

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
        <h1 className="headline" style={{ fontSize: 48 }}>The auction at the bell.<br /><span className="two">What it could have won back.</span></h1>
        <p className="haze" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
          At each scheduled reopen we read the pool 30 seconds before the bell and compare it with the market&apos;s first print. The gap is what the
          first arbitrageur takes from LPs, and the most BellHook&apos;s auction could return to them.
        </p>
      </header>

      <section className="card" aria-label="BellHook phases" style={{ padding: "22px 24px" }}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          {PHASES.map((p) => (
            <li key={p.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.color }} />
                <span style={{ flex: 1, height: 1, background: "var(--hair-2)" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 12, color: p.color }}>{p.when}</span>
              <span className="haze" style={{ fontSize: 13, lineHeight: 1.5 }}>{p.note}</span>
            </li>
          ))}
        </ol>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div className="card kpi"><span className="label">Next auction</span><span className="dot v"><Countdown to={next.at} /></span><span className="s">{next.label} · {next.when} ET</span></div>
        <div className="card kpi"><span className="label">Reserve to post</span><span className="dot v" style={{ color: "var(--dawn)" }}>{latestBand[nextKind] != null ? `${latestBand[nextKind].toFixed(0)}bp` : "—"}</span><span className="s">80% forecast band for this boundary</span></div>
        <div className="card kpi"><span className="label">Lost at the bell</span><span className="dot v" style={{ color: "var(--sodium)" }}>{usd(total)}</span><span className="s">{events.length} bells, 10 pools, measured</span></div>
        <div className="card kpi"><span className="label">Bells worth arbing</span><span className="dot v">{events.length ? `${Math.round((profitable / events.length) * 100)}%` : "—"}</span><span className="s">pool off by more than its {POOL_FEE_BP} bp fee</span></div>
      </div>

      <section className="card" aria-labelledby="bk-h" style={{ padding: "18px 8px 8px" }}>
        <h2 id="bk-h" className="label" style={{ padding: "0 12px 14px" }}>Loss at the bell, by boundary · the auction&apos;s upper bound</h2>
        <div className="scroll">
          <table className="t" style={{ minWidth: 700 }}>
            <thead><tr><th scope="col">Boundary</th><th scope="col">Bells</th><th scope="col">Median</th><th scope="col">90th pct</th><th scope="col">Total</th><th scope="col">Worth arbing</th><th scope="col">Reserve now</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td style={{ fontFamily: "var(--font-geist)" }}>{r.label}</td>
                  <td className="haze">{r.n}</td>
                  <td>{usd(r.med)}</td>
                  <td>{usd(r.p90)}</td>
                  <td className="sodium">{usd(r.sum)}</td>
                  <td>{Math.round(r.share * 100)}%</td>
                  <td className="dawn">{r.band != null ? `${r.band.toFixed(0)} bp` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="haze" style={{ fontSize: 12.5, margin: "12px 12px 4px", lineHeight: 1.55 }}>
          Losses at the bell are small and concentrated in a few events, because the weekend DEX price already absorbs most of the reopen
          (see Ledger). The auction is insurance for the tail; the forecast is what keeps the pool priced through the dark hours.
        </p>
      </section>

      <section className="card" aria-labelledby="top-h" style={{ padding: "18px 8px 8px" }}>
        <h2 id="top-h" className="label" style={{ padding: "0 12px 14px" }}>Largest bells</h2>
        <div className="scroll">
          <table className="t" style={{ minWidth: 700 }}>
            <thead><tr><th scope="col">Feed woke (ET)</th><th scope="col">Token</th><th scope="col">Boundary</th><th scope="col">Jump</th><th scope="col">Pool off at bell</th><th scope="col">DEX had priced</th><th scope="col">Loss at bell</th></tr></thead>
            <tbody>
              {top.map((e) => (
                <tr key={`${e.ticker}${e.wakeTs}`}>
                  <td>{wake(e.wakeTs)}</td>
                  <td>{e.ticker}c</td>
                  <td className="haze" style={{ fontFamily: "var(--font-geist)" }}>{BELLS[e.kind]}</td>
                  <td>{e.jumpPct > 0 ? "+" : "−"}{Math.abs(e.jumpPct).toFixed(2)}%</td>
                  <td>{e.prebellBp.toFixed(1)} bp</td>
                  <td className="haze">{e.weekendShare == null ? "—" : `${(e.weekendShare * 100).toFixed(0)}%`}</td>
                  <td className="sodium">{usd(e.lvrUsd ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="haze" style={{ fontSize: 12, margin: 0 }}>
        Loss = L·(√P₁ − √P₀)²/√P₀ from pool state 30 s before the bell and the first feed print after it (Milionis et al. 2022). It ignores the pool fee and
        assumes in-range liquidity, so it slightly overstates small events. Pools: the most liquid Aerodrome USDC pool live at each bell.
      </p>
    </>
  );
}
