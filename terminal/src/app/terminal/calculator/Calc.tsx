"use client";

import { useEffect, useMemo, useState } from "react";

export type CalcQuote = { symbol: string; name: string; band80Bp: number | null; expectedMoveBp: number | null; label: string | null; at: string | null };
type Holding = { symbol: string; usd: number };

const KEY = "bell.calc.v1";
const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const LN5 = Math.log(5);

export default function Calc({ quotes }: { quotes: CalcQuote[] }) {
  const usable = quotes.filter((q) => q.band80Bp != null);
  const [rows, setRows] = useState<Holding[]>([{ symbol: usable[0]?.symbol ?? "", usd: 10000 }]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Holding[] | null;
      if (Array.isArray(saved) && saved.length) setRows(saved.filter((r) => usable.some((q) => q.symbol === r.symbol)));
    } catch {}
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {}
  }, [rows, ready]);

  const by = useMemo(() => new Map(usable.map((q) => [q.symbol, q])), [usable]);
  const calc = rows.map((r) => {
    const q = by.get(r.symbol);
    if (!q || q.band80Bp == null) return null;
    const b = q.band80Bp / LN5; // Laplace scale (bp), from the central 80% half-width
    const exp = q.expectedMoveBp ?? 0;
    return {
      typical: (r.usd * q.band80Bp) / 1e4,
      tail: (r.usd * (b * Math.log(10) + Math.max(0, -exp))) / 1e4, // one-sided 95% adverse move
      expected: (r.usd * exp) / 1e4,
    };
  });
  const tot = calc.reduce<{ typical: number; tail: number; expected: number }>((a, c) => ({ typical: a.typical + (c?.typical ?? 0), tail: a.tail + (c?.tail ?? 0), expected: a.expected + (c?.expected ?? 0) }), { typical: 0, tail: 0, expected: 0 });
  const next = usable[0];
  const upd = (i: number, p: Partial<Holding>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      <section className="card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label="Your holdings">
        <h2 className="label">Your tokenized-stock exposure</h2>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Stock" value={r.symbol} onChange={(e) => upd(i, { symbol: e.target.value })} className="chip" style={{ background: "var(--ground)", color: "var(--moon)", padding: "8px 10px" }}>
              {usable.map((q) => <option key={q.symbol} value={q.symbol}>{q.symbol}</option>)}
            </select>
            <input aria-label="Position size in USD" type="number" min={0} step={100} value={r.usd} onChange={(e) => upd(i, { usd: Math.max(0, Number(e.target.value) || 0) })}
              className="mono" style={{ background: "var(--ground)", color: "var(--moon)", border: "1px solid var(--hair-2)", borderRadius: 8, padding: "8px 10px", width: 140 }} />
            <span className="haze" style={{ fontSize: 13 }}>
              {calc[i] ? `typical ±${usd(calc[i]!.typical)} · bad case −${usd(calc[i]!.tail)}` : "no model for this stock"}
            </span>
            {rows.length > 1 && <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="chip" aria-label="Remove row" style={{ cursor: "pointer" }}>remove</button>}
          </div>
        ))}
        <div><button type="button" className="chip" style={{ cursor: "pointer" }} onClick={() => setRows((rs) => [...rs, { symbol: usable[0]?.symbol ?? "", usd: 5000 }])}>+ add stock</button></div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <div className="card kpi"><span className="label">Typical swing at the bell</span><span className="dot v">{usd(tot.typical)}</span><span className="s">80% of reopens land within this</span></div>
        <div className="card kpi"><span className="label">Bad case (95%)</span><span className="dot v" style={{ color: "var(--sodium)" }}>−{usd(tot.tail)}</span><span className="s">one-sided adverse move vs the frozen oracle</span></div>
        <div className="card kpi"><span className="label">Where the pool says it opens</span><span className="dot v" style={{ color: "var(--dawn)" }}>{tot.expected >= 0 ? "+" : "−"}{usd(Math.abs(tot.expected))}</span><span className="s">DEX price vs the frozen oracle now</span></div>
      </div>
      {next && <p className="haze" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>Scenario: the oracle&apos;s next scheduled update{next.label ? ` (${next.label})` : ""}. Ranges come from bell&apos;s fitted Laplace model, which is calibrated on the pool price 30 s before the bell, so treat them as a guide, not a guarantee. Descriptive estimates, not investment advice. Your inputs stay in this browser.</p>}
    </div>
  );
}
