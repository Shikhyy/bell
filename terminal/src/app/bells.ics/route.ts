import { nextBoundaries } from "@/lib/session";

export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Subscribable calendar of upcoming oracle boundaries (the weekly reopen and the US-equity opens). */
export function GET() {
  const now = new Date();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bell//oracle bells//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:bell — oracle bells", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  for (const b of nextBoundaries(now, 40).filter((x) => x.bell)) {
    const start = new Date(b.at);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stamp(start)}-${b.label.replace(/\W+/g, "").toLowerCase()}@bell.embarko.app`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(start.getTime() + 15 * 60_000))}`,
      `SUMMARY:bell: ${b.label}`,
      "DESCRIPTION:Chainlink equity feeds on Base wake and the oracle price can jump. Live forecast: https://bell.embarko.app/terminal/calculator",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:bell in 10 minutes", "TRIGGER:-PT10M", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
