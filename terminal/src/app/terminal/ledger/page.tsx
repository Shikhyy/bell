import { ledgerRows, ledgerSummary, type ModelScore } from "@/lib/research";

export const revalidate = 300;
export const metadata = { title: "Ledger — bell" };

const KIND_LABEL: Record<string, string> = {
  sun_reopen: "Sunday 20:00 reopen",
  open_0930: "Weekday 09:30 open",
  pre_0400: "Weekday 04:00 pre-market",
  overnight_2000: "Weekday 20:00 overnight",
  other: "Feed quiet 6h+ (no 0.5% move)",
};
const pct = (x: number | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const bp = (x: number | undefined, d = 1) => (x == null ? "—" : `${x.toFixed(d)} bp`);

function Reliability({ dex, base }: { dex?: ModelScore; base?: ModelScore }) {
  const X = (p: number) => 30 + p * 250, Y = (p: number) => 270 - p * 250;
  const line = (m?: ModelScore) =>
    m ? "M" + [{ nominal: 0, realised: 0 }, ...m.reliability].map((r) => `${X(r.nominal).toFixed(1)} ${Y(r.realised).toFixed(1)}`).join(" L") : "";
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label="Reliability diagram: realised coverage against stated coverage for both forecasts" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
      {[0.2, 0.4, 0.6, 0.8].map((g) => <path key={g} d={`M30 ${Y(g)} H280 M${X(g)} 270 V20`} stroke="#121826" />)}
      <path d="M30 270 H280 M30 270 V20" stroke="#263047" />
      <line x1={30} y1={270} x2={280} y2={20} stroke="#5D667A" strokeDasharray="2 4" />
      <path d={line(base)} fill="none" stroke="#8C94A7" strokeWidth={1.4} strokeDasharray="5 4" />
      <path d={line(dex)} fill="none" stroke="#78B4FF" strokeWidth={1.8} />
      {dex?.reliability.map((r) => <circle key={r.nominal} cx={X(r.nominal)} cy={Y(r.realised)} r={3.2} fill="#05070B" stroke="#78B4FF" strokeWidth={1.4} />)}
      <text x={30} y={292} fill="#8C94A7" fontSize={10} fontFamily="var(--font-geist-mono)">0%</text>
      <text x={248} y={292} fill="#8C94A7" fontSize={10} fontFamily="var(--font-geist-mono)">100%</text>
      <text x={118} y={292} fill="#8C94A7" fontSize={10} fontFamily="var(--font-geist-mono)">stated band</text>
    </svg>
  );
}

function Pit({ m, color }: { m?: ModelScore; color: string }) {
  if (!m) return null;
  const total = m.pit_hist.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...m.pit_hist.map((c) => c / total), 0.2);
  const H = 150;
  return (
    <svg viewBox="0 0 300 170" role="img" aria-label="PIT histogram; a flat histogram means honest uncertainty" style={{ width: "100%", display: "block" }}>
      {m.pit_hist.map((c, i) => {
        const h = (c / total / max) * H;
        return <rect key={i} x={i * 30 + 3} y={H - h + 4} width={24} height={h} fill={color} fillOpacity={0.7} />;
      })}
      <line x1={0} x2={300} y1={H - (0.1 / max) * H + 4} y2={H - (0.1 / max) * H + 4} stroke="#ECEEF2" strokeDasharray="3 4" />
      <line x1={0} x2={300} y1={H + 4} y2={H + 4} stroke="#263047" />
    </svg>
  );
}

export default async function Ledger() {
  const [s, rows] = await Promise.all([ledgerSummary(), ledgerRows()]);
  if (!s || !s.overall.dex || !s.overall.no_change) {
    return (
      <>
        <h1 className="headline" style={{ fontSize: 28 }}>Ledger</h1>
        <p className="haze">No backtest yet. Run <span className="mono">uv run python -m bell_research.forecast</span> in research/.</p>
      </>
    );
  }
  const o = s.overall;
  const dex = o.dex!, base = o.no_change!;
  const byKey = new Map<string, { dex?: (typeof rows)[number]; base?: (typeof rows)[number] }>();
  for (const r of rows) {
    const k = `${r.ticker}|${r.wakeNy}`;
    const e = byKey.get(k) ?? {};
    if (r.model === "dex") e.dex = r; else e.base = r;
    byKey.set(k, e);
  }
  const recent = [...byKey.values()].filter((e) => e.dex && e.base).sort((a, b) => (a.dex!.wakeNy < b.dex!.wakeNy ? 1 : -1)).slice(0, 14);

  const kpis = [
    { label: "Events scored", value: `${o.n}`, color: "var(--moon)", sub: `${s.first.slice(0, 10)} → ${s.last.slice(0, 10)}, out of sample` },
    { label: "Skill vs no change", value: pct(o.skill_dex_vs_no_change), color: "var(--dawn)", sub: "lower CRPS from the DEX price 30 s before the bell" },
    { label: "Typical miss", value: `${dex.mae_bp.toFixed(0)}bp`, color: "var(--moon)", sub: `vs ${base.mae_bp.toFixed(0)} bp for the frozen feed` },
    { label: "80% band holds", value: pct(dex.coverage80), color: "var(--moon)", sub: "target 80%; above means conservative" },
  ];

  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 680 }}>
          <h1 className="headline" style={{ fontSize: 48 }}>Does the weekend price<br /><span className="two">know the reopen?</span></h1>
          <p className="haze" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
            At every boundary we forecast the first feed print after the market reopens, twice: from the frozen feed (no change) and
            from the Aerodrome price 30 seconds before the bell. Band widths use only earlier events, so every score is out of sample.
          </p>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <span className="label">{k.label}</span>
            <span className="dot v" style={{ color: k.color }}>{k.value}</span>
            <span className="s">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="row">
        <section className="card" aria-labelledby="rel-h" style={{ flex: "1 1 320px", minWidth: 0, padding: "20px 22px" }}>
          <h2 id="rel-h" className="label" style={{ marginBottom: 12 }}>Reliability · stated vs realised coverage</h2>
          <Reliability dex={dex} base={base} />
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10, fontSize: 12 }} className="haze">
            <span><span style={{ display: "inline-block", width: 14, height: 2, background: "var(--dawn)", verticalAlign: "middle" }} /> DEX price</span>
            <span><span style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--haze)", verticalAlign: "middle" }} /> no change</span>
          </div>
        </section>
        <section className="card" aria-labelledby="pit-h" style={{ flex: "1 1 320px", minWidth: 0, padding: "20px 22px" }}>
          <h2 id="pit-h" className="label" style={{ marginBottom: 12 }}>PIT · DEX forecast (flat = honest bands)</h2>
          <Pit m={dex} color="#78B4FF" />
          <h2 className="label" style={{ margin: "16px 0 12px" }}>PIT · no-change forecast</h2>
          <Pit m={base} color="#8C94A7" />
        </section>
        <section className="card" aria-labelledby="kind-h" style={{ flex: "3 1 640px", minWidth: 0, padding: "18px 8px 8px" }}>
          <h2 id="kind-h" className="label" style={{ padding: "0 12px 14px" }}>By boundary</h2>
          <div className="scroll">
            <table className="t" style={{ minWidth: 460 }}>
              <thead><tr><th scope="col">Boundary</th><th scope="col">Events</th><th scope="col">CRPS DEX</th><th scope="col">CRPS no change</th><th scope="col">Skill</th><th scope="col">80% band</th></tr></thead>
              <tbody>
                {Object.entries(s.by_kind).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ fontFamily: "var(--font-geist)" }}>{KIND_LABEL[k] ?? k}</td>
                    <td className="haze">{v.n}</td>
                    <td>{bp(v.dex?.crps_bp)}</td>
                    <td className="haze">{bp(v.no_change?.crps_bp)}</td>
                    <td style={{ color: (v.skill_dex_vs_no_change ?? 0) >= 0 ? "var(--dawn)" : "var(--sodium)" }}>{pct(v.skill_dex_vs_no_change)}</td>
                    <td className="haze">{pct(v.dex?.coverage80)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="haze" style={{ fontSize: 12, margin: "12px 12px 4px", lineHeight: 1.5 }}>
            The DEX price helps most at Sunday reopens and 09:30 opens, least at 04:00 pre-market, and does worse than no change at weekday 20:00 overnight opens (only 10 events so far).
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="led-h" style={{ padding: "18px 8px 8px" }}>
        <h2 id="led-h" className="label" style={{ padding: "0 12px 14px" }}>Ledger · most recent events</h2>
        <div className="scroll">
          <table className="t" style={{ minWidth: 820 }}>
            <thead><tr><th scope="col">Feed woke (ET)</th><th scope="col">Token</th><th scope="col">Boundary</th><th scope="col">Reopen print</th><th scope="col">DEX forecast</th><th scope="col">DEX miss</th><th scope="col">80% band</th><th scope="col">No-change miss</th></tr></thead>
            <tbody>
              {recent.map(({ dex: d, base: b }) => (
                <tr key={`${d!.ticker}${d!.wakeNy}`}>
                  <td>{d!.wakeNy.slice(5, 16)}</td>
                  <td>{d!.ticker}c</td>
                  <td className="haze" style={{ fontFamily: "var(--font-geist)" }}>{KIND_LABEL[d!.kind] ?? d!.kind}</td>
                  <td>{d!.feedPost.toFixed(2)}</td>
                  <td>{d!.center.toFixed(2)}</td>
                  <td style={{ color: d!.in80 ? "var(--moon)" : "var(--sodium)" }}>{d!.errBp > 0 ? "+" : "−"}{Math.abs(d!.errBp).toFixed(1)} bp</td>
                  <td className="haze">±{d!.band80Bp.toFixed(0)} bp {d!.in80 ? "✓" : "miss"}</td>
                  <td className="haze">{b!.errBp > 0 ? "+" : "−"}{Math.abs(b!.errBp).toFixed(1)} bp</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="haze" style={{ fontSize: 12, margin: 0 }}>{s.method}. Warm-up {s.warmup_events} events.</p>
    </>
  );
}
