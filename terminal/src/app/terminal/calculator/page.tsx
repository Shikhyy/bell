import { quotes } from "@/lib/signals";
import Calc, { type CalcQuote } from "./Calc";

export const revalidate = 30;
export const metadata = { title: "Gap-risk calculator — bell" };

export default async function Calculator() {
  const qs = await quotes();
  const data: CalcQuote[] = qs.map((q) => ({
    symbol: q.symbol,
    name: q.name,
    band80Bp: q.nextOracleUpdate?.band80Bp ?? null,
    expectedMoveBp: q.nextOracleUpdate?.expectedMoveBp ?? null,
    label: q.nextOracleUpdate?.label ?? null,
    at: q.nextOracleUpdate?.at ?? null,
  }));
  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
        <span className="label">For holders and LPs</span>
        <h1 className="headline" style={{ fontSize: "clamp(34px, 5vw, 48px)" }}>What does the<br /><span className="two">next bell cost you?</span></h1>
        <p className="haze" style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>
          Enter what you hold in tokenized stocks on Base. bell shows how far the oracle price typically jumps when it wakes, and how bad it gets in the tail.
        </p>
      </header>
      <Calc quotes={data} />
    </>
  );
}
