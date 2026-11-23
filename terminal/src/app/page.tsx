import Link from "next/link";
import { ClockChip } from "@/components/Live";
import { Reveal, Scramble } from "@/components/Motion";
import { Footer } from "@/components/Footer";
import { Showcase, type ShowcaseData } from "@/components/Showcase";
import { Sky } from "@/components/Sky";
import { calibration, liquidations, quotes, session } from "@/lib/signals";

export const revalidate = 60;

/** Live data for the landing-page demo. Example loans are placed around tonight's expected print. */
async function demoData(): Promise<ShowcaseData | null> {
  try {
    const [qs, cal] = await Promise.all([quotes(), calibration()]);
    const bell = session().nextBell;
    if (!bell) return null;
    const live = qs.filter((q) => q.oracle.price && q.dex.price && q.nextOracleUpdate?.expectedMoveBp != null);
    const rows = live
      .map((q) => ({ symbol: q.symbol, oracle: q.oracle.price!, dex: q.dex.price!, moveBp: q.nextOracleUpdate!.expectedMoveBp!, bandBp: q.nextOracleUpdate!.band80Bp ?? 0 }))
      .sort((a, b) => Math.abs(b.moveBp) - Math.abs(a.moveBp));
    const fq = live.find((q) => q.symbol === "NVDAc") ?? live[0];
    if (!fq || !fq.fairValue.band80 || !fq.fairValue.band95) return null;
    const loan = (id: string, sym: string, offsetPct: number) => {
      const q = live.find((x) => x.symbol === sym) ?? fq;
      const liq = q.dex.price! * (1 + offsetPct / 100);
      return { id, symbol: q.symbol, collateralTokens: 100, debtUsd: liq * 100 * 0.8, liquidationThreshold: 0.8 };
    };
    const liq = await liquidations([loan("a", "AAPLc", -2), loan("b", "NVDAc", -0.2), loan("c", "MSTRc", 0.3)]);
    const loans = liq.positions.flatMap((p) =>
      "probLiquidatedAtNextPrint" in p && p.probLiquidatedAtNextPrint != null
        ? [{ id: p.id, symbol: p.symbol, hf: p.healthFactorNow ?? 0, liqPrice: p.liquidationPrice ?? 0, oracle: p.oraclePrice, prob: p.probLiquidatedAtNextPrint }]
        : [],
    ).sort((a, b) => a.prob - b.prob);
    return {
      bell: { label: bell.label, at: bell.at, when: bell.when },
      rows,
      focus: {
        symbol: fq.symbol, name: fq.name, oracle: fq.oracle.price!, dex: fq.dex.price!, ageH: (fq.oracle.ageSeconds ?? 0) / 3600,
        lo80: fq.fairValue.band80[0]!, hi80: fq.fairValue.band80[1]!, lo95: fq.fairValue.band95[0]!, hi95: fq.fairValue.band95[1]!,
        moveBp: fq.nextOracleUpdate?.expectedMoveBp ?? 0, bandBp: fq.nextOracleUpdate?.band80Bp ?? 0,
      },
      loans,
      model: { skill: cal.overall.crpsSkill ?? 0, events: cal.overall.events, maeDex: cal.overall.dexMaeBp ?? 0, maeFrozen: cal.overall.frozenOracleMaeBp ?? 0 },
    };
  } catch (e) {
    console.error("[landing] demo data unavailable:", (e as Error).message);
    return null;
  }
}

const FACTS = [
  { value: "−169%", color: "var(--sodium)", text: "Yearly return for LPs in Aero Slipstream stock pools on Base, before rewards.", src: "Bitquery · 14 Oct – 10 Nov 2026" },
  { value: "10/415", color: "var(--moon)", text: "Coinbase tokenized stocks on Base with an onchain price feed. Those feeds go silent when the market closes.", src: "Coinbase Tokenized Stocks API · 22 Nov 2026" },
  { value: "20:00", color: "var(--dawn)", text: "Sunday, New York time: the feeds wake up inside that minute on 108 of 117 weekly reopens, typically 35 seconds after the bell.", src: "bell research · every feed round since Aug 2026" },
];


const GROUPS = [
  { name: "Terminal", items: ["168-hour week clock", "Live feed and DEX drift", "Dark variance per token", "Scheduled jumps ahead"] },
  { name: "Hook", items: ["Uniswap v4 on Base", "Feed-driven bell trigger", "Priority-fee auction", "Low fees in the dark"] },
  { name: "Research", items: ["Every feed round since August", "Reopen timing, to the second", "LP loss at each bell", "Open data and code"] },
];

export default async function Landing() {
  const demo = await demoData();
  const nextBell = session().nextBell;
  return (
    <div id="top" style={{ background: "var(--ground)" }}>
      <section aria-label="bell" style={{ position: "relative", minHeight: 860, height: "100vh", overflow: "hidden", background: "#070A1A" }}>
        <Sky kind="night" />
        <nav aria-label="Site" style={{ position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)", width: "min(980px, calc(100% - 32px))", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22, padding: "8px 8px 8px 22px", borderRadius: 999, background: "rgba(7,10,26,0.72)", border: "1px solid rgba(255,255,255,0.08)", zIndex: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.05em" }}>bell</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginLeft: "auto", fontSize: 14 }}>
            <a href="#how" style={{ color: "#C7CCD8" }}>How it works</a>
            <a href="#research" style={{ color: "#C7CCD8" }}>Research</a>
          </div>
          <Link className="pill" href="/terminal" style={{ minHeight: 36, padding: "0 16px", fontSize: 14 }}>Terminal</Link>
        </nav>
        <div style={{ position: "relative", zIndex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 24px", gap: 26 }}>
          <h1 aria-label="bell" style={{ margin: 0, fontSize: "clamp(104px, 15vw, 196px)", lineHeight: 0.9, fontWeight: 600, letterSpacing: "-0.065em" }}>
            {"bell".split("").map((ch, i) => (
              <span key={i} aria-hidden="true" className="rise" style={{ display: "inline-block", animationDelay: `${0.04 + i * 0.05}s` }}>{ch}</span>
            ))}
          </h1>
          <p className="rise" style={{ margin: 0, fontSize: 25, lineHeight: 1.2, fontWeight: 500, letterSpacing: "-0.03em", animationDelay: ".22s" }}>
            An opening auction for onchain stocks.<br />
            <span style={{ color: "var(--night-text)" }}>It rings when Wall Street wakes up.</span>
          </p>
          <Link className="pill rise" href="/terminal" style={{ marginTop: 6, animationDelay: ".3s" }}>Open the terminal</Link>
          <span className="mono rise" style={{ fontSize: 12, color: "var(--night-text)", animationDelay: ".38s" }}>Research preview · reads live from Base</span>
        </div>
        <div style={{ position: "absolute", left: 24, bottom: 24, zIndex: 1 }}><ClockChip /></div>
      </section>

      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "150px 32px 120px", textAlign: "center" }}>
        <Reveal>
          <h2 className="headline" style={{ fontSize: "clamp(44px, 6vw, 76px)" }}>The market closes.<br /><span className="two">Your pool doesn’t.</span></h2>
          <p style={{ margin: "30px auto 0", maxWidth: 600, fontSize: 18, lineHeight: 1.55, color: "#9AA3B8" }}>
            Tokenized stocks on Base trade all weekend. The prices they track only move when the US market opens. Every reopen, someone has to absorb the jump.
          </p>
        </Reveal>
        <div style={{ marginTop: 96, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", borderTop: "1px solid var(--hair)" }}>
          {FACTS.map((f, i) => (
            <Reveal key={f.value} delay={i * 70} style={{ padding: "44px 24px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <Scramble text={f.value} className="dot" style={{ fontSize: 76, lineHeight: 1, color: f.color }} duration={600} />
              <span style={{ fontSize: 16, lineHeight: 1.5, maxWidth: 300 }}>{f.text}</span>
              <span className="mono" style={{ fontSize: 11.5, color: "#6E7891" }}>{f.src}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="how" style={{ position: "relative", minHeight: 980, overflow: "hidden", background: "#070A1A" }}>
        <Sky kind="dawn" />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1160, margin: "0 auto", padding: "130px 32px 110px", display: "flex", flexDirection: "column", gap: 72 }}>
          <Reveal style={{ textAlign: "center" }}>
            <h2 className="headline" style={{ fontSize: "clamp(44px, 6vw, 76px)" }}>Stocks jump at 20:00.<br /><span style={{ color: "#8E9CCB" }}>We know that in advance.</span></h2>
            <p style={{ margin: "28px auto 0", maxWidth: 560, fontSize: 18, lineHeight: 1.55, color: "#C2C9DA" }}>
              Crypto jumps whenever it likes. Equities jump on a timetable. bell is built around that timetable, for people and for their agents.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <Showcase data={demo} />
          </Reveal>
        </div>
      </section>

      <section id="research" style={{ maxWidth: 1160, margin: "0 auto", padding: "150px 32px 120px", display: "flex", flexWrap: "wrap", gap: 56, alignItems: "center" }}>
        <Reveal style={{ flex: "1 1 420px", minWidth: 0 }}>
          <h2 className="headline" style={{ fontSize: "clamp(40px, 5vw, 60px)" }}>A loss floor<br /><span className="two">that isn’t one.</span></h2>
          <p style={{ margin: "26px 0 0", maxWidth: 480, fontSize: 17, lineHeight: 1.6, color: "#9AA3B8" }}>
            Recent theory says price jumps put a floor under LP losses that faster blocks can’t remove. That holds when jumps arrive at random. When the jump time is on a calendar, it can be auctioned.
          </p>
        </Reveal>
        <Reveal delay={90} style={{ flex: "1 1 480px", minWidth: 0 }}>
        <figure className="card" style={{ margin: 0, padding: 34, borderRadius: 20 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--dawn)" }}>Proposition 1</span>
          <p style={{ margin: "16px 0 0", fontFamily: "Georgia, serif", fontSize: 22, lineHeight: 1.5, color: "#E4E7EE" }}>
            If a jump of size <i>J</i> arrives at a time <i>t</i>* known in advance, and two or more arbitrageurs compete for it, a priority-taxed auction at <i>t</i>* returns all but ε of the loss <i>V</i>·𝔼[(<i>J</i>² − γ²)⁺]/8 to LPs.
          </p>
          <figcaption className="mono" style={{ marginTop: 22, fontSize: 11.5, color: "#6E7891" }}>Builds on Milionis et al. · Bundi 2026 · Robinson &amp; White</figcaption>
        </figure>
        </Reveal>
      </section>

      <section style={{ borderTop: "1px solid var(--hair)" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "120px 32px 100px" }}>
          <h2 className="headline" style={{ fontSize: "clamp(40px, 5vw, 60px)", marginBottom: 64 }}>Everything bell does.<br /><span className="two">In one place.</span></h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "48px 40px" }}>
            {GROUPS.map((g, gi) => (
              <Reveal key={g.name} delay={gi * 60}>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 14, borderBottom: "1px solid var(--hair-2)" }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>{g.name}</h3>
                  <span className="mono" style={{ fontSize: 12, color: "#6E7891" }}>{g.items.length}</span>
                </div>
                <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {g.items.map((it) => <li key={it} style={{ fontSize: 14.5, color: "#9AA3B8" }}>{it}</li>)}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section style={{ position: "relative", height: 620, overflow: "hidden" }}>
        <Sky kind="end" />
        <div style={{ position: "relative", zIndex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, textAlign: "center", padding: "0 24px" }}>
          <h2 className="headline" style={{ fontSize: "clamp(48px, 7vw, 84px)", letterSpacing: "-0.06em" }}>Hear the bell<br /><span style={{ color: "#8E9CCB" }}>before it rings.</span></h2>
          <Link className="pill" href="/terminal">Open the terminal</Link>
        </div>
      </section>

      <Footer nextBell={nextBell ? { at: nextBell.at, label: nextBell.label } : null} />
    </div>
  );
}
