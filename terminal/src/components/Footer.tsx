import Link from "next/link";
import { Countdown } from "./Live";
import { Sky } from "./Sky";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Terminal", href: "/terminal" },
      { label: "Tokens", href: "/terminal/NVDAc" },
      { label: "Auctions", href: "/terminal/auctions" },
      { label: "Ledger", href: "/terminal/ledger" },
    ],
  },
  {
    title: "Research",
    links: [
      { label: "Findings", href: "/terminal/research" },
      { label: "Calibration", href: "/terminal/ledger" },
      { label: "Auction economics", href: "/terminal/auctions" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "MCP server", href: "/terminal/agents" },
      { label: "CLI", href: "/terminal/agents" },
      { label: "HTTP API", href: "/api/v1/tools" },
    ],
  },
  {
    title: "Built on",
    links: [
      { label: "Base", href: "https://base.org", external: true },
      { label: "Chainlink data feeds", href: "https://docs.chain.link/data-feeds", external: true },
      { label: "Aerodrome", href: "https://aerodrome.finance", external: true },
      { label: "Uniswap v4 hooks", href: "https://docs.uniswap.org/contracts/v4/overview", external: true },
    ],
  },
];

export function Footer({ nextBell }: { nextBell: { at: string; label: string } | null }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link href="/" className="footer-mark" aria-label="bell home">bell</Link>
          <p>
            The oracle for when the oracle is closed.
            <br />
            <span className="two">It rings when Wall Street wakes up.</span>
          </p>
        </div>

        <nav className="footer-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2>{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer">{l.label} <span aria-hidden="true">↗</span></a>
                    ) : (
                      <Link href={l.href}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="footer-base">
          <span>© 2026 bell</span>
          {nextBell && (
            <span className="chip">
              <span className="dotmark live" style={{ background: "var(--sodium)" }} />
              next bell: {nextBell.label.toLowerCase()} in <Countdown to={nextBell.at} />
            </span>
          )}
          <a href="#top" className="footer-top">Back to top <span aria-hidden="true">↑</span></a>
        </div>
        <p className="footer-fine">
          Research prototype. Read-only analytics: bell never trades or holds funds. Not an offer of any security and not investment advice.
          Tokenized stocks are not available to US persons. Data: Chainlink feeds on Base, Aerodrome pools via DexScreener, Coinbase Tokenized
          Stocks API. Base, Chainlink, Aerodrome and Uniswap belong to their makers; bell is independent.
        </p>
      </div>
      <div className="footer-word" aria-hidden="true">
        <Sky kind="word" text="bell" />
      </div>
    </footer>
  );
}
