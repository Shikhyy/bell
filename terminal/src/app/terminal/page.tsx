import Link from "next/link";
import { Sky } from "@/components/Sky";
import { Age, ClockChip } from "@/components/Live";
import { Scramble } from "@/components/Motion";
import { WeekClock } from "@/components/WeekClock";
import { readFeeds } from "@/lib/chain";
import { DARK_AFTER_S, TOKENS } from "@/lib/config";
import { readMarkets, readMeta } from "@/lib/market";
import { allDark, darkStats, weekActivity } from "@/lib/research";
import { SESSION_LABEL, isDark, nextBoundaries, sessionAt } from "@/lib/session";

export const revalidate = 30;

const usd = (n: number | null, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const compact = (n: number | null) => (n == null ? "—" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const bp = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(0)} bp`);

export default async function Overview() {
  const [feeds, markets, meta, dark, activity] = await Promise.all([readFeeds(), readMarkets(), readMeta(), allDark(), weekActivity()]);
  const now = new Date();
  const session = sessionAt(now);
  const upcoming = nextBoundaries(now, 6);
  const bell = upcoming.find((b) => b.bell) ?? upcoming[0];
  const nowS = now.getTime() / 1000;

  const rows = TOKENS.map((t, i) => {
    const f = feeds[i];
    const m = markets[t.symbol];
    const st = darkStats(dark[t.symbol] ?? []);
    const delta = f.price && m.mark ? (m.mark / f.price - 1) * 1e4 : null;
    const z = delta != null && st.sigma ? delta / (st.sigma * 100) : null;
    const isDarkFeed = f.updatedAt != null && nowS - f.updatedAt > DARK_AFTER_S;
    return { t, f, m, st, delta, z, isDarkFeed, name: meta[t.symbol]?.name ?? t.ticker };
  });

  const darkCount = rows.filter((r) => r.isDarkFeed).length;
  const deltas = rows.map((r) => r.delta).filter((x): x is number => x != null).map(Math.abs).sort((a, b) => a - b);
  const medDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  const allStats = rows.map((r) => r.st);
  const reopens = allStats.reduce((s, x) => s + x.n, 0);
  const onTime = allStats.reduce((s, x) => s + x.exact, 0);
  const sunJumps = Object.values(dark).flat().filter((w) => w.weeklyReopen).map((w) => Math.abs(w.jumpPct)).sort((a, b) => a - b);
  const medJump = sunJumps.length ? sunJumps[Math.floor(sunJumps.length / 2)] : null;

  const kpis = [
    { label: "Feeds dark", value: `${darkCount}/${TOKENS.length}`, color: darkCount ? "var(--sodium)" : "var(--moon)", sub: "no Chainlink update for 6h+" },
    { label: "Weekend drift", value: medDelta == null ? "—" : `${medDelta.toFixed(0)}bp`, color: "var(--moon)", sub: "DEX price vs last feed value, median" },
    { label: "Bells on time", value: `${onTime}/${reopens}`, color: "var(--dawn)", sub: "Sunday reopens inside the 20:00 ET minute" },
    { label: "Median reopen jump", value: medJump == null ? "—" : `${medJump.toFixed(2)}%`, color: "var(--moon)", sub: "feed move across the weekend" },
  ];

  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <h1 className="headline" style={{ fontSize: 28 }}>Overview</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="chip"><span className="dotmark live" style={{ background: isDark(session) ? "var(--sodium)" : "var(--dawn)", ["--beat" as string]: isDark(session) ? "rgba(255,158,74,.55)" : "rgba(120,180,255,.55)" }} />{SESSION_LABEL[session]}</span>
          <ClockChip />
        </div>
      </header>

      <section aria-label="Session" className="band">
        <Sky kind="band" />
        <div className="band-inner">
          <p className="headline" style={{ fontSize: 32, lineHeight: 1.02 }}>
            {isDark(session) ? "Market closed." : SESSION_LABEL[session] + "."}
            <br />
            <span style={{ color: "var(--night-text)" }}>Next bell: {bell.label.toLowerCase()}, {bell.when} ET.</span>
          </p>
          <Link className="pill" href="/terminal/NVDAc" style={{ minHeight: 40, fontSize: 14, padding: "0 18px" }}>Open NVDAc</Link>
        </div>
      </section>

      <div className="row">
        <section className="card" aria-labelledby="clock-h" style={{ flex: "1 1 460px", minWidth: 0, padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <h2 id="clock-h" className="label">When information reaches the chain</h2>
            <span className="mono haze" style={{ fontSize: 11 }}>oracle updates by hour · ET</span>
          </div>
          <WeekClock activity={activity} bellAt={bell.at} bellLabel={`${bell.label} · ${bell.when}`} />
          <p className="haze" style={{ fontSize: 12.5, margin: "12px 0 0", textAlign: "center" }}>
            Amber: hours when the 10 feeds update. Blue: hours with no updates at all. The DEX keeps trading through both.
          </p>
        </section>

        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="kpis">
            {kpis.map((k) => (
              <div key={k.label} className="card kpi">
                <span className="label">{k.label}</span>
                <Scramble text={k.value} className="dot v" style={{ color: k.color }} />
                <span className="s">{k.sub}</span>
              </div>
            ))}
          </div>
          <section className="card" aria-labelledby="sched-h" style={{ padding: "18px 20px", flex: 1 }}>
            <h2 id="sched-h" className="label" style={{ marginBottom: 8 }}>Scheduled jumps ahead</h2>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {upcoming.map((b) => (
                <li key={b.at} style={{ display: "grid", gridTemplateColumns: "128px 1fr auto", gap: 14, alignItems: "center", padding: "11px 0", borderTop: "1px solid var(--hair)" }}>
                  <span className="mono" style={{ fontSize: 12 }}>{b.when}</span>
                  <span style={{ fontSize: 14 }}>{b.label}</span>
                  <span className="chip" style={{ color: b.bell ? "var(--dawn)" : "var(--haze)" }}>{b.bell ? "bell" : "close"}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="dv-h" style={{ padding: "18px 8px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "0 12px 14px" }}>
          <h2 id="dv-h" className="label">Dark variance · DEX price against the last feed value</h2>
          <span className="mono haze" style={{ fontSize: 11 }}>σ = RMS of past Sunday reopen jumps · z = drift / σ</span>
        </div>
        <div className="scroll">
          <table className="t" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th scope="col">Token</th><th scope="col">Feed</th><th scope="col">Feed age</th><th scope="col">DEX price</th>
                <th scope="col">Drift</th><th scope="col">σ dark</th><th scope="col">z</th><th scope="col">Liquidity</th><th scope="col">24h volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t.symbol}>
                  <td><Link href={`/terminal/${r.t.symbol}`} style={{ color: "var(--moon)" }}>{r.t.symbol}</Link> <span className="haze" style={{ fontFamily: "var(--font-geist)" }}>{r.name}</span></td>
                  <td>{usd(r.f.price)}</td>
                  <td style={{ color: r.isDarkFeed ? "var(--sodium)" : "var(--haze)" }}><Age ts={r.f.updatedAt} /></td>
                  <td>{usd(r.m.mark)}</td>
                  <td style={{ color: r.delta == null ? undefined : Math.abs(r.delta) > 50 ? "var(--sodium)" : "var(--moon)" }}>{bp(r.delta)}</td>
                  <td>{r.st.sigma == null ? "—" : `${r.st.sigma.toFixed(2)}%`}</td>
                  <td style={{ color: r.z != null && Math.abs(r.z) > 1 ? "var(--sodium)" : "var(--haze)" }}>{r.z == null ? "—" : r.z.toFixed(2)}</td>
                  <td>{compact(r.m.liquidity)}</td>
                  <td>{compact(r.m.volume24h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="haze" style={{ fontSize: 12, margin: 0 }}>
        Live: Chainlink feeds on Base (multicall), DEX prices from the deepest USDC pool per token (DexScreener), refreshed every 30s.
        History: every feed round since August 2026, read from Base by the research pipeline.
      </p>
    </>
  );
}
