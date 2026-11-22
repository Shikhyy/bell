"use client";

import { useEffect, useMemo, useState } from "react";
import { weekHour } from "@/lib/session";
import { Countdown } from "./Live";

const CX = 240, CY = 240, R1 = 140, R2 = 206;
const STEP = (Math.PI * 2) / 168;
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const P = (r: number, a: number) => `${(CX + r * Math.cos(a)).toFixed(1)} ${(CY + r * Math.sin(a)).toFixed(1)}`;

/** 168-hour dial of oracle activity: when information reaches the chain, and when it goes dark. */
export function WeekClock({ activity, bellAt, bellLabel }: { activity: number[]; bellAt: string; bellLabel: string }) {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setHour(weekHour(new Date()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const rings = useMemo(() => {
    const max = Math.max(1, ...activity);
    const paths = ["", "", "", "", ""];
    for (let i = 0; i < 168; i++) {
      const v = Math.log1p(activity[i] ?? 0) / Math.log1p(max);
      const k = activity[i] === 0 ? 0 : v < 0.35 ? 1 : v < 0.6 ? 2 : v < 0.8 ? 3 : 4;
      const a0 = -Math.PI / 2 + i * STEP + STEP * 0.08, a1 = a0 + STEP * 0.84;
      paths[k] += `M${P(R2, a0)} A${R2} ${R2} 0 0 1 ${P(R2, a1)} L${P(R1, a1)} A${R1} ${R1} 0 0 0 ${P(R1, a0)} Z `;
    }
    let ticks = "";
    for (let d = 0; d < 7; d++) { const a = -Math.PI / 2 + d * 24 * STEP; ticks += `M${P(R1 - 10, a)} L${P(R2 + 10, a)} `; }
    return { paths, ticks };
  }, [activity]);

  const needle = hour === null ? null : (() => {
    const a = -Math.PI / 2 + hour * STEP;
    return { a, x: CX + (R2 + 4) * Math.cos(a), y: CY + (R2 + 4) * Math.sin(a) };
  })();

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 480, aspectRatio: "1 / 1", margin: "6px auto 0" }}>
      <svg viewBox="0 0 480 480" role="img" aria-label="Week clock of oracle updates by hour, New York time. Updates stop from Friday 20:00 to Sunday 20:00." style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <mask id="clock-sweep">
            {/* a ring-shaped stroke that draws itself clockwise from Monday 00:00 */}
            <circle cx={CX} cy={CY} r={(R1 + R2) / 2} fill="none" stroke="#fff" strokeWidth={R2 - R1 + 30} pathLength={1} className="sweep" transform={`rotate(-90 ${CX} ${CY})`} />
          </mask>
        </defs>
        <circle cx={CX} cy={CY} r={214} fill="none" stroke="#141A27" />
        <circle cx={CX} cy={CY} r={132} fill="none" stroke="#141A27" />
        <g mask="url(#clock-sweep)">
          <path d={rings.paths[0]} fill="#78B4FF" fillOpacity={0.16} />
          <path d={rings.paths[1]} fill="#FF9E4A" fillOpacity={0.22} />
          <path d={rings.paths[2]} fill="#FF9E4A" fillOpacity={0.45} />
          <path d={rings.paths[3]} fill="#FF9E4A" fillOpacity={0.72} />
          <path d={rings.paths[4]} fill="#FF9E4A" />
        </g>
        <path d={rings.ticks} stroke="#263047" />
        {needle && (
          <>
            <line x1={CX + (R1 - 8) * Math.cos(needle.a)} y1={CY + (R1 - 8) * Math.sin(needle.a)} x2={needle.x} y2={needle.y} stroke="#ECEEF2" strokeWidth={1.4} />
            <circle cx={needle.x} cy={needle.y} r={4.5} fill="none" stroke="#ECEEF2" strokeWidth={1.2} className="halo" />
            <circle cx={needle.x} cy={needle.y} r={4.5} fill="#05070B" stroke="#ECEEF2" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {DAYS.map((name, d) => {
        const a = -Math.PI / 2 + (d * 24 + 12) * STEP;
        return (
          <span key={name} className="mono" style={{ position: "absolute", left: `${(((CX + 226 * Math.cos(a)) / 480) * 100).toFixed(2)}%`, top: `${(((CY + 226 * Math.sin(a)) / 480) * 100).toFixed(2)}%`, transform: "translate(-50%, -50%)", fontSize: 10.5, letterSpacing: "0.14em", color: "var(--haze)" }}>
            {name}
          </span>
        );
      })}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, pointerEvents: "none", textAlign: "center" }}>
        <span className="label">Next bell</span>
        <span style={{ fontSize: 50, lineHeight: 1 }}><Countdown to={bellAt} className="dot" /></span>
        <span style={{ fontSize: 13, color: "var(--haze)", maxWidth: 180 }}>{bellLabel}</span>
      </div>
    </div>
  );
}
