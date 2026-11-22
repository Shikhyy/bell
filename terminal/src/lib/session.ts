/** US equity session clock on the schedule the Chainlink 24/5 feeds follow (New York time).
 *  Overnight 20:00–04:00 (Sun–Thu nights), pre-market 04:00–09:30, regular 09:30–16:00,
 *  post-market 16:00–20:00. Closed from Friday 20:00 to Sunday 20:00 and on exchange holidays. */

export type SessionKind = "weekend" | "holiday" | "overnight" | "pre" | "regular" | "post";

const TZ = "America/New_York";
const HOLIDAYS = new Set(["2026-11-26", "2026-12-25", "2027-01-01"]);
const EARLY_CLOSE: Record<string, number> = { "2026-11-27": 13 * 60, "2026-12-24": 13 * 60 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function etParts(d: Date) {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return {
    dow: DAYS.indexOf(p.weekday),
    weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`,
    mins: Number(p.hour) * 60 + Number(p.minute),
    hhmm: `${p.hour}:${p.minute}`,
    monthDay: `${p.month}/${p.day}`,
  };
}

export function sessionAt(d: Date): SessionKind {
  const { dow, date, mins } = etParts(d);
  if (dow === 6 || (dow === 5 && mins >= 1200) || (dow === 0 && mins < 1200)) return "weekend";
  if (HOLIDAYS.has(date)) return "holiday";
  const close = EARLY_CLOSE[date] ?? 960;
  if (mins < 240) return "overnight";
  if (mins < 570) return "pre";
  if (mins < close) return "regular";
  if (mins < 1200) return "post";
  return "overnight";
}

export const SESSION_LABEL: Record<SessionKind, string> = {
  weekend: "Market closed · weekend",
  holiday: "Market closed · holiday",
  overnight: "Overnight session",
  pre: "Pre-market",
  regular: "Market open",
  post: "After hours",
};

export const isDark = (s: SessionKind) => s === "weekend" || s === "holiday";

export type Boundary = { at: string; from: SessionKind; to: SessionKind; label: string; bell: boolean; when: string };

function label(from: SessionKind, to: SessionKind) {
  if (to === "overnight" && isDark(from)) return "Weekly reopen";
  if (to === "overnight") return "Overnight session";
  if (to === "pre") return "Pre-market";
  if (to === "regular") return "Regular open";
  if (to === "post") return "Regular close";
  if (to === "weekend") return "Weekend close";
  return "Holiday close";
}

/** Session changes after `from`. All boundaries fall on :00 or :30 New York time, and New York
 *  is a whole number of hours from UTC, so half-hour UTC steps hit every one of them. */
export function nextBoundaries(from = new Date(), n = 6): Boundary[] {
  const out: Boundary[] = [];
  const step = 30 * 60 * 1000;
  let t = new Date(Math.floor(from.getTime() / step) * step + step);
  let prev = sessionAt(from);
  for (let i = 0; i < 48 * 12 && out.length < n; i++, t = new Date(t.getTime() + step)) {
    const s = sessionAt(t);
    if (s !== prev) {
      const p = etParts(t);
      out.push({
        at: t.toISOString(),
        from: prev,
        to: s,
        label: label(prev, s),
        bell: (isDark(prev) && s === "overnight") || s === "pre" || s === "regular",
        when: `${p.weekday} ${p.monthDay} · ${p.hhmm}`,
      });
      prev = s;
    }
  }
  return out;
}

/** Hours since Monday 00:00 New York time, 0–168. */
export function weekHour(d: Date) {
  const { dow, mins } = etParts(d);
  return ((dow + 6) % 7) * 24 + mins / 60;
}
