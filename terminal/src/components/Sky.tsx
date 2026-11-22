"use client";

import { useEffect, useRef } from "react";

/**
 * Ordered-dither pixel skies, rendered by a WebGL fragment shader at the display's refresh rate.
 * One canvas pixel = one dither cell; CSS scales it up with pixelated rendering, so the GPU only
 * shades a few thousand cells per frame. Clouds drift continuously, stars twinkle, the moon breathes.
 * Falls back to a CPU renderer without WebGL. Pauses off-screen and in hidden tabs; one still
 * frame under prefers-reduced-motion.
 */
type Kind = "night" | "dawn" | "end" | "band" | "orb" | "word";

const PALETTES: Record<Kind, string[]> = {
  night: ["#070A1A", "#0F1736", "#1C2B63", "#33499A", "#5C76C9", "#A9B9EE"],
  dawn: ["#070A1A", "#121433", "#3A1F3D", "#8A3B2E", "#D9682C", "#FFB067"],
  end: ["#05070B", "#0A0F24", "#16224D", "#2C4287", "#5C76C9", "#A9B9EE"],
  band: ["#070A1A", "#0F1736", "#1C2B63", "#33499A", "#5C76C9", "#A9B9EE"],
  orb: ["#05070B", "#0A0F24", "#1C2B63", "#3D55A6", "#7D96E0", "#E6ECFA"],
  word: ["#05070B", "#0B1230", "#1C2B63", "#3D55A6", "#7D96E0", "#E6ECFA"],
};
const KIND_ID: Record<Kind, number> = { night: 0, dawn: 1, end: 2, band: 3, orb: 4, word: 5 };
const SEEDS: Record<Kind, number> = { night: 0.11, dawn: 0.37, end: 0.61, band: 0.23, orb: 0.83, word: 0.47 };
const CELL = 3; // CSS px per dither cell

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 u_grid;      // canvas size in cells
uniform float u_time;
uniform float u_kind;
uniform float u_seed;
uniform float u_scale;    // cells -> legacy 4px units (keeps cloud shapes the same at any cell size)
uniform vec3 u_pal[6];
uniform sampler2D u_mask;
uniform float u_hasMask;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + u_seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float ss(float a, float b, float x){ float k = clamp((x - a) / (b - a), 0.0, 1.0); return k * k * (3.0 - 2.0 * k); }

void main(){
  vec2 cell = floor(gl_FragCoord.xy);
  float W = u_grid.x, H = u_grid.y;
  float x = cell.x * u_scale, y = (H - 1.0 - cell.y) * u_scale;   // legacy units, top-left origin
  float Wl = W * u_scale, Hl = H * u_scale;
  float nx = cell.x / W, ny = 1.0 - cell.y / H;
  float t = u_time, br = sin(t * 0.9);
  float val;

  if (u_kind < 0.5 || abs(u_kind - 2.0) < 0.5) {
    float c = fbm(vec2((x + t * 1.1) * 0.022, (y + t * 0.12) * 0.045));
    if (u_kind < 0.5) {
      val = 0.1 + 0.2 * ny + 0.62 * ss(0.4, 0.72, c) * (0.55 + 0.45 * ny);
      float md = length(vec2(nx - 0.74, (ny - 0.2) * (Hl / Wl)));
      val = md < 0.045 ? 1.0 : val + 0.35 * exp(-md * 14.0) * (1.0 + 0.14 * br);
      val *= 0.92;
      float cx = abs(nx - 0.5), cy = abs(ny - 0.5);
      if (cx < 0.3 && cy < 0.25) val *= 0.72 + 0.28 * max(cx / 0.3, cy / 0.25);
    } else {
      val = 0.05 + 0.5 * ss(0.42, 0.74, c) * ny + 0.15 * ny;
      float cx = abs(nx - 0.5), cy = abs(ny - 0.5);
      if (cx < 0.32 && cy < 0.3) val *= 0.6 + 0.4 * max(cx / 0.32, cy / 0.3);
    }
  } else if (abs(u_kind - 1.0) < 0.5) {
    float c = fbm(vec2((x + t * 0.8) * 0.022, (y + t * 0.05) * 0.045));
    float glow = exp(-((1.0 - ny) / 0.3)) * (1.0 + 0.07 * sin(t * 0.6));
    val = 0.06 + 0.9 * glow * (0.55 + 0.45 * c) + 0.18 * ss(0.42, 0.74, c) * ny;
    if (length(vec2(nx - 0.5, (ny - 1.02) * (Hl / Wl))) < 0.07 + 0.004 * br) val = 1.0;
  } else if (abs(u_kind - 3.0) < 0.5) {
    float c = fbm(vec2((x + t * 1.4) * 0.03, (y + t * 0.1) * 0.09));
    val = 0.08 + 0.7 * ss(0.38, 0.7, c) * (0.25 + 0.75 * nx);
    float md = length(vec2(nx - 0.955, (ny - 0.3) * (Hl / Wl)));
    val = md < 0.022 ? 1.0 : val + 0.3 * exp(-md * 30.0) * (1.0 + 0.2 * br);
  } else if (abs(u_kind - 4.0) < 0.5) {
    float d = length(vec2(cell.x - W * 0.5, (H - 1.0 - cell.y) - H * 0.5));
    float R = 12.0;
    val = d < R ? 1.0 : 0.04 + 0.9 * exp(-(d - R) / (9.0 + 1.0 * br)) * (0.65 + 0.35 * noise(cell * 0.25 + t * 0.4));
  } else {
    // word: the sky fills the letters; a breathing moon sits above them
    float c = fbm(vec2((x + t * 0.9) * 0.028, (y + t * 0.1) * 0.05));
    float m = u_hasMask > 0.5 ? texture2D(u_mask, vec2(nx, ny)).a : 0.0;
    float inside = 0.16 + 0.55 * ss(0.36, 0.72, c) + 0.32 * (1.0 - ny);
    float md = length(vec2(cell.x - W * 0.665, (H - 1.0 - cell.y) - H * 0.17));
    float R = H * 0.085;
    float halo = md < R ? 1.0 : exp(-(md - R) / (H * 0.075 + 1.5 * br));
    val = mix(0.0, inside, m) + 0.75 * halo * (1.0 - 0.35 * m); // outside the letters: pure ground, no edge
    val = md < R ? 1.0 : val;
    val *= 1.0 - 0.55 * ss(0.78, 1.0, ny) * m; // letters dissolve toward the bottom edge
  }

  // stars in the dark upper sky
  if (val < 0.28 && ny < (abs(u_kind - 1.0) < 0.5 ? 0.35 : 0.55) && u_kind < 4.5) {
    float r = hash(cell * 1.37 + 3.1);
    if (r > 0.9965) val = max(val, 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 2.3 + r * 977.0)));
  }

  val = clamp(val, 0.0, 1.0);
  float s = val * 5.0;
  float idx = floor(s) + step(bayer4(cell) + 0.03125, fract(s)); // thresholds at (k + 0.5)/16, never 0
  vec3 col = u_pal[0];
  for (int i = 1; i < 6; i++) { if (float(i) <= idx) col = u_pal[i]; }
  gl_FragColor = vec4(col, 1.0);
}`;

function hexToRgb(h: string) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** Draws `text` as an alpha mask the size of the grid, in the page's display font. */
function textMask(text: string, W: number, H: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  let size = H * 0.92; // leaves the top fifth of the canvas for the moon
  ctx.font = `600 ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > W * 0.92) size *= (W * 0.92) / w;
  ctx.font = `600 ${size}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, W / 2, H * 0.98);
  return c;
}

type GL = {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  tex: WebGLTexture | null;
};

function initGL(canvas: HTMLCanvasElement, kind: Kind): GL | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  // A context can come back already lost (browsers cap live WebGL contexts, e.g. after hot reloads):
  // then every create* call returns null. Fall back to the CPU renderer instead of throwing.
  if (!gl || gl.isContextLost()) return null;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("[sky]", gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u: GL["u"] = {};
  for (const n of ["u_grid", "u_time", "u_kind", "u_seed", "u_scale", "u_pal", "u_mask", "u_hasMask"]) u[n] = gl.getUniformLocation(prog, n);
  gl.uniform1f(u.u_kind, KIND_ID[kind]);
  gl.uniform1f(u.u_seed, SEEDS[kind]);
  gl.uniform1f(u.u_scale, CELL / 4);
  gl.uniform3fv(u.u_pal, new Float32Array(PALETTES[kind].flatMap(hexToRgb)));
  gl.uniform1f(u.u_hasMask, 0);
  return { gl, prog, u, tex: null };
}

function sizeGL(g: GL, canvas: HTMLCanvasElement, kind: Kind, text?: string) {
  const W = Math.max(40, Math.round(canvas.clientWidth / CELL));
  const H = Math.max(16, Math.round(canvas.clientHeight / CELL));
  canvas.width = W;
  canvas.height = H;
  const { gl, u } = g;
  gl.viewport(0, 0, W, H);
  gl.uniform2f(u.u_grid, W, H);
  if (kind === "word" && text) {
    if (!g.tex) g.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textMask(text, W, H));
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.uniform1i(u.u_mask, 0);
    gl.uniform1f(u.u_hasMask, 1);
  }
}

// ── CPU fallback (no WebGL): a lighter version of the same skies ──
function drawCPU(canvas: HTMLCanvasElement, kind: Kind) {
  const W = Math.max(40, Math.round(canvas.clientWidth / 4));
  const H = Math.max(16, Math.round(canvas.clientHeight / 4));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pal = PALETTES[kind];
  for (let y = 0; y < H; y++) {
    const v = kind === "dawn" ? Math.exp(-((1 - y / H) / 0.3)) : 0.1 + 0.25 * (y / H);
    ctx.fillStyle = pal[Math.min(5, Math.floor(v * 5))];
    ctx.fillRect(0, y, W, 1);
  }
}

export function Sky({ kind, text }: { kind: Kind; text?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let g: GL | null = null;
    try {
      g = initGL(canvas, kind);
    } catch (e) {
      console.warn("[sky] WebGL unavailable, using fallback:", (e as Error).message);
    }
    if (!g) {
      drawCPU(canvas, kind);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true, raf = 0, lost = false;
    const start = performance.now();
    const render = (now: number) => {
      if (lost || !g || g.gl.isContextLost()) return;
      g.gl.uniform1f(g.u.u_time, (now - start) / 1000);
      g.gl.drawArrays(g.gl.TRIANGLE_STRIP, 0, 4);
    };
    const onLost = (e: Event) => { e.preventDefault(); lost = true; };
    const onRestored = () => {
      const fresh = initGL(canvas, kind);
      if (!fresh) return;
      g = fresh;
      lost = false;
      resize();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (visible && !document.hidden) render(now);
    };
    const resize = () => {
      if (!g || lost || g.gl.isContextLost()) return;
      sizeGL(g, canvas, kind, text);
      render(performance.now());
    };
    resize();
    if (kind === "word" && document.fonts?.ready) document.fonts.ready.then(resize).catch(() => {});
    if (!reduced) raf = requestAnimationFrame(loop);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    let tid: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(tid); tid = setTimeout(resize, 120); });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      clearTimeout(tid);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      g?.gl.getExtension("WEBGL_lose_context")?.loseContext(); // free the context slot right away
    };
  }, [kind, text]);
  return <canvas ref={ref} className="sky" aria-hidden="true" />;
}
