import { forwardTest, type ForwardRun } from "@/lib/research";

export const revalidate = 60;
export const metadata = { title: "Forward test — bell" };

const px = (x: number | undefined | null) => (x == null ? "—" : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const bp = (x: number | undefined | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(0)}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " UTC";

function Run({ run }: { run: ForwardRun }) {
  const r = run.result;
  const byStock = new Map(r?.stocks.map((s) => [s.symbol, s]));
  return (
    <section className="card" style={{ padding: "18px 8px 8px" }} aria-label={`Forecasts for the ${run.bell.label} on ${run.bell.at}`}>
      <div style={{ padding: "0 14px 12px", display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "baseline" }}>
        <h2 className="label">{run.bell.label} · {when(run.bell.at)}</h2>
        <span className="haze" style={{ fontSize: 12.5 }}>
          forecast locked {Math.round(run.secondsBeforeBell / 60)} min before the bell · sha256 <span className="mono">{run.contentSha256.slice(0, 12)}…</span>
          {r && r.n > 0 ? ` · ${r.n}/${run.forecasts.length} scored` : " · waiting for the bell"}
        </span>
      </div>
      <div className="scroll">
        <table className="t" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>Stock</th>
              <th scope="col">Frozen</th><th scope="col">DEX</th><th scope="col">80% band</th>
              <th scope="col">First print</th><th scope="col">After bell</th>
              <th scope="col">Miss (DEX), bp</th><th scope="col">Miss (frozen), bp</th><th scope="col">In band</th>
            </tr>
          </thead>
          <tbody>
            {run.forecasts.map((f) => {
              const s = byStock.get(f.symbol);
              const scored = s?.status === "scored";
              return (
                <tr key={f.symbol}>
                  <td style={{ textAlign: "left" }}>{f.symbol}</td>
                  <td>{px(f.frozenOracle.price)}</td>
                  <td>{px(f.dexPrice)}</td>
                  <td className="haze">{f.band80 ? `${px(f.band80[0])}–${px(f.band80[1])}` : "—"}</td>
                  <td>{scored ? px(s!.firstPrint) : s?.status === "no_print" ? "no print" : "—"}</td>
                  <td className="haze">{scored ? `${s!.secondsAfterBell}s` : "—"}</td>
                  <td style={{ color: scored ? "var(--dawn)" : undefined }}>{scored ? bp(s!.errDexBp) : "—"}</td>
                  <td>{scored ? bp(s!.errFrozenBp) : "—"}</td>
                  <td>{scored ? (s!.inBand80 ? "yes" : "no") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r && r.n > 0 && (
        <p className="haze" style={{ margin: 0, padding: "12px 14px 8px", fontSize: 12.5 }}>
          This bell: CRPS {r.crpsDexBp} bp (DEX) vs {r.crpsFrozenBp} bp (frozen) · mean miss {r.maeDexBp} vs {r.maeFrozenBp} bp · 80% band held for {Math.round((r.coverage80 ?? 0) * 100)}% · {r.insideBellMinute}/{r.n} printed inside the bell minute
        </p>
      )}
    </section>
  );
}

export default async function Forward() {
  const { summary, runs } = await forwardTest();
  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
        <span className="label">Pre-registered, scored in public</span>
        <h1 className="headline" style={{ fontSize: "clamp(34px, 5vw, 48px)" }}>Forecasts made<br /><span className="two">before the bell.</span></h1>
        <p className="haze" style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>
          A backtest can be tuned after the fact. Before each bell, bell writes down the forecasts it serves, commits them with a hash
          anchored on Base Sepolia, and scores them against the first Chainlink print after the bell. Tiny samples are anecdotes, not
          evidence; the record grows every week and the code is in <span className="mono">forward/</span>.
        </p>
      </header>

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          {[
            { label: "Bells scored", value: String(summary.bells), sub: `${summary.stocksScored} stock forecasts` },
            { label: "Forecast error (CRPS)", value: `${summary.crpsDexBp.toFixed(1)} bp`, sub: `vs ${summary.crpsFrozenBp.toFixed(1)} bp for the frozen oracle` },
            { label: "Skill vs frozen oracle", value: `${summary.skill >= 0 ? "+" : ""}${(summary.skill * 100).toFixed(0)}%`, sub: "backtest: +74% over 629 boundaries" },
            { label: "80% band held", value: `${Math.round(summary.coverage80 * 100)}%`, sub: "backtest: 90%" },
          ].map((k) => (
            <div key={k.label} className="card kpi">
              <span className="label">{k.label}</span>
              <span className="dot v" style={{ color: "var(--moon)" }}>{k.value}</span>
              <span className="s">{k.sub}</span>
            </div>
          ))}
        </div>
      )}

      {runs.length === 0 && <p className="haze">No forecasts recorded yet. The next one is written 45 minutes before the Sunday reopen.</p>}
      {runs.map((run) => <Run key={run.file} run={run} />)}

      <p className="haze" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
        Target: the first Chainlink round at or after the bell. Forecast: the Aerodrome price shortly before the bell, with a Laplace band whose
        scale uses only past events. Baseline: the frozen oracle, with its own scale from the backtest. Descriptive estimates, not investment advice.
      </p>
    </>
  );
}
