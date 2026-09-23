/** Tiny, dependency-free vector math + easing helpers used across the studio. */

export interface Vec {
  x: number;
  y: number;
}

export const v = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** Always-positive modulo. */
export const mod = (x: number, m: number): number => ((x % m) + m) % m;

export function norm(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
export const dirOf = (ang: number, r = 1): Vec => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });

/** Rotate a vector by `ang` (scene space is y-down, so positive = clockwise on screen). */
export function rotate(a: Vec, ang: number): Vec {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const rad = (deg: number): number => deg * D2R;
export const deg = (r: number): number => r * R2D;

/** Wrap into (-PI, PI]. */
export function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x <= -Math.PI) x += TAU;
  return x;
}

/** Interpolate angles along the shortest arc. */
export function angleLerp(a: number, b: number, t: number): number {
  return a + wrapPi(b - a) * t;
}

export function round(x: number, digits = 3): number {
  const p = Math.pow(10, digits);
  return Math.round(x * p) / p;
}

let counter = 0;
export function uid(prefix = "x"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
}

/* ------------------------------------------------------------------ easing */

export type Ease =
  | "hold"
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "slowIn"
  | "slowOut"
  | "backOut"
  | "bounceOut"
  | "elasticOut";

export const EASES: { id: Ease; label: string; hint: string }[] = [
  { id: "linear", label: "Linear", hint: "Constant speed" },
  { id: "easeInOut", label: "Smooth", hint: "Slow both ends (default for motion)" },
  { id: "easeIn", label: "Accelerate", hint: "Starts slow" },
  { id: "easeOut", label: "Decelerate", hint: "Ends slow" },
  { id: "slowIn", label: "Anticipate", hint: "Strong slow-in" },
  { id: "slowOut", label: "Settle", hint: "Strong slow-out" },
  { id: "backOut", label: "Overshoot", hint: "Passes the target and comes back" },
  { id: "bounceOut", label: "Bounce", hint: "Bounces on landing" },
  { id: "elasticOut", label: "Elastic", hint: "Rubber band" },
  { id: "hold", label: "Hold", hint: "No blending — keeps this pose until the next key" },
];

const easeFns: Record<Exclude<Ease, "hold">, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => t * t * (3 - 2 * t),
  slowIn: (t) => t * t * t,
  slowOut: (t) => 1 - Math.pow(1 - t, 3),
  backOut: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  bounceOut: (t) => {
    const n = 7.5625;
    const d = 2.75;
    let x = t;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 3.0 / d) * x + 0.984375;
  },
  elasticOut: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((TAU) / 3)) + 1),
};

/** Map normalized segment time through an easing curve. */
export function applyEase(ease: Ease, t: number): number {
  if (ease === "hold") return 0;
  const f = easeFns[ease] ?? easeFns.linear;
  return f(clamp(t, 0, 1));
}

/* -------------------------------------------------------------- polygons */

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Squared distance from point to segment. */
export function distToSegSq(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 < 1e-9 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  return dx * dx + dy * dy;
}

export function distToPolyline(p: Vec, poly: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) best = Math.min(best, Math.sqrt(distToSegSq(p, poly[i], poly[i + 1])));
  return best;
}

export function centroid(pts: Vec[]): Vec {
  if (!pts.length) return v();
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bbox(pts: Vec[]): Box {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const emptyBox = (): Box => ({ x: NaN, y: NaN, w: 0, h: 0 });

export function growBox(b: Box, p: Vec): Box {
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return { x: p.x, y: p.y, w: 0, h: 0 };
  const x0 = Math.min(b.x, p.x);
  const y0 = Math.min(b.y, p.y);
  const x1 = Math.max(b.x + b.w, p.x);
  const y1 = Math.max(b.y + b.h, p.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ramer–Douglas–Peucker simplification — used by the lasso drawing tool. */
export function simplify(pts: Vec[], eps = 2): Vec[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    const a = pts[s];
    const b = pts[e];
    for (let i = s + 1; i < e; i++) {
      const d = Math.sqrt(distToSegSq(pts[i], a, b));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}
