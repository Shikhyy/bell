"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Counts down to an ISO time; renders a placeholder until mounted to avoid hydration drift. */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const now = useNow();
  if (now === null) return <span className={className}>—</span>;
  let s = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${p(m)}m` : `${p(m)}:${p(sec)}`;
  return <span className={className}>{text}</span>;
}

/** "3h 12m ago" for a unix timestamp, ticking. */
export function Age({ ts }: { ts: number | null }) {
  const now = useNow(15000);
  if (ts === null) return <span>—</span>;
  if (now === null) return <span>…</span>;
  const s = Math.max(0, Math.floor(now / 1000 - ts));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span>{d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
}

/** New York time and whether the US market is open, like a bedside clock. */
export function ClockChip() {
  const now = useNow(15000);
  if (now === null) return <span className="chip">New York</span>;
  const d = new Date(now);
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const open = !["Sat", "Sun"].includes(p.weekday) && mins >= 570 && mins < 960;
  return (
    <span className="chip">
      <span className="dotmark" style={{ background: open ? "var(--dawn)" : "var(--sodium)" }} />
      {p.weekday} {p.hour}:{p.minute} ET · {open ? "market open" : "market closed"}
    </span>
  );
}

const NAV = [
  { href: "/terminal", label: "Overview" },
  { href: "/terminal/NVDAc", label: "Tokens", match: /^\/terminal\/[A-Za-z]+c$/ },
  { href: "/terminal/auctions", label: "Auctions" },
  { href: "/terminal/ledger", label: "Ledger" },
  { href: "/terminal/forward", label: "Forward test" },
  { href: "/terminal/research", label: "Research" },
  { href: "/terminal/agents", label: "Agents" },
];

export function Rail() {
  const path = usePathname();
  return (
    <nav className="rail" aria-label="Primary">
      <Link href="/" className="wordmark" aria-label="bell home">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3c-3.6 0-5.5 2.8-5.5 6v3.6L4.8 15.5h14.4l-1.7-2.9V9c0-3.2-1.9-6-5.5-6Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9.8 18.2a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="var(--dawn)" strokeWidth="1.4" />
        </svg>
        bell
      </Link>
      {NAV.map((n) => {
        const on = n.match ? n.match.test(path) : path === n.href;
        return (
          <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            {n.label}
          </Link>
        );
      })}
      <div className="rail-foot">
        <span className="chip"><span className="dotmark" style={{ background: "var(--dawn)" }} />Base mainnet · read only</span>
      </div>
    </nav>
  );
}
