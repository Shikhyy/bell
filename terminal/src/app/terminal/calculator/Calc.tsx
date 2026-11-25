"use client";

import { useEffect, useMemo, useState } from "react";

export type CalcQuote = { symbol: string; name: string; price: number | null; band80Bp: number | null; expectedMoveBp: number | null; label: string | null; at: string | null };
type Holding = { id: number; symbol: string; usd: number };

const KEY = "bell.calc.v2";
const LN5 = Math.log(5);
const LN10 = Math.log(10);
const money = (x: number, d = 0) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d });
const signed = (x: number, d = 0) => `${x < 0 ? "−" : "+"}${money(Math.abs(x), d)}`;
const PRESETS = [1000, 5000, 10000, 50000];

function useCountdown(iso: string | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso || now == null) return null;
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

/** Laplace density curve with the central 80% shaded, the frozen oracle and the bad case marked. */
function Curve({ centre, typical, worst }: { centre: number; typical: number; worst: number }) {
  const W = 640, H = 190, padX = 24, base = 150;
  const b = Math.max(typical, 1e-6) / LN5;
  const span = Math.max(4.2 * b, Math.abs(centre) + 4 * b, Math.abs(worst) * 1.2);
  const x = (v: number) => padX + ((v + span) / (2 * span)) * (W - 2 * padX);
  const pdf = (v: number) => Math.exp(-Math.abs(v - centre) / b);
  const N = 120;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const v = -span + (2 * span * i) / N;
    return [x(v), base - pdf(v) * 118] as const;
  });
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const lo = centre - typical, hi = centre + typical;
  const band = pts.filter((_, i) => { const v = -span + (2 * span * i) / N; return v >= lo && v <= hi; });
  const bandPath = band.length > 1 ? `M${band[0][0]} ${base} ` + band.map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join(" ") + ` L${band[band.length - 1][0]} ${base} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Likely range of your portfolio value change at the next bell: typical swing ${money(typical)}, bad case ${signed(worst)}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="fillBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#78b4ff" stopOpacity=".42" /><stop offset="1" stopColor="#78b4ff" stopOpacity=".04" /></linearGradient>
      </defs>
      <line x1={padX} x2={W - padX} y1={base} y2={base} stroke="var(--hair-3)" />
      {bandPath && <path d={bandPath} fill="url(#fillBand)" />}
      <path d={line} fill="none" stroke="var(--dawn)" strokeWidth="2" strokeLinejoin="round" />
      <line x1={x(0)} x2={x(0)} y1={22} y2={base} stroke="var(--moon)" strokeDasharray="3 4" opacity=".7" />
      <text x={x(0)} y={14} textAnchor="middle" fontSize="11" fill="var(--soft)">frozen oracle now</text>
      <line x1={x(worst)} x2={x(worst)} y1={70} y2={base} stroke="var(--sodium)" strokeWidth="2" />
      <circle cx={x(worst)} cy={70} r="4" fill="var(--sodium)" />
      <text x={x(worst)} y={58} textAnchor="middle" fontSize="11" fill="var(--sodium)">bad case {signed(worst)}</text>
      <text x={x(lo)} y={base + 20} textAnchor="middle" fontSize="11" fill="var(--haze)">{signed(lo)}</text>
      <text x={x(hi)} y={base + 20} textAnchor="middle" fontSize="11" fill="var(--haze)">{signed(hi)}</text>
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--dusk)">change in value at the next bell · shaded = where 80% of reopens land</text>
    </svg>
  );
}

export default function Calc({ quotes }: { quotes: CalcQuote[] }) {
  const usable = useMemo(() => quotes.filter((q) => q.band80Bp != null), [quotes]);
  const [rows, setRows] = useState<Holding[]>([{ id: 1, symbol: usable[0]?.symbol ?? "", usd: 10000 }]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Holding[] | null;
      const ok = Array.isArray(saved) ? saved.filter((r) => usable.some((q) => q.symbol === r.symbol)) : [];
      if (ok.length) setRows(ok);
    } catch {}
    setReady(true);
  }, [usable]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {}
  }, [rows, ready]);

  const by = useMemo(() => new Map(usable.map((q) => [q.symbol, q])), [usable]);
  const calc = rows.map((r) => {
    const q = by.get(r.symbol);
    if (!q || q.band80Bp == null) return { typical: 0, worst: 0, expected: 0 };
    const b = q.band80Bp / LN5; // Laplace scale (bp) from the central 80% half-width
    const exp = q.expectedMoveBp ?? 0;
    const expected = (r.usd * exp) / 1e4;
    return { typical: (r.usd * q.band80Bp) / 1e4, worst: expected - (r.usd * b * LN10) / 1e4, expected }; // worst: 5% lower tail of the oracle print vs today
  });
  const tot = calc.reduce((a, c) => ({ typical: a.typical + c.typical, worst: a.worst + c.worst, expected: a.expected + c.expected }), { typical: 0, worst: 0, expected: 0 });
  const totalUsd = rows.reduce((a, r) => a + r.usd, 0);
  const next = usable.find((q) => q.at) ?? usable[0];
  const countdown = useCountdown(next?.at ?? null);
  const upd = (id: number, p: Partial<Holding>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const unused = usable.filter((q) => !rows.some((r) => r.symbol === q.symbol));

  return (
    <div className="calc">
      <style>{`
        .calc { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; max-width: 880px; width: 100%; }
        .calc > * { min-width: 0; }
        .calc .controls { min-width: 0; }
        .calc .hero { padding: 26px 26px 18px; background: radial-gradient(120% 140% at 0% 0%, rgba(255,158,74,.10), transparent 55%), radial-gradient(120% 140% at 100% 0%, rgba(120,180,255,.10), transparent 55%), var(--slate); }
        .calc .big { font-size: clamp(44px, 9vw, 76px); line-height: 1; color: var(--moon); }
        .calc .sub { color: var(--haze); font-size: 14px; line-height: 1.5; margin: 8px 0 0; }
        .calc .trio { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 18px; }
        .calc .tile { padding: 14px 16px; border: 1px solid var(--hair-2); border-radius: 10px; background: rgba(5,7,11,.45); }
        .calc .tile b { display: block; font-size: 24px; font-weight: 600; letter-spacing: -0.03em; margin: 4px 0 2px; }
        .calc .tile span { font-size: 12.5px; color: var(--haze); }
        .calc .clock { display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--hair-3); font-size: 12.5px; color: var(--soft); margin-bottom: 14px; }
        .calc .holding { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px 16px; padding: 16px; align-items: center; }
        .calc .tick { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-weight: 700; font-size: 13px; letter-spacing: -0.02em; background: linear-gradient(160deg, #1b2740, #0f1420); border: 1px solid var(--hair-3); color: var(--dawn); }
        .calc .controls { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
        .calc select, .calc input[type=number] { background: var(--ground); color: var(--moon); border: 1px solid var(--hair-3); border-radius: 10px; padding: 9px 12px; font: inherit; font-size: 15px; }
        .calc input[type=number] { width: 150px; }
        .calc select { flex: 1 1 220px; min-width: 0; max-width: 100%; }
        .calc input[type=range] { width: 100%; accent-color: var(--dawn); grid-column: 1 / -1; }
        .calc .preset { cursor: pointer; background: transparent; color: var(--soft); }
        .calc .preset:hover, .calc .preset[aria-pressed=true] { color: var(--moon); border-color: var(--dawn); }
        .calc .meter { grid-column: 1 / -1; height: 8px; border-radius: 99px; background: var(--hair); position: relative; overflow: hidden; }
        .calc .meter i { position: absolute; top: 0; bottom: 0; border-radius: 99px; }
        .calc .row-note { grid-column: 1 / -1; font-size: 13px; color: var(--haze); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .calc button.chip { cursor: pointer; }
        .calc button.chip:hover { color: var(--moon); border-color: var(--hair-3); }
        @media (max-width: 520px) { .calc .hero { padding: 20px 16px 14px; } .calc input[type=number] { width: 120px; } }
      `}</style>

      <section className="card hero" aria-label="Result">
        {countdown && <div className="clock"><span className="dotmark" style={{ background: "var(--sodium)" }} />next bell in <span className="mono" style={{ color: "var(--moon)" }}>{countdown}</span>{next?.label ? ` · ${next.label}` : ""}</div>}
        <div className="label">Typical swing in your portfolio at the bell</div>
        <div className="dot big">{money(tot.typical)}</div>
        <p className="sub">{totalUsd > 0 ? `${((tot.typical / totalUsd) * 100).toFixed(2)}% of ${money(totalUsd)}. 80% of past reopens moved less than this.` : "Add a position to see the swing."}</p>
        <div style={{ marginTop: 16 }}><Curve centre={tot.expected} typical={Math.max(tot.typical, 0.01)} worst={tot.worst} /></div>
        <div className="trio">
          <div className="tile"><span>Bad case · 95%</span><b style={{ color: tot.worst < 0 ? "var(--sodium)" : "var(--moon)" }}>{signed(tot.worst)}</b><span>{tot.worst < 0 ? "5% chance it is worse than this" : "even the bad case is a gain right now"}</span></div>
          <div className="tile"><span>Pool says it opens</span><b style={{ color: "var(--dawn)" }}>{signed(tot.expected)}</b><span>DEX price vs the frozen oracle</span></div>
          <div className="tile"><span>Total exposure</span><b>{money(totalUsd)}</b><span>{rows.length} position{rows.length === 1 ? "" : "s"}</span></div>
        </div>
      </section>

      {rows.map((r) => {
        const q = by.get(r.symbol);
        const c = calc[rows.indexOf(r)];
        const pct = r.usd > 0 ? Math.min(100, (Math.max(0, -c.worst) / r.usd) * 100 * 12) : 0;
        return (
          <section key={r.id} className="card holding" aria-label={`${r.symbol} position`}>
            <div className="tick" aria-hidden>{r.symbol.replace(/c$/, "").slice(0, 4)}</div>
            <div className="controls">
              <select aria-label="Stock" value={r.symbol} onChange={(e) => upd(r.id, { symbol: e.target.value })}>
                {usable.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol} · {x.name}</option>)}
              </select>
              <input aria-label="Position size in USD" type="number" inputMode="decimal" min={0} step={100} value={r.usd} onChange={(e) => upd(r.id, { usd: Math.max(0, Number(e.target.value) || 0) })} className="mono" />
              {PRESETS.map((p) => <button key={p} type="button" className="chip preset" aria-pressed={r.usd === p} onClick={() => upd(r.id, { usd: p })}>{p >= 1000 ? `${p / 1000}k` : p}</button>)}
              {rows.length > 1 && <button type="button" className="chip" aria-label={`Remove ${r.symbol}`} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>remove</button>}
            </div>
            <input type="range" aria-label="Position size slider" min={0} max={100000} step={500} value={Math.min(r.usd, 100000)} onChange={(e) => upd(r.id, { usd: Number(e.target.value) })} />
            <div className="meter" aria-hidden><i style={{ left: 0, width: `${Math.min(100, pct)}%`, background: "linear-gradient(90deg, var(--dawn), var(--sodium))" }} /></div>
            <div className="row-note">
              <span>{q?.price ? `Oracle ${money(q.price, 2)}` : "Oracle price unavailable"}</span>
              <span className="mono">typical ±{money(c.typical)} · bad case {signed(c.worst)}</span>
            </div>
          </section>
        );
      })}

      {unused.length > 0 && (
        <div><button type="button" className="chip" style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setRows((rs) => [...rs, { id: Date.now(), symbol: unused[0].symbol, usd: 5000 }])}>+ add another stock</button></div>
      )}

      <p className="haze" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
        Ranges come from bell&apos;s fitted Laplace model, calibrated on the pool price 30 s before the bell, so treat them as a guide, not a guarantee. Positions add up as if the stocks moved together, which is the cautious view. Descriptive estimates, not investment advice. Your inputs stay in this browser.
      </p>
    </div>
  );
}
