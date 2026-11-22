"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type ChartPoint = { t: number; p: number };
export type ChartWindow = { from: number; to: number; weekly: boolean; jumpPct: number; post: number };

const RANGES = [
  { k: "7D", d: 7 },
  { k: "30D", d: 30 },
  { k: "90D", d: 90 },
  { k: "All", d: 0 },
];
const W = 800, H = 320, PL = 6, PR = 70, PT = 18, PB = 26;
const NY = "America/New_York";
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" });
const px = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sgn = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

/** Feed price history with dark windows, reopen-jump markers, a crosshair and trader stats. */
export function PriceChart({ points, windows, dex, now, symbol }: { points: ChartPoint[]; windows: ChartWindow[]; dex: number | null; now: number; symbol: string }) {
  const [range, setRange] = useState("30D");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const d = useMemo(() => {
    if (points.length < 2) return null;
    const lastT = points[points.length - 1].t;
    const days = RANGES.find((r) => r.k === range)!.d;
    const t0 = days ? Math.max(points[0].t, lastT - days * 86400) : points[0].t;
    const t1 = Math.max(now, lastT);
    const prev = [...points].reverse().find((p) => p.t < t0);
    const series = [...(prev ? [{ t: t0, p: prev.p }] : []), ...points.filter((p) => p.t >= t0)];
    const prices = series.map((s) => s.p).concat(dex != null ? [dex] : []);
    const rawLo = Math.min(...prices), rawHi = Math.max(...prices);
    const pad = (rawHi - rawLo) * 0.1 || rawHi * 0.01;
    const lo = rawLo - pad, hi = rawHi + pad;
    const X = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
    const Y = (p: number) => PT + (1 - (p - lo) / (hi - lo)) * (H - PT - PB);

    let line = `M${X(series[0].t).toFixed(1)} ${Y(series[0].p).toFixed(1)}`;
    for (let i = 1; i < series.length; i++) line += ` H${X(series[i].t).toFixed(1)} V${Y(series[i].p).toFixed(1)}`;
    const lastX = X(series[series.length - 1].t);
    const area = `${line} H${lastX.toFixed(1)} V${H - PB} H${X(series[0].t).toFixed(1)} Z`;
    const frozen = { x1: lastX, x2: X(t1), y: Y(series[series.length - 1].p) };

    const wins = windows.filter((w) => w.to >= t0 && w.from <= t1);
    const shades = wins.map((w) => ({ x: X(Math.max(w.from, t0)), w: Math.max(1, X(Math.min(w.to, t1)) - X(Math.max(w.from, t0))), weekly: w.weekly }));
    const markers = wins.filter((w) => w.weekly && w.to >= t0).map((w) => ({ x: X(w.to), y: Y(w.post), j: w.jumpPct, t: w.to }));
    // still dark now: the feed's last value is held until the next reopen
    if (now - lastT > 6 * 3600) shades.push({ x: lastX, w: Math.max(1, X(t1) - lastX), weekly: true });

    const yTicks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * (k + 0.5)) / 5);
    const xTicks = [0, 1, 2, 3, 4].map((k) => t0 + ((t1 - t0) * k) / 4);

    const first = series[0].p, last = series[series.length - 1].p;
    const closes = new Map<string, number>();
    for (const s of series) closes.set(dayKey.format(new Date(s.t * 1000)), s.p);
    const c = [...closes.values()];
    const rets = c.slice(1).map((v, i) => Math.log(v / c[i]));
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const vol = rets.length > 2 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100 : null;
    const wk = wins.filter((w) => w.weekly).map((w) => w.jumpPct);
    const avgJump = wk.length ? wk.reduce((a, b) => a + Math.abs(b), 0) / wk.length : null;
    const bigJump = wk.length ? wk.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : null;

    return {
      t0, t1, lo, hi, X, Y, series, line, area, frozen, shades, markers, yTicks, xTicks,
      stats: { last, change: (last / first - 1) * 100, high: Math.max(...series.map((s) => s.p)), low: Math.min(...series.map((s) => s.p)), vol, avgJump, bigJump, n: wk.length },
    };
  }, [points, windows, dex, now, range]);

  if (!d) return <p className="haze">No feed history yet. Run the research pipeline to fetch it.</p>;

  const pick = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((clientX - r.left) / r.width) * W;
    const t = d.t0 + ((x - PL) / (W - PL - PR)) * (d.t1 - d.t0);
    let lo = 0, hi = d.series.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d.series[m].t <= t) lo = m; else hi = m - 1; }
    setHover(lo);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.min(d.series.length - 1, Math.max(0, (h ?? d.series.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const h = hover != null ? d.series[hover] : null;
  const hx = h ? d.X(h.t) : 0, hy = h ? d.Y(h.p) : 0;
  const darkAtHover = h ? windows.some((w) => h.t >= w.from && h.t < w.to) : false;
  const drift = dex != null ? (dex / d.stats.last - 1) * 1e4 : null;
  // Axis tags for the last feed value and the DEX price must not overlap.
  let feedTagY = d.frozen.y;
  let dexTagY = dex != null ? d.Y(dex) : 0;
  if (dex != null && Math.abs(dexTagY - feedTagY) < 20) {
    const mid = (dexTagY + feedTagY) / 2;
    const up = dex >= d.stats.last;
    dexTagY = Math.max(PT + 9, Math.min(H - PB - 9, mid + (up ? -10 : 10)));
    feedTagY = Math.max(PT + 9, Math.min(H - PB - 9, mid + (up ? 10 : -10)));
  }

  const stats = [
    { k: "Last feed", v: px(d.stats.last) },
    { k: `${range} change`, v: `${sgn(d.stats.change)}%`, c: d.stats.change >= 0 ? "var(--dawn)" : "var(--sodium)" },
    { k: "High", v: px(d.stats.high) },
    { k: "Low", v: px(d.stats.low) },
    { k: "Realised vol", v: d.stats.vol == null ? "—" : `${d.stats.vol.toFixed(0)}%`, title: "annualised, from daily closes in range" },
    { k: "Avg reopen jump", v: d.stats.avgJump == null ? "—" : `${d.stats.avgJump.toFixed(2)}%`, title: `${d.stats.n} weekly reopens in range` },
    { k: "Largest reopen", v: d.stats.bigJump == null ? "—" : `${sgn(d.stats.bigJump)}%`, c: "var(--sodium)" },
    { k: "DEX drift now", v: drift == null ? "—" : `${sgn(drift, 0)} bp`, c: drift != null && Math.abs(drift) > 50 ? "var(--sodium)" : undefined },
  ];

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h2 className="label">{symbol} · Chainlink feed history</h2>
        <div role="group" aria-label="Range" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 999, border: "1px solid var(--hair-2)" }}>
          {RANGES.map((r) => (
            <button key={r.k} type="button" aria-pressed={range === r.k} onClick={() => { setRange(r.k); setHover(null); }} className="seg">{r.k}</button>
          ))}
        </div>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: "10px 16px", margin: "0 0 16px" }}>
        {stats.map((s) => (
          <div key={s.k} title={s.title}>
            <dt className="haze" style={{ fontSize: 11.5 }}>{s.k}</dt>
            <dd className="mono" style={{ margin: "3px 0 0", fontSize: 14, color: s.c }}>{s.v}</dd>
          </div>
        ))}
      </dl>

      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`${symbol} feed price, ${range}: last ${px(d.stats.last)}, change ${sgn(d.stats.change)}%. Use left and right arrows to inspect points.`}
          onPointerMove={(e: PointerEvent) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          style={{ width: "100%", height: "auto", display: "block", touchAction: "pan-y", cursor: "crosshair" }}
        >
          {d.yTicks.map((p) => <line key={p} x1={PL} x2={W - PR} y1={d.Y(p)} y2={d.Y(p)} stroke="#121826" />)}
          {d.shades.map((s, i) => <rect key={i} x={s.x} y={PT} width={s.w} height={H - PT - PB} fill={s.weekly ? "#78B4FF" : "#8C94A7"} fillOpacity={s.weekly ? 0.09 : 0.04} />)}
          <path d={d.area} fill="#ECEEF2" fillOpacity={0.035} />
          <path d={d.line} fill="none" stroke="#ECEEF2" strokeWidth={1.6} className="draw" pathLength={1} />
          <line x1={d.frozen.x1} x2={d.frozen.x2} y1={d.frozen.y} y2={d.frozen.y} stroke="#ECEEF2" strokeOpacity={0.5} strokeDasharray="2 4" />
          {dex != null && (
            <line x1={PL} x2={W - PR} y1={d.Y(dex)} y2={d.Y(dex)} stroke="#FF9E4A" strokeOpacity={0.8} strokeDasharray="5 5" />
          )}
          {d.markers.map((m) => (
            <g key={m.t}>
              <circle cx={m.x} cy={m.y} r={3.6} fill="#05070B" stroke={Math.abs(m.j) >= 1 ? "#FF9E4A" : "#78B4FF"} strokeWidth={1.5} />
              {(range !== "All" || Math.abs(m.j) >= 1) && (
                <text x={m.x} y={m.y - 9} textAnchor="middle" fontSize={9.5} fontFamily="var(--font-geist-mono)" fill={Math.abs(m.j) >= 1 ? "#FF9E4A" : "#8C94A7"}>{sgn(m.j)}%</text>
              )}
            </g>
          ))}
          {d.yTicks.map((p) => (
            <text key={p} x={W - PR + 8} y={d.Y(p) + 3.5} fontSize={10} fontFamily="var(--font-geist-mono)" fill="#6E7891">{px(p)}</text>
          ))}
          <g>
            <rect x={W - PR + 2} y={feedTagY - 9} width={PR - 4} height={18} rx={3} fill="#ECEEF2" />
            <text x={W - PR + 8} y={feedTagY + 4} fontSize={10.5} fontFamily="var(--font-geist-mono)" fill="#05070B">{px(d.stats.last)}</text>
          </g>
          {dex != null && (
            <g>
              <rect x={W - PR + 2} y={dexTagY - 9} width={PR - 4} height={18} rx={3} fill="#FF9E4A" />
              <text x={W - PR + 8} y={dexTagY + 4} fontSize={10.5} fontFamily="var(--font-geist-mono)" fill="#05070B">{px(dex)}</text>
            </g>
          )}
          {d.xTicks.map((t, i) => (
            <text key={t} x={i === 0 ? PL : i === 4 ? W - PR : d.X(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize={10} fontFamily="var(--font-geist-mono)" fill="#6E7891">{dateFmt.format(new Date(t * 1000))}</text>
          ))}
          {h && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={PT} y2={H - PB} stroke="#ECEEF2" strokeOpacity={0.35} />
              <line x1={PL} x2={W - PR} y1={hy} y2={hy} stroke="#ECEEF2" strokeOpacity={0.2} />
              <circle cx={hx} cy={hy} r={4} fill="#ECEEF2" />
            </g>
          )}
        </svg>
        {h && (
          <div className="tip" style={{ left: `${(hx / W) * 100}%`, top: `${(hy / H) * 100}%` }} role="status">
            <div className="mono" style={{ fontSize: 11, color: "var(--haze)" }}>{timeFmt.format(new Date(h.t * 1000))} ET</div>
            <div className="mono" style={{ fontSize: 15 }}>{px(h.p)}</div>
            <div className="mono" style={{ fontSize: 11, color: h.p >= d.series[0].p ? "var(--dawn)" : "var(--sodium)" }}>{sgn((h.p / d.series[0].p - 1) * 100)}% in range</div>
            {darkAtHover && <div style={{ fontSize: 11, color: "var(--night-text)" }}>feed dark · market closed</div>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 12, fontSize: 12 }} className="haze">
        <span><span className="key" style={{ background: "var(--moon)" }} />Chainlink feed</span>
        <span><span className="key dashed" style={{ borderColor: "var(--sodium)" }} />DEX price now</span>
        <span><span className="key" style={{ background: "rgba(120,180,255,.35)", height: 10 }} />weekend dark window</span>
        <span><span className="key ring" />weekly reopen jump</span>
      </div>
    </div>
  );
}
