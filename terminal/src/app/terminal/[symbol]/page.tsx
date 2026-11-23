import Link from "next/link";
import { notFound } from "next/navigation";
import { Age } from "@/components/Live";
import { PriceChart } from "@/components/PriceChart";
import { readFeeds } from "@/lib/chain";
import { DARK_AFTER_S, TOKENS, bySymbol } from "@/lib/config";
import { readMarkets, readMeta } from "@/lib/market";
import { darkStats, darkWindows, feedUpdates, jumps } from "@/lib/research";

export const revalidate = 30;

const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return { title: `${bySymbol(symbol)?.symbol ?? symbol} — bell` };
}

export default async function TokenPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const token = bySymbol(symbol);
  if (!token) notFound();

  const [feeds, markets, meta, ups, js] = await Promise.all([readFeeds(), readMarkets(), readMeta(), feedUpdates(token.ticker), jumps()]);
  const feed = feeds[TOKENS.indexOf(token)];
  const m = markets[token.symbol];
  const info = meta[token.symbol];
  const windows = darkWindows(token.ticker, ups);
  const st = darkStats(windows);
  const nowS = Date.now() / 1000;
  const feedDark = feed.updatedAt != null && nowS - feed.updatedAt > DARK_AFTER_S;
  const drift = feed.price && m.mark ? (m.mark / feed.price - 1) * 1e4 : null;
  const jumpByTs = new Map(js.filter((j) => j.ticker === token.ticker).map((j) => [j.wakeTs, j]));

  const chartPoints = ups.map((u) => ({ t: u.t, p: u.price }));
  const chartWindows = windows.map((w) => ({ from: w.from, to: w.to, weekly: w.weeklyReopen, jumpPct: w.jumpPct, post: w.post }));
  const recent = windows.slice(-12).reverse();

  return (
    <>
      <div className="mono haze" style={{ fontSize: 12 }}>
        <Link href="/terminal" className="haze">Overview</Link> / Tokens / <span style={{ color: "var(--moon)" }}>{token.symbol}</span>
      </div>

      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 className="headline" style={{ fontSize: 64 }}>{token.symbol}</h1>
          <span className="haze" style={{ fontSize: 15 }}>{info?.name ?? token.ticker} · Coinbase tokenized stock · B20 on Base</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="label">DEX price</span>
          <span className="dot" style={{ fontSize: 56, lineHeight: 0.95 }}>{fmt(m.mark)}</span>
          <span className="mono" style={{ fontSize: 13, color: drift != null && Math.abs(drift) > 50 ? "var(--sodium)" : "var(--haze)" }}>
            {drift == null ? "—" : `${drift > 0 ? "+" : "−"}${Math.abs(drift).toFixed(0)} bp vs feed`}
          </span>
        </div>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span className="chip"><span className="dotmark" style={{ background: feedDark ? "var(--sodium)" : "var(--dawn)" }} />Chainlink feed {feedDark ? "dark" : "live"} · updated <Age ts={feed.updatedAt} /> ago</span>
        <span className="chip">Feed {fmt(feed.price)}</span>
        {info?.multiplier != null && <span className="chip">Multiplier {info.multiplier.toFixed(6)}</span>}
        {info?.supply != null && <span className="chip">Supply {fmt(info.supply)}</span>}
        {m.url && <a className="chip" href={m.url} target="_blank" rel="noreferrer">Pool on DexScreener ↗</a>}
      </div>

      <div className="row">
        <section className="card" aria-label="Price history" style={{ flex: "999 1 560px", minWidth: 0, padding: "22px 24px" }}>
          <PriceChart points={chartPoints} windows={chartWindows} dex={m.mark} now={Math.floor(nowS)} symbol={token.symbol} />
        </section>

        <section className="card" aria-labelledby="st-h" style={{ flex: "1 1 280px", minWidth: 0, padding: "20px 22px" }}>
          <h2 id="st-h" className="label" style={{ marginBottom: 6 }}>Weekly reopens</h2>
          {[
            ["Measured", `${st.n}`],
            ["Inside the 20:00 ET minute", `${st.exact}/${st.n}`],
            ["Median jump", st.medianAbsJump == null ? "—" : `${st.medianAbsJump.toFixed(2)}%`],
            ["σ dark", st.sigma == null ? "—" : `${st.sigma.toFixed(2)}%`],
            ["Liquidity", m.liquidity == null ? "—" : `$${fmt(m.liquidity, 0)}`],
            ["24h volume", m.volume24h == null ? "—" : `$${fmt(m.volume24h, 0)}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: "1px solid var(--hair)", fontSize: 13.5 }}>
              <span className="haze">{k}</span><span className="mono">{v}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="card" aria-labelledby="dw-h" style={{ padding: "18px 8px 8px" }}>
        <h2 id="dw-h" className="label" style={{ padding: "0 12px 14px" }}>Dark windows · most recent first</h2>
        <div className="scroll">
          <table className="t" style={{ minWidth: 720 }}>
            <thead>
              <tr><th scope="col">Feed woke</th><th scope="col">Dark for</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Jump</th><th scope="col">DEX had priced</th><th scope="col">Loss at bell</th></tr>
            </thead>
            <tbody>
              {recent.map((w) => {
                const j = jumpByTs.get(w.to);
                return (
                  <tr key={w.to}>
                    <td>{w.wakeLabel} ET {w.weeklyReopen && <span className="chip" style={{ marginLeft: 8, color: "var(--dawn)" }}>weekly</span>}</td>
                    <td className="haze">{w.gapH.toFixed(1)}h</td>
                    <td>{fmt(w.pre)}</td>
                    <td>{fmt(w.post)}</td>
                    <td style={{ color: Math.abs(w.jumpPct) >= 1 ? "var(--sodium)" : "var(--moon)" }}>{w.jumpPct > 0 ? "+" : "−"}{Math.abs(w.jumpPct).toFixed(2)}%</td>
                    <td className="haze">{j?.weekendShare == null ? "—" : `${(j.weekendShare * 100).toFixed(0)}%`}</td>
                    <td className="haze">{j?.lvrUsd == null ? "—" : `$${fmt(j.lvrUsd, 0)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
