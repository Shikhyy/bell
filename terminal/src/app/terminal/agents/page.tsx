import { Reveal } from "@/components/Motion";
import { TOOLS, quotes } from "@/lib/signals";

export const revalidate = 60;
export const metadata = { title: "Agents — bell" };

const MCP_CONFIG = `{
  "mcpServers": {
    "bell": {
      "command": "npx",
      "args": ["tsx", "/path/to/bell/cli/src/bell.ts", "mcp"]
    }
  }
}`;

const CLI = `pnpm --dir cli bell quotes
pnpm --dir cli bell quote NVDAc --json
pnpm --dir cli bell risk MSTRc --confidence 0.99
pnpm --dir cli bell pretrade NVDAc --side buy --size 25000
pnpm --dir cli bell liquidations positions.json`;

const USES = [
  { who: "Trading agents", what: "Know the fair price while the oracle is frozen, when the next jump lands, and how big it is likely to be." },
  { who: "Lending protocols", what: "Haircut tokenized-stock collateral through the dark hours instead of trusting a 40-hour-old price." },
  { who: "Liquidators and risk bots", what: "Rank positions by the probability the next scheduled print liquidates them, before it happens." },
  { who: "LPs and vaults", what: "Widen ranges or pull liquidity ahead of bells where the DEX and the oracle disagree most." },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="mono" style={{ margin: 0, padding: "14px 16px", borderRadius: 10, background: "#06080E", border: "1px solid var(--hair-2)", fontSize: 12.5, lineHeight: 1.6, overflowX: "auto", color: "#C7CCD8" }}>
      <code>{children}</code>
    </pre>
  );
}

export default async function Agents() {
  let sample: unknown = null;
  try {
    const q = await quotes();
    sample = q.slice(0, 1).map((x) => ({ symbol: x.symbol, oracle: { price: x.oracle.price, frozen: x.oracle.frozen }, dex: { price: x.dex.price }, fairValue: x.fairValue, nextOracleUpdate: x.nextOracleUpdate }))[0];
  } catch {
    sample = { error: "live data unavailable right now" };
  }

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
        <span className="label">For people and AI agents</span>
        <h1 className="headline" style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>The oracle for when<br /><span className="two">the oracle is closed.</span></h1>
        <p className="haze" style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>
          For about 52 hours every weekend, and every night, the Chainlink feeds behind tokenized stocks on Base stand still while the tokens keep
          trading. bell gives agents what they need in that gap: fair value with calibrated bands, when the oracle will move and by how much, and
          who gets liquidated when it does. Same core in the terminal, an MCP server, a CLI and an HTTP API.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {USES.map((u, i) => (
          <Reveal key={u.who} delay={i * 60} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{u.who}</span>
            <span className="haze" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{u.what}</span>
          </Reveal>
        ))}
      </div>

      <div className="row">
        <Reveal className="card" style={{ flex: "1 1 420px", minWidth: 0, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="label">MCP server · Claude, agent frameworks, any MCP client</h2>
          <Code>{MCP_CONFIG}</Code>
          <p className="haze" style={{ margin: 0, fontSize: 13 }}>Eight tools: bell_session, bell_quotes, bell_quote, bell_risk, bell_pretrade, bell_liquidations, bell_history, bell_calibration.</p>
        </Reveal>
        <Reveal delay={60} className="card" style={{ flex: "1 1 420px", minWidth: 0, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="label">CLI · scripts and agent loops (add --json)</h2>
          <Code>{CLI}</Code>
        </Reveal>
      </div>

      <Reveal className="card" style={{ padding: "18px 8px 8px" }}>
        <h2 className="label" style={{ padding: "0 12px 14px" }}>HTTP API · GET /api/v1/&lt;tool&gt; (POST for liquidations)</h2>
        <div className="scroll">
          <table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th scope="col">Tool</th><th scope="col" style={{ textAlign: "left" }}>Arguments</th><th scope="col" style={{ textAlign: "left" }}>Returns</th></tr></thead>
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.name}>
                  <td><a href={`/api/v1/${t.name}${t.args.startsWith("symbol") ? "?symbol=NVDAc" : ""}`}>{t.name}</a></td>
                  <td className="haze" style={{ textAlign: "left" }}>{t.args || "—"}</td>
                  <td style={{ textAlign: "left", fontFamily: "var(--font-geist)", whiteSpace: "normal" }}>{t.about}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="label">Live response · bell_quotes, first row</h2>
        <Code>{JSON.stringify(sample, null, 2)}</Code>
      </Reveal>

      <p className="haze" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
        Guardrails: bell is read-only. It returns data and calibrated estimates and never signs or sends a transaction; agents act with their own
        wallets and policies. Outputs are descriptive, not investment advice. Tokenized stocks are not available to US persons.
      </p>
    </>
  );
}
