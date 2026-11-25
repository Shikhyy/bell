"use client";

import { useEffect, useRef, useState } from "react";
import { Countdown } from "./Live";

export type ShowcaseData = {
  bell: { label: string; at: string; when: string };
  rows: { symbol: string; oracle: number; dex: number; moveBp: number; bandBp: number }[];
  focus: { symbol: string; name: string; oracle: number; dex: number; ageH: number; lo80: number; hi80: number; lo95: number; hi95: number; moveBp: number; bandBp: number };
  loans: { id: string; symbol: string; hf: number; liqPrice: number; oracle: number; prob: number }[];
  model: { skill: number; events: number; maeDex: number; maeFrozen: number };
};

const TABS = [
  { title: "Ask your agent", body: "Claude or any MCP client calls bell and answers from live Base data." },
  { title: "Forecast the bell", body: "Fair value while the oracle is frozen, with bands scored on every past reopen." },
  { title: "Price the liquidations", body: "The chance each loan is liquidated by the next scheduled oracle print." },
  { title: "Auction the reopen", body: "BellHook rings onchain and sells the first rebalance, so LPs keep the gap." },
];
const DURATION = 7000;
const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sbp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(0)}bp`;

/** Milliseconds since mount, updated every animation frame (60/120 fps) until `max`. */
function useElapsed(max = 9000) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setT(max); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const e = now - t0;
      setT(Math.min(e, max));
      if (e < max) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [max]);
  return t;
}

const typed = (text: string, t: number, start: number, msPerChar = 24) => text.slice(0, Math.max(0, Math.floor((t - start) / msPerChar)));

function AskPanel({ d }: { d: ShowcaseData }) {
  const t = useElapsed();
  const q = "Which stocks will their oracle move most at tonight's bell?";
  const qDone = q.length * 24 + 200;
  const rows = d.rows.slice(0, 5);
  const shown = Math.max(0, Math.min(rows.length, Math.floor((t - qDone - 700) / 140)));
  const up = d.rows.filter((r) => r.moveBp > 0).length;
  const top = rows[0];
  const answer = top ? `${top.symbol} leads: the oracle should print about ${f2(top.dex)} at ${d.bell.when} (${sbp(top.moveBp)} ±${top.bandBp.toFixed(0)}bp). ${up} of ${d.rows.length} stocks sit above their frozen oracle.` : "";
  const aStart = qDone + 700 + rows.length * 140 + 300;
  return (
    <div className="pane">
      <div className="msg user"><span className="who">you</span>{typed(q, t, 0)}{t < qDone && <span className="caret" />}</div>
      {t > qDone && (
        <div className="tool">
          <span className={t < qDone + 700 ? "spin" : "okdot"} />
          <span className="mono">bell_quotes</span>
          <span className="haze mono">{t < qDone + 700 ? "running…" : `10 results · live from Base`}</span>
        </div>
      )}
      {shown > 0 && (
        <div className="rows">
          {rows.slice(0, shown).map((r) => (
            <div key={r.symbol} className="rowin mono">
              <span>{r.symbol}</span>
              <span className="haze">{f2(r.oracle)} → {f2(r.dex)}</span>
              <span style={{ color: r.moveBp >= 0 ? "var(--sodium)" : "var(--dawn)" }}>{sbp(r.moveBp)}</span>
              <span className="haze">±{r.bandBp.toFixed(0)}bp</span>
            </div>
          ))}
        </div>
      )}
      {t > aStart && <div className="msg agent"><span className="who">agent</span>{typed(answer, t, aStart, 12)}</div>}
    </div>
  );
}

function ForecastPanel({ d }: { d: ShowcaseData }) {
  const t = useElapsed(2500);
  const k = Math.min(1, t / 1100);
  const e = 1 - Math.pow(1 - k, 3);
  const f = d.focus;
  const lo = Math.min(f.oracle, f.lo95) * 0.997, hi = Math.max(f.oracle, f.hi95) * 1.003;
  const x = (p: number) => ((p - lo) / (hi - lo)) * 100;
  const mid = x(f.dex);
  return (
    <div className="pane">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="mono haze" style={{ fontSize: 12 }}>{f.symbol} · {f.name}</div>
          <div style={{ fontSize: 15, marginTop: 4 }}>Oracle frozen for <span className="sodium">{f.ageH.toFixed(0)}h</span>. Next print: {d.bell.label}, <Countdown to={d.bell.at} /></div>
        </div>
        <span className="chip" style={{ color: "var(--dawn)" }}>{(d.model.skill * 100).toFixed(0)}% better than the frozen oracle · {d.model.events} reopens · price 30 s before the bell</span>
      </div>
      <div className="axis">
        <div className="band95" style={{ left: `${mid - (mid - x(f.lo95)) * e}%`, width: `${(x(f.hi95) - x(f.lo95)) * e}%` }} />
        <div className="band80" style={{ left: `${mid - (mid - x(f.lo80)) * e}%`, width: `${(x(f.hi80) - x(f.lo80)) * e}%` }} />
        <div className="mark frozen" style={{ left: `${x(f.oracle)}%` }}><span>frozen oracle<br /><b className="mono">{f2(f.oracle)}</b></span></div>
        <div className="mark fair" style={{ left: `${mid}%`, opacity: e }}><span>fair value<br /><b className="mono">{f2(f.dex)}</b></span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {[["Expected oracle move", sbp(f.moveBp)], ["80% band", `${f2(f.lo80)} – ${f2(f.hi80)}`], ["Typical miss", `${d.model.maeDex.toFixed(0)}bp vs ${d.model.maeFrozen.toFixed(0)}bp`]].map(([k2, v]) => (
          <div key={k2} className="cell"><div className="haze" style={{ fontSize: 11.5 }}>{k2}</div><div className="mono" style={{ fontSize: 15, marginTop: 4 }}>{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function RiskPanel({ d }: { d: ShowcaseData }) {
  const t = useElapsed(2500);
  return (
    <div className="pane">
      <div className="tool"><span className="okdot" /><span className="mono">bell_liquidations</span><span className="haze mono">{d.loans.length} example loans · priced against tonight&apos;s print</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {d.loans.map((l, i) => {
          const k = Math.min(1, Math.max(0, (t - i * 180) / 900));
          const e = 1 - Math.pow(1 - k, 3);
          const hot = l.prob >= 0.5;
          return (
            <div key={l.id} className="loan" style={{ opacity: Math.min(1, k * 2) }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span className="mono">{l.symbol} <span className="haze">· liquidates below {f2(l.liqPrice)}</span></span>
                <span className="mono haze">health {l.hf.toFixed(3)}</span>
              </div>
              <div className="pbar"><div style={{ width: `${l.prob * 100 * e}%`, background: hot ? "var(--sodium)" : "var(--dawn)" }} /></div>
              <div className="mono" style={{ fontSize: 12, color: hot ? "var(--sodium)" : "var(--haze)" }}>{(l.prob * 100 * e).toFixed(1)}% chance the next print liquidates it</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuctionPanel() {
  const t = useElapsed(7000);
  const phases = ["Dark", "Bell", "Auction", "Dawn"];
  const at = t < 1300 ? 0 : t < 2400 ? 1 : t < 5200 ? 2 : 3;
  const bids = [{ who: "0x7a…41c", g: 0.0038 }, { who: "0x19…e02", g: 0.0036 }, { who: "0xc3…9b7", g: 0.003 }];
  const shownBids = at >= 2 ? Math.min(3, Math.floor((t - 2400) / 500) + 1) : 0;
  const fee = shownBids ? Math.max(...bids.slice(0, shownBids).map((b) => b.g)) * 1e7 / 1e4 : 0;
  return (
    <div className="pane">
      <div className="phases">
        {phases.map((p, i) => (
          <div key={p} className={`phase${i === at ? " on" : ""}${i < at ? " done" : ""}`}><span className="pdot" />{p}</div>
        ))}
      </div>
      <div className="mono haze" style={{ fontSize: 12.5 }}>
        {["Feed silent 6h+ · fee 3bp · keeper posted reserve", "Feed updatedAt advanced · BellHook rings onchain", "Searchers bid priority fees · fee = priority × rate", "Pool repriced · LPs kept the gap · normal fee"][at]}
      </div>
      <div className="rows">
        {bids.slice(0, shownBids).map((b, i) => (
          <div key={b.who} className="rowin mono">
            <span>{b.who}</span><span className="haze">{(b.g * 1).toFixed(4)} gwei priority</span>
            <span style={{ color: i === 0 ? "var(--dawn)" : "var(--haze)" }}>{i === 0 ? "winning" : "outbid"}</span><span />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><div className="haze" style={{ fontSize: 11.5 }}>Swap fee now</div><div className="dot" style={{ fontSize: 34, color: at === 2 ? "var(--sodium)" : "var(--moon)" }}>{at === 2 ? `${fee.toFixed(1)}%` : at === 3 ? "0.05%" : "0.03%"}</div></div>
        <div><div className="haze" style={{ fontSize: 11.5 }}>Gap paid to LPs</div><div className="dot" style={{ fontSize: 34, color: "var(--dawn)" }}>{at === 3 ? "94%" : "—"}</div></div>
      </div>
      <div className="haze" style={{ fontSize: 11.5 }}>Simulated with BellHook&apos;s tested logic (3 competing searchers).</div>
    </div>
  );
}

export function Showcase({ data }: { data: ShowcaseData | null }) {
  const [tab, setTab] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  const [clock, setClock] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const elapsedRef = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || hover || !inView) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      elapsedRef.current += Math.min(100, now - last); // clamp so a backgrounded tab doesn't skip tabs
      last = now;
      if (elapsedRef.current >= DURATION) {
        elapsedRef.current = 0;
        setTab((x) => (x + 1) % TABS.length);
      }
      setElapsed(elapsedRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover, inView]);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const tick = () => setClock(`${fmt.format(new Date())} ET`);
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const pick = (i: number) => { elapsedRef.current = 0; setTab(i); setElapsed(0); };

  return (
    <div ref={ref} className="showcase" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="device" role="region" aria-label={`Demo: ${TABS[tab].title}`}>
        <div className="device-menu mono">
          <span style={{ color: "var(--moon)", fontWeight: 600, fontFamily: "var(--font-geist)" }}>bell</span>
          <span>Session</span><span>Tools</span><span>View</span>
          <span style={{ marginLeft: "auto" }}>{clock}</span>
        </div>
        <div className="device-body">
          <div className="device-head">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="dotmark live" style={{ background: "var(--dawn)" }} /> {TABS[tab].title}</span>
            <span className="mono" style={{ fontSize: 11.5, letterSpacing: ".08em", color: "var(--dawn)" }}>{data ? "LIVE · BASE MAINNET" : "OFFLINE"}</span>
          </div>
          {data ? (
            <div key={tab} className="pane-wrap">
              {tab === 0 && <AskPanel d={data} />}
              {tab === 1 && <ForecastPanel d={data} />}
              {tab === 2 && <RiskPanel d={data} />}
              {tab === 3 && <AuctionPanel />}
            </div>
          ) : (
            <p className="haze" style={{ padding: 24 }}>Live data is unavailable right now. Open the terminal to retry.</p>
          )}
        </div>
      </div>
      <div className="showtabs" role="tablist" aria-label="bell features">
        {TABS.map((t, i) => (
          <button key={t.title} role="tab" aria-selected={tab === i} className={`showtab${tab === i ? " on" : ""}`} onClick={() => pick(i)}>
            <span className="track"><span style={{ width: tab === i ? `${(elapsed / DURATION) * 100}%` : i < tab ? "100%" : "0%" }} /></span>
            <span className="st">{t.title}</span>
            <span className="sb">{t.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
