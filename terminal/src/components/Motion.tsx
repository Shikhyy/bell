"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, className = "", style }: { children: ReactNode; delay?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reveal when it enters view, or immediately if the page already scrolled past it (anchor jumps, restores).
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting || e.boundingClientRect.bottom < 0) { setOn(true); io.disconnect(); }
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal${on ? " in" : ""}${className ? " " + className : ""}`} style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

/** Departure-board flicker: digits cycle, then settle left to right, when first seen.
 *  Screen readers get the final text only. */
export function Scramble({ text, className, style, duration = 500 }: { text: string; className?: string; style?: CSSProperties; duration?: number }) {
  const [shown, setShown] = useState(text);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setShown(text);
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const settled = Math.floor(p * text.length);
        setShown(text.split("").map((ch, i) => (i < settled || !/[0-9]/.test(ch) ? ch : String(Math.floor(Math.random() * 10)))).join(""));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [text, duration]);
  return (
    <span ref={ref} className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
