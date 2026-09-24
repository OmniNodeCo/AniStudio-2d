/**
 * Scenery catalog.
 *
 * Every object is a deterministic little drawing built out of polygons, in **local space**:
 * the anchor sits at (0,0) and "up" is −y (the world is y-down, like the rigs). Objects are
 * painted with the scene palette by default, so one palette click re-skins the whole set.
 *
 * Nothing is stored but the object's placement (`SceneObject`), which keeps project files tiny
 * and lets scenery be restyled (scale, colours, seed) at any time.
 */
import { TAU, type Vec } from "./math";
import type { Light, LightKind, RoleKey, Scene, SceneObject, SceneryKind } from "./types";

/* ------------------------------------------------------------------ utils */

/** Deterministic PRNG so a tree keeps its shape across redraws (and exports). */
export function makeRng(seed: number): () => number {
  let a = (seed || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `#rgb` / `#rrggbb` → [r,g,b] (falls back to a neutral grey). */
export function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [200, 200, 210];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0");

/** Lighten (t > 0) or darken (t < 0) a hex colour. */
export function shade(hex: string, t: number): string {
  const [r, g, b] = toRgb(hex);
  const f = (v: number) => (t >= 0 ? v + (255 - v) * t : v * (1 + t));
  return `#${toHex(f(r))}${toHex(f(g))}${toHex(f(b))}`;
}

export function mixColors(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`;
}

/* ------------------------------------------------------------- geometry */

export interface GeomPart {
  pts: Vec[];
  /** Resolved fill colour (already palette/override aware). */
  fill: string;
  closed: boolean;
  /** Soft (rounded) outline instead of sharp corners. */
  soft?: boolean;
  stroke?: string | null;
  opacity?: number;
  /** Painted with additive blending (light beams, flames, glows). */
  glow?: boolean;
}

export interface BuildCtx {
  obj: SceneObject;
  scene: Scene;
  rng: () => number;
  /** Main colour: the object's override, else the palette role. */
  main: string;
  /** Secondary colour: `color2`, else a darker main. */
  second: string;
  /** Frame number — lets a few objects animate (flames, windmill blades, birds). */
  frame: number;
}

function blob(cx: number, cy: number, rx: number, ry: number, seg = 14, bulge = 0): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    const k = 1 + bulge * Math.sin(a * 2);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return pts;
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function poly(...pairs: number[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push({ x: pairs[i], y: pairs[i + 1] });
  return out;
}

/** Ridge running along x, from `y0` (crest) down to `base` (+y is down). */
function ridge(width: number, height: number, base: number, rng: () => number, seg = 16, jag = 0.35): Vec[] {
  const pts: Vec[] = [{ x: -width / 2, y: base }];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = -width / 2 + width * t;
    const hump = Math.sin(t * Math.PI) ** 0.7;
    const detail = (rng() - 0.5) * jag + Math.sin(t * 9.1 + 1.3) * 0.14;
    pts.push({ x, y: base - height * Math.max(0.06, hump * (1 + detail)) });
  }
  pts.push({ x: width / 2, y: base });
  return pts;
}

/** Two arcs of different circles → crescent (moon). */
function crescent(R: number, off: number, r: number, seg = 22): Vec[] {
  const pts: Vec[] = [];
  const cx2 = off;
  const outside = (p: Vec) => Math.hypot(p.x - cx2, p.y) > r;
  for (let i = 0; i <= seg * 2; i++) {
    const a = (i / (seg * 2)) * TAU - Math.PI / 2;
    const p = { x: Math.cos(a) * R, y: Math.sin(a) * R };
    if (outside(p)) pts.push(p);
  }
  for (let i = seg * 2; i >= 0; i--) {
    const a = (i / (seg * 2)) * TAU + Math.PI / 2;
    const p = { x: cx2 + Math.cos(a) * r, y: Math.sin(a) * r };
    if (Math.hypot(p.x, p.y) < R * 0.999) pts.push(p);
  }
  return pts.length > 3 ? pts : blob(0, 0, R, R, seg);
}

/** Local (anchor-relative) points → world, applying an object's placement. */
export function objectTransform(obj: SceneObject, pts: Vec[]): Vec[] {
  const c = Math.cos(obj.rot);
  const s = Math.sin(obj.rot);
  return pts.map((p) => ({
    x: obj.x + (p.x * c - p.y * s) * obj.scale,
    y: obj.y + (p.x * s + p.y * c) * obj.scale,
  }));
}

/** Bounding box of an object in world space (used by hit-testing and “fit to set”). */
export function objectBox(obj: SceneObject, scene: Scene, frame = 0): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const part of buildObject(obj, scene, frame)) {
    for (const p of objectTransform(obj, part.pts)) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) return { x: obj.x - 20, y: obj.y - 60, w: 40, h: 60 };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/* ------------------------------------------------------------------ defs */

export type SceneryGroup = "sky" | "land" | "foliage" | "water" | "town" | "props";

export interface SceneryDef {
  id: SceneryKind;
  label: string;
  group: SceneryGroup;
  role: RoleKey;
  /** Rough height in scene units — used for hints and for “place on the ground”. */
  height: number;
  /** Default draw order (below 1 = behind the character). */
  z: number;
  build: (c: BuildCtx) => GeomPart[];
}

const DARK = (hex: string) => shade(hex, -0.4);

export const SCENERY: SceneryDef[] = [
  /* --------------------------------------------------------------- sky */
  {
    id: "hill",
    label: "Hill",
    group: "sky",
    role: "cloth2",
    height: 90,
    z: 0.1,
    build: ({ rng, main, second }) => [
      { pts: ridge(520, 96, 0, rng, 18, 0.22), fill: shade(main, -0.28), closed: true, soft: true },
      { pts: ridge(400, 62, 0, rng, 16, 0.3), fill: second, closed: true, soft: true },
    ],
  },
  {
    id: "mountain",
    label: "Mountains",
    group: "sky",
    role: "dark",
    height: 210,
    z: 0.1,
    build: ({ rng, main, second }) => {
      const pts: Vec[] = [{ x: -260, y: 0 }];
      const peaks = 4;
      for (let i = 0; i < peaks; i++) {
        const base = -260 + ((i + 0.5) / peaks) * 520;
        const h = 150 + rng() * 90;
        pts.push({ x: base - 90 - rng() * 30, y: 0 });
        pts.push({ x: base - 20, y: -h * 0.62 });
        pts.push({ x: base, y: -h });
        pts.push({ x: base + 26, y: -h * 0.6 });
      }
      pts.push({ x: 260, y: 0 });
      const caps: Vec[] = [];
      let best = -Infinity;
      let bx = 0;
      let bh = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        if (pts[i].y < best) {
          best = pts[i].y;
          bx = pts[i].x;
          bh = pts[i].y;
        }
      }
      void bh;
      caps.push(
        { x: bx - 34, y: bh + 46 },
        { x: bx - 18, y: bh + 18 },
        { x: bx - 6, y: bh + 30 },
        { x: bx + 4, y: bh + 8 },
        { x: bx + 18, y: bh + 28 },
        { x: bx + 32, y: bh + 44 },
      );
      return [
        { pts, fill: main, closed: true },
        { pts: caps, fill: shade(second, 0.55), closed: true },
      ];
    },
  },
  {
    id: "cloud",
    label: "Cloud",
    group: "sky",
    role: "white",
    height: 46,
    z: 0.05,
    build: ({ rng, main }) => {
      const out: GeomPart[] = [];
      const n = 4 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const r = 26 - Math.abs(t - 0.45) * 26 + rng() * 8;
        out.push({ pts: blob(-52 + t * 104, -r * 0.55 + rng() * 6, r, r * 0.78, 12), fill: i === 0 ? shade(main, -0.06) : main, closed: true, soft: true });
      }
      return out;
    },
  },
  {
    id: "starfield",
    label: "Stars",
    group: "sky",
    role: "white",
    height: 220,
    z: 0.04,
    build: ({ rng, main, obj }) => {
      const out: GeomPart[] = [];
      const n = 22;
      for (let i = 0; i < n; i++) {
        const x = (rng() - 0.5) * 520;
        const y = -rng() * 260 + 20;
        const r = 1.4 + rng() * 2.4;
        out.push({ pts: blob(x, y, r, r, 6), fill: main, closed: true, opacity: 0.4 + rng() * 0.6, glow: true });
      }
      out.push({ pts: blob(0, -150, 40 + (obj.seed ?? 1) % 20, 40, 20, 0.12), fill: main, closed: true, opacity: 0.05, glow: true });
      return out;
    },
  },
  {
    id: "sun",
    label: "Sun",
    group: "sky",
    role: "accent",
    height: 150,
    z: 0.04,
    build: ({ main, second }) => {
      const rays: Vec[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const r = i % 2 === 0 ? 78 : 54;
        rays.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return [
        { pts: rays, fill: shade(main, -0.25), closed: true, glow: true, opacity: 0.5 },
        { pts: blob(0, 0, 48, 48, 22), fill: main, closed: true },
        { pts: blob(-10, -10, 26, 26, 18), fill: shade(main, 0.35), closed: true, opacity: 0.6, glow: true },
      ];
    },
  },
  {
    id: "moon",
    label: "Moon",
    group: "sky",
    role: "white",
    height: 120,
    z: 0.04,
    build: ({ main }) => [
      { pts: blob(0, 0, 60, 60, 24), fill: shade(main, 0.2), closed: true, glow: true, opacity: 0.18 },
      { pts: crescent(46, 26, 40, 26), fill: main, closed: true },
    ],
  },
  {
    id: "skyline",
    label: "City skyline",
    group: "town",
    role: "dark",
    height: 190,
    z: 0.1,
    build: ({ rng, main, second }) => {
      const out: GeomPart[] = [];
      let x = -260;
      while (x < 240) {
        const w = 30 + rng() * 46;
        const h = 70 + rng() * 130;
        out.push({ pts: rect(x, -h, x + w, 0), fill: shade(main, -0.06 + rng() * 0.14), closed: true });
        for (let wy = -h + 16; wy < -20; wy += 22) {
          for (let wx = x + 7; wx < x + w - 8; wx += 16) {
            if (rng() < 0.45) continue;
            out.push({ pts: rect(wx, wy, wx + 6, wy + 9), fill: second, closed: true, opacity: 0.75, glow: true });
          }
        }
        x += w + 4 + rng() * 12;
      }
      return out;
    },
  },

  /* -------------------------------------------------------------- land */
  {
    id: "grass",
    label: "Grass tuft",
    group: "land",
    role: "cloth",
    height: 26,
    z: 2,
    build: ({ rng, main }) => {
      const out: GeomPart[] = [];
      for (let i = 0; i < 5; i++) {
        const bx = (i - 2) * 5 + rng() * 3;
        const h = 14 + rng() * 16;
        out.push({
          pts: poly(bx - 2.4, 0, bx + (rng() - 0.5) * 8, -h, bx + 2.6, 0),
          fill: shade(main, -0.1 + rng() * 0.3),
          closed: true,
        });
      }
      return out;
    },
  },
  {
    id: "flower",
    label: "Flower",
    group: "land",
    role: "accent",
    height: 34,
    z: 2,
    build: ({ main, second }) => [
      { pts: poly(-1.6, 0, -1.2, -26, 1.4, -26, 1.8, 0), fill: second, closed: true },
      { pts: blob(-9, -16, 9, 5, 10), fill: shade(second, -0.1), closed: true, soft: true },
      { pts: blob(9, -20, 9, 5, 10), fill: shade(second, -0.1), closed: true, soft: true },
      { pts: blob(0, -30, 7, 7, 12), fill: main, closed: true },
    ],
  },
  {
    id: "rock",
    label: "Rock",
    group: "land",
    role: "shoe",
    height: 34,
    z: 2,
    build: ({ rng, main }) => {
      const pts: Vec[] = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const r = 20 + (rng() - 0.5) * 10;
        pts.push({ x: Math.cos(a) * r * 1.15, y: -Math.abs(Math.sin(a)) * r * 0.7 });
      }
      return [
        { pts, fill: main, closed: true },
        { pts: blob(-6, -14, 9, 5, 8), fill: shade(main, 0.28), closed: true, soft: true, opacity: 0.75 },
      ];
    },
  },
  {
    id: "cactus",
    label: "Cactus",
    group: "foliage",
    role: "cloth",
    height: 120,
    z: 2,
    build: ({ main, second }) => [
      { pts: blob(0, -60, 15, 62, 14), fill: main, closed: true, soft: true },
      { pts: blob(-24, -46, 10, 20, 12), fill: second, closed: true, soft: true },
      { pts: blob(-24, -72, 10, 26, 12), fill: second, closed: true, soft: true },
      { pts: blob(24, -38, 9, 16, 12), fill: second, closed: true, soft: true },
      { pts: blob(24, -58, 9, 20, 12), fill: second, closed: true, soft: true },
    ],
  },

  /* ----------------------------------------------------------- foliage */
  {
    id: "pine",
    label: "Pine tree",
    group: "foliage",
    role: "cloth2",
    height: 160,
    z: 2,
    build: ({ main, second }) => [
      { pts: rect(-6, -22, 6, 0), fill: second, closed: true },
      { pts: poly(-52, -18, 0, -78, 52, -18), fill: main, closed: true },
      { pts: poly(-44, -58, 0, -118, 44, -58), fill: shade(main, 0.08), closed: true },
      { pts: poly(-32, -98, 0, -156, 32, -98), fill: shade(main, 0.16), closed: true },
    ],
  },
  {
    id: "tree",
    label: "Round tree",
    group: "foliage",
    role: "cloth",
    height: 150,
    z: 2,
    build: ({ rng, main, second }) => [
      { pts: poly(-8, 0, -5, -62, 5, -62, 8, 0), fill: second, closed: true },
      { pts: blob(-28, -74, 30, 26, 16, 0.08), fill: shade(main, -0.12), closed: true, soft: true },
      { pts: blob(30, -80, 28, 26, 16, 0.1), fill: shade(main, -0.06), closed: true, soft: true },
      { pts: blob(0, -104, 38, 30, 18, 0.06), fill: main, closed: true, soft: true },
      { pts: blob(-14 + rng() * 8, -116, 20, 14, 12), fill: shade(main, 0.18), closed: true, soft: true, opacity: 0.85 },
    ],
  },
  {
    id: "palm",
    label: "Palm",
    group: "foliage",
    role: "cloth",
    height: 190,
    z: 2,
    build: ({ rng, main, second }) => {
      const out: GeomPart[] = [];
      const seg: Vec[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = Math.sin(t * 1.1) * 26 * t;
        seg.push({ x: x - 6, y: -t * 150 });
      }
      for (let i = 8; i >= 0; i--) {
        const t = i / 8;
        const x = Math.sin(t * 1.1) * 26 * t;
        seg.push({ x: x + 6, y: -t * 150 });
      }
      out.push({ pts: seg, fill: second, closed: true, soft: true });
      const top = { x: Math.sin(1.1) * 26, y: -150 };
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI + (i / 6) * Math.PI;
        const len = 52 + rng() * 16;
        const ex = top.x + Math.cos(a) * len;
        const ey = top.y + Math.sin(a) * len * 0.55 - 6;
        out.push({
          pts: poly(top.x, top.y, (top.x + ex) / 2, (top.y + ey) / 2 - 16, ex, ey, (top.x + ex) / 2, (top.y + ey) / 2 + 8),
          fill: i % 2 ? main : shade(main, -0.12),
          closed: true,
          soft: true,
        });
      }
      out.push({ pts: blob(top.x - 10, top.y + 4, 8, 8, 10), fill: shade(main, 0.25), closed: true });
      out.push({ pts: blob(top.x + 8, top.y + 8, 7, 7, 10), fill: shade(main, 0.2), closed: true });
      return out;
    },
  },
  {
    id: "bush",
    label: "Bush",
    group: "foliage",
    role: "cloth",
    height: 60,
    z: 2,
    build: ({ rng, main }) => {
      const out: GeomPart[] = [];
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 20 + rng() * 8;
        out.push({ pts: blob(x, -18 - rng() * 10, 22, 18, 14), fill: shade(main, -0.16 + i * 0.08), closed: true, soft: true });
      }
      return out;
    },
  },
  {
    id: "flying-bird",
    label: "Distant birds",
    group: "sky",
    role: "dark",
    height: 16,
    z: 0.06,
    build: ({ rng, main, frame }) => {
      const out: GeomPart[] = [];
      for (let i = 0; i < 4; i++) {
        const x = (rng() - 0.5) * 180 + Math.sin((frame + i * 12) * 0.03) * 26;
        const y = -40 - rng() * 90;
        const flap = Math.sin(frame * 0.28 + i) * 5;
        out.push({ pts: poly(x - 11, y - flap, x, y + 2, x + 11, y - flap), fill: main, closed: false, opacity: 0.8 });
      }
      return out;
    },
  },

  /* -------------------------------------------------------------- town */
  {
    id: "house",
    label: "House",
    group: "town",
    role: "cloth",
    height: 120,
    z: 2,
    build: ({ main, second }) => [
      { pts: rect(-56, -74, 56, 0), fill: main, closed: true },
      { pts: poly(-68, -74, 0, -128, 68, -74), fill: second, closed: true },
      { pts: rect(-14, -46, 12, 0), fill: shade(second, -0.35), closed: true },
      { pts: rect(-46, -62, -26, -42), fill: shade(main, 0.55), closed: true, glow: true },
      { pts: rect(24, -62, 44, -42), fill: shade(main, 0.55), closed: true, glow: true },
      { pts: rect(6, -118, 24, -74), fill: shade(second, -0.2), closed: true },
    ],
  },
  {
    id: "windmill",
    label: "Windmill",
    group: "town",
    role: "cloth",
    height: 170,
    z: 2,
    build: ({ main, second, frame }) => {
      const out: GeomPart[] = [
        { pts: poly(-30, 0, -16, -108, 16, -108, 30, 0), fill: main, closed: true },
        { pts: poly(-22, -108, 0, -134, 22, -108), fill: second, closed: true },
        { pts: rect(-8, -40, 8, 0), fill: shade(second, -0.3), closed: true },
      ];
      const a0 = frame * 0.08;
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i / 4) * TAU;
        const cx = Math.cos(a) * 44;
        const cy = Math.sin(a) * 44;
        out.push({ pts: poly(Math.cos(a) * 10, Math.sin(a) * 10, cx - Math.sin(a) * 9, cy + Math.cos(a) * 9, cx + Math.sin(a) * 9, cy - Math.cos(a) * 9), fill: shade(main, 0.2), closed: true });
      }
      out.push({ pts: blob(0, 0, 7, 7, 10), fill: second, closed: true });
      return out;
    },
  },
  {
    id: "lighthouse",
    label: "Lighthouse",
    group: "town",
    role: "white",
    height: 190,
    z: 2,
    build: ({ main, second, frame }) => {
      const out: GeomPart[] = [
        { pts: poly(-26, 0, -14, -140, 14, -140, 26, 0), fill: main, closed: true },
      ];
      for (let i = 0; i < 4; i++) {
        const t0 = 0.1 + i * 0.22;
        const y0 = -140 * t0;
        const y1 = y0 - 16;
        const w0 = 14 + (26 - 14) * t0;
        const w1 = 14 + (26 - 14) * (t0 + 0.11);
        out.push({ pts: poly(-w0, y0, -w1, y1, w1, y1, w0, y0), fill: second, closed: true });
      }
      out.push({ pts: rect(-20, -168, 20, -140), fill: shade(second, -0.35), closed: true });
      out.push({ pts: poly(-26, -168, 0, -186, 26, -168), fill: shade(main, -0.1), closed: true });
      out.push({ pts: rect(-14, -162, 14, -146), fill: "#fff3c4", closed: true, glow: true });
      const sweep = Math.sin(frame * 0.06) * 0.5;
      out.push({
        pts: poly(0, -154, 260, -154 + Math.sin(sweep) * 190 - 30, 260, -154 + Math.sin(sweep) * 190 + 30),
        fill: "#fff3c4",
        closed: true,
        opacity: 0.16,
        glow: true,
      });
      return out;
    },
  },
  {
    id: "fence",
    label: "Fence",
    group: "town",
    role: "hair",
    height: 48,
    z: 2,
    build: ({ main }) => {
      const out: GeomPart[] = [];
      for (let i = 0; i < 5; i++) {
        const x = -60 + i * 30;
        out.push({ pts: poly(x - 4, 0, x - 4, -44, x + 4, -44, x + 4, 0), fill: main, closed: true });
      }
      out.push({ pts: rect(-66, -36, 66, -28), fill: shade(main, -0.08), closed: true });
      out.push({ pts: rect(-66, -18, 66, -10), fill: shade(main, -0.08), closed: true });
      return out;
    },
  },
  {
    id: "sign",
    label: "Sign",
    group: "props",
    role: "hair",
    height: 76,
    z: 2,
    build: ({ main, second }) => [
      { pts: rect(-4, 0, 4, -50), fill: second, closed: true },
      { pts: rect(-34, -76, 34, -44), fill: main, closed: true },
      { pts: rect(-24, -68, 12, -62), fill: shade(main, 0.6), closed: true },
      { pts: rect(-24, -58, 24, -52), fill: shade(main, 0.6), closed: true },
    ],
  },
  {
    id: "streetlamp",
    label: "Street lamp",
    group: "props",
    role: "dark",
    height: 130,
    z: 2,
    build: ({ main, second }) => [
      { pts: rect(-4, 0, 4, -120), fill: shade(main, 0.1), closed: true },
      { pts: rect(-16, 0, 16, -8), fill: shade(main, 0.1), closed: true },
      { pts: poly(0, -120, 30, -132, 30, -124, 0, -114), fill: shade(main, 0.1), closed: true },
      { pts: poly(18, -124, 42, -124, 36, -108, 24, -108), fill: second, closed: true },
      { pts: blob(30, -116, 7, 5, 10), fill: "#ffe9ad", closed: true, glow: true },
    ],
  },

  /* ------------------------------------------------------------- water */
  {
    id: "pond",
    label: "Pond",
    group: "water",
    role: "cloth",
    height: 60,
    z: 0.6,
    build: ({ main, second }) => [
      { pts: blob(0, -18, 110, 34, 22, 0.06), fill: shade(main, -0.28), closed: true, soft: true },
      { pts: blob(0, -20, 96, 26, 22, 0.05), fill: main, closed: true, soft: true },
      { pts: blob(-18, -26, 40, 8, 14), fill: second, closed: true, soft: true, opacity: 0.5 },
    ],
  },
  {
    id: "campfire",
    label: "Campfire",
    group: "props",
    role: "accent",
    height: 46,
    z: 2,
    build: ({ main, second, frame }) => {
      const out: GeomPart[] = [
        { pts: rect(-26, -8, 26, 2), fill: second, closed: true },
        { pts: rect(-22, -14, 18, -4), fill: shade(second, -0.2), closed: true },
      ];
      const flick = 0.85 + Math.sin(frame * 0.7) * 0.12 + Math.sin(frame * 1.9) * 0.06;
      out.push({ pts: poly(-16, -8, -6, -44 * flick, 2, -26, 10, -52 * flick, 18, -8), fill: shade(main, -0.15), closed: true, glow: true, opacity: 0.92 });
      out.push({ pts: poly(-9, -8, 0, -30 * flick, 9, -8), fill: shade(main, 0.45), closed: true, glow: true });
      return out;
    },
  },
  {
    id: "barrel",
    label: "Barrel",
    group: "props",
    role: "hair",
    height: 54,
    z: 2,
    build: ({ main, second }) => [
      { pts: poly(-20, 0, -24, -26, -20, -52, 20, -52, 24, -26, 20, 0), fill: main, closed: true },
      { pts: rect(-24, -44, 24, -38), fill: second, closed: true },
      { pts: rect(-23, -16, 23, -10), fill: second, closed: true },
      { pts: blob(0, -52, 20, 6, 14), fill: shade(main, 0.22), closed: true, soft: true },
    ],
  },
];

export const SCENERY_MAP = new Map(SCENERY.map((s) => [s.id, s]));

export const SCENERY_GROUPS: { id: SceneryGroup; label: string }[] = [
  { id: "sky", label: "Sky & horizon" },
  { id: "land", label: "Ground" },
  { id: "foliage", label: "Trees & plants" },
  { id: "town", label: "Buildings" },
  { id: "water", label: "Water" },
  { id: "props", label: "Props" },
];

export function sceneryDef(kind: SceneryKind): SceneryDef {
  return SCENERY_MAP.get(kind) ?? SCENERY[0];
}

/**
 * Scenery is authored big and readable, then normalised here to sit beside ~120-unit characters.
 * Change this one number to re-balance every location in the studio.
 */
export const SCENERY_UNIT: number = 0.62;

/**
 * Built geometry is cached per object identity + frame. The store clones the scene on every edit,
 * so an edited object is a new object and simply misses the cache — no invalidation bookkeeping.
 * (Playback and exports redraw every frame, and rebuilding a forest each time is wasted work.)
 */
const geometryCache = new WeakMap<SceneObject, Map<number, GeomPart[]>>();
const CACHE_FRAMES = 12;

/** Resolve an object's palette-aware geometry. Deterministic for a given object + frame. */
export function buildObject(obj: SceneObject, scene: Scene, frame = 0): GeomPart[] {
  const def = sceneryDef(obj.kind);
  const role: RoleKey = obj.role ?? def.role;
  const main = obj.color ?? scene.palette[role] ?? "#9aa4c0";
  const seed = (obj.seed ?? 1) * 2654435761 + hashString(obj.id + obj.kind);
  const ctx: BuildCtx = {
    obj,
    scene,
    rng: makeRng(seed),
    main,
    second: obj.color2 ?? DARK(main),
    frame,
  };
  const parts = def.build(ctx);
  const scaled = SCENERY_UNIT === 1 ? parts : parts.map((part) => ({ ...part, pts: part.pts.map((p) => ({ x: p.x * SCENERY_UNIT, y: p.y * SCENERY_UNIT })) }));
  let byFrame = geometryCache.get(obj);
  if (!byFrame) {
    byFrame = new Map();
    geometryCache.set(obj, byFrame);
  }
  if (byFrame.size >= CACHE_FRAMES) {
    const oldest = byFrame.keys().next().value;
    if (oldest != null) byFrame.delete(oldest);
  }
  byFrame.set(frame, scaled);
  return scaled;
}

/* --------------------------------------------------------------- lights */

export interface LightDef {
  id: LightKind;
  label: string;
  hint: string;
  color: string;
  intensity: number;
  radius: number;
  flicker?: number;
  angle?: number;
  spread?: number;
}

export const LIGHTS: LightDef[] = [
  { id: "sun", label: "Daylight", hint: "Warm key light for the whole scene", color: "#ffd9a0", intensity: 0.5, radius: 900 },
  { id: "moon", label: "Moonlight", hint: "Cool, low — pairs with a dark palette", color: "#9fc4ff", intensity: 0.42, radius: 900 },
  { id: "warm", label: "Warm lamp", hint: "Torch, window light, firelight", color: "#ffb35c", intensity: 0.75, radius: 240, flicker: 0.08 },
  { id: "cool", label: "Cool fill", hint: "Blue rim, underwater, night window", color: "#6cc6ff", intensity: 0.6, radius: 220 },
  { id: "spot", label: "Spotlight", hint: "Conical stage light you can aim", color: "#ffd9ee", intensity: 0.85, radius: 420, angle: -1.2, spread: 0.35 },
  { id: "fire", label: "Fire", hint: "Strong flicker — campfires and explosions", color: "#ff8a3c", intensity: 1, radius: 260, flicker: 0.22 },
  { id: "glow", label: "Glow", hint: "Magic, fireflies, screens", color: "#a6ffdd", intensity: 0.7, radius: 160, flicker: 0.04 },
];

export const LIGHT_MAP = new Map(LIGHTS.map((l) => [l.id, l]));

export const lightDef = (kind: LightKind): LightDef => LIGHT_MAP.get(kind) ?? LIGHTS[0];

export function makeLight(kind: LightKind, x: number, y: number): Light {
  const d = lightDef(kind);
  return {
    id: `L${Math.random().toString(36).slice(2, 7)}`,
    name: d.label,
    kind,
    x,
    y,
    color: d.color,
    intensity: d.intensity,
    radius: d.radius,
    flicker: d.flicker,
    angle: d.angle,
    spread: d.spread,
    follow: null,
    visible: true,
  };
}

export function makeObject(kind: SceneryKind, x: number, y: number, seed = 1): SceneObject {
  const def = sceneryDef(kind);
  return {
    id: `O${Math.random().toString(36).slice(2, 7)}`,
    name: def.label,
    kind,
    x,
    y,
    scale: 1,
    rot: 0,
    z: def.z,
    visible: true,
    seed,
  };
}
