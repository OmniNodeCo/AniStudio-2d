/**
 * Part library — the "drag a component onto a bone" bit.
 *
 * Every part is a polygon generator in **bone space**: the bone's joint sits at (0,0) and
 * its tip at (len,0). That means a limb part automatically fits the bone it is dropped on,
 * and re-fits when the bone is resized.
 */
import { TAU, type Vec } from "./math";
import type { RoleKey } from "./types";

export interface PartCtx {
  /** Bone length in scene units. */
  len: number;
}

export interface PartDef {
  id: string;
  label: string;
  group: "body" | "limb" | "head" | "prop" | "fx";
  role: RoleKey;
  /** Which part of the bone the shape hugs (used for hints and re-fitting). */
  anchor: "start" | "end" | "center";
  sharp?: boolean;
  build: (c: PartCtx) => Vec[];
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

/** Tapered tube along +x from 0 to len — the workhorse for arms, legs, tails and necks. */
function limb(len: number, w0: number, w1: number, seg = 4): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push({ x: len * t, y: -(w0 + (w1 - w0) * t) });
  }
  for (let i = seg; i >= 0; i--) {
    const t = i / seg;
    pts.push({ x: len * t, y: w0 + (w1 - w0) * t });
  }
  return pts;
}

function poly(...pairs: number[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push({ x: pairs[i], y: pairs[i + 1] });
  return out;
}

const m = (len: number, k: number) => len * k;

export const PARTS: PartDef[] = [
  /* ------------------------------------------------------------ body */
  {
    id: "torso",
    label: "Torso",
    group: "body",
    role: "cloth",
    anchor: "start",
    build: ({ len }) =>
      poly(0, -m(len, 0.36), len * 0.9, -m(len, 0.44), len, -m(len, 0.3), len, m(len, 0.3), len * 0.9, m(len, 0.46), 0, m(len, 0.4)),
  },
  {
    id: "belly",
    label: "Belly",
    group: "body",
    role: "white",
    anchor: "start",
    build: ({ len }) => blob(len * 0.5, 0, m(len, 0.32), m(len, 0.22)),
  },
  {
    id: "chest",
    label: "Chest plate",
    group: "body",
    role: "cloth2",
    anchor: "start",
    build: ({ len }) => poly(0, -m(len, 0.4), len * 0.62, -m(len, 0.46), len * 0.7, m(len, 0.44), 0, m(len, 0.42)),
  },
  {
    id: "neck",
    label: "Neck",
    group: "body",
    role: "skin",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.16), m(len, 0.19)),
  },
  {
    id: "hipbox",
    label: "Hip box",
    group: "body",
    role: "cloth2",
    anchor: "start",
    build: ({ len }) => blob(0, 0, m(len, 0.36), m(len, 0.26)),
  },
  {
    id: "shell",
    label: "Shell",
    group: "body",
    role: "cloth",
    anchor: "center",
    build: ({ len }) => blob(len * 0.1, -m(len, 0.1), m(len, 0.78), m(len, 0.56), 18, 0.06),
  },

  /* ----------------------------------------------------------- limbs */
  {
    id: "upperArm",
    label: "Upper arm",
    group: "limb",
    role: "skin",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.18), m(len, 0.15)),
  },
  {
    id: "foreArm",
    label: "Forearm",
    group: "limb",
    role: "skin",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.15), m(len, 0.12)),
  },
  {
    id: "sleeve",
    label: "Sleeve",
    group: "limb",
    role: "cloth",
    anchor: "start",
    build: ({ len }) => limb(len * 0.6, m(len, 0.23), m(len, 0.2)),
  },
  {
    id: "hand",
    label: "Hand",
    group: "limb",
    role: "skin",
    anchor: "end",
    build: ({ len }) => blob(len, 0, m(len, 0.28), m(len, 0.26)),
  },
  {
    id: "mitten",
    label: "Mitt",
    group: "limb",
    role: "skin",
    anchor: "end",
    build: ({ len }) =>
      poly(len - m(len, 0.3), -m(len, 0.2), len + m(len, 0.26), -m(len, 0.16), len + m(len, 0.32), m(len, 0.1), len - m(len, 0.26), m(len, 0.22)),
  },
  {
    id: "thigh",
    label: "Thigh",
    group: "limb",
    role: "cloth2",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.23), m(len, 0.18)),
  },
  {
    id: "shin",
    label: "Shin",
    group: "limb",
    role: "cloth2",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.18), m(len, 0.13)),
  },
  {
    id: "foot",
    label: "Foot",
    group: "limb",
    role: "shoe",
    anchor: "end",
    build: ({ len }) => poly(len - m(len, 0.18), -m(len, 0.18), len + m(len, 0.4), -m(len, 0.12), len + m(len, 0.44), m(len, 0.2), len - m(len, 0.2), m(len, 0.2)),
  },
  {
    id: "paw",
    label: "Paw",
    group: "limb",
    role: "skin",
    anchor: "end",
    build: ({ len }) => blob(len + m(len, 0.08), 0, m(len, 0.32), m(len, 0.22)),
  },
  {
    id: "hoof",
    label: "Hoof",
    group: "limb",
    role: "dark",
    anchor: "end",
    sharp: true,
    build: ({ len }) => poly(len - m(len, 0.16), -m(len, 0.18), len + m(len, 0.22), -m(len, 0.2), len + m(len, 0.24), m(len, 0.18), len - m(len, 0.16), m(len, 0.18)),
  },
  {
    id: "wing",
    label: "Wing",
    group: "limb",
    role: "accent",
    anchor: "start",
    build: ({ len }) =>
      poly(0, -m(len, 0.1), len * 0.55, -m(len, 0.85), len, -m(len, 0.36), len * 0.82, m(len, 0.04), len * 0.35, m(len, 0.18), 0, m(len, 0.14)),
  },
  {
    id: "tail",
    label: "Tail",
    group: "limb",
    role: "skin",
    anchor: "start",
    build: ({ len }) => limb(len, m(len, 0.2), m(len, 0.04)),
  },
  {
    id: "tailTuft",
    label: "Tail tuft",
    group: "limb",
    role: "hair",
    anchor: "end",
    build: ({ len }) => poly(len - m(len, 0.2), -m(len, 0.24), len + m(len, 0.55), -m(len, 0.1), len + m(len, 0.46), m(len, 0.26), len - m(len, 0.16), m(len, 0.2)),
  },

  /* ------------------------------------------------------------ head */
  {
    id: "head",
    label: "Head",
    group: "head",
    role: "skin",
    anchor: "start",
    build: ({ len }) => blob(len * 0.55, -m(len, 0.12), m(len, 0.66), m(len, 0.58), 18, 0.04),
  },
  {
    id: "snout",
    label: "Snout",
    group: "head",
    role: "skin",
    anchor: "start",
    build: ({ len }) => poly(0, -m(len, 0.22), len * 1.05, -m(len, 0.16), len * 1.12, m(len, 0.16), 0, m(len, 0.26)),
  },
  {
    id: "jaw",
    label: "Jaw",
    group: "head",
    role: "skin",
    anchor: "start",
    build: ({ len }) => poly(0, -m(len, 0.06), len * 0.8, m(len, 0.02), len * 0.74, m(len, 0.3), 0, m(len, 0.26)),
  },
  {
    id: "ear",
    label: "Ear",
    group: "head",
    role: "skin",
    anchor: "start",
    build: ({ len }) => poly(0, 0, len * 0.22, -len, len * 0.66, -m(len, 0.2)),
  },
  {
    id: "horn",
    label: "Horn",
    group: "head",
    role: "accent",
    anchor: "start",
    sharp: true,
    build: ({ len }) => poly(0, -m(len, 0.22), len * 0.95, -m(len, 0.36), len * 0.22, m(len, 0.2)),
  },
  {
    id: "eye",
    label: "Eye white",
    group: "head",
    role: "white",
    anchor: "center",
    build: ({ len }) => blob(0, 0, m(len, 0.22), m(len, 0.26)),
  },
  {
    id: "pupil",
    label: "Pupil",
    group: "head",
    role: "eye",
    anchor: "center",
    build: ({ len }) => blob(0, 0, m(len, 0.1), m(len, 0.13)),
  },
  {
    id: "hairSpike",
    label: "Hair tuft",
    group: "head",
    role: "hair",
    anchor: "start",
    build: ({ len }) =>
      poly(-m(len, 0.5), m(len, 0.1), -m(len, 0.2), -m(len, 0.6), m(len, 0.15), -m(len, 0.15), m(len, 0.5), -m(len, 0.75), m(len, 0.7), m(len, 0.05)),
  },
  {
    id: "mouth",
    label: "Smile",
    group: "head",
    role: "dark",
    anchor: "center",
    build: ({ len }) => poly(-m(len, 0.2), 0, m(len, 0.2), 0, m(len, 0.12), m(len, 0.16), -m(len, 0.12), m(len, 0.16)),
  },

  /* ----------------------------------------------------------- props */
  {
    id: "sword",
    label: "Sword",
    group: "prop",
    role: "cloth2",
    anchor: "end",
    sharp: true,
    build: ({ len }) =>
      poly(len - m(len, 0.1), -m(len, 0.1), len + m(len, 1.4), -m(len, 0.06), len + m(len, 1.55), 0, len + m(len, 1.4), m(len, 0.06), len - m(len, 0.1), m(len, 0.1)),
  },
  {
    id: "shield",
    label: "Shield",
    group: "prop",
    role: "accent",
    anchor: "end",
    build: ({ len }) => poly(len - m(len, 0.1), -m(len, 0.52), len + m(len, 0.46), -m(len, 0.36), len + m(len, 0.42), m(len, 0.34), len - m(len, 0.1), m(len, 0.5)),
  },
  {
    id: "hat",
    label: "Hat",
    group: "prop",
    role: "cloth2",
    anchor: "center",
    build: ({ len }) => poly(-m(len, 0.55), 0, m(len, 0.55), 0, m(len, 0.36), -m(len, 0.7), -m(len, 0.32), -m(len, 0.66)),
  },
  {
    id: "cape",
    label: "Cape",
    group: "prop",
    role: "accent",
    anchor: "start",
    build: ({ len }) => poly(0, -m(len, 0.2), -len * 0.2, len * 0.9, -len * 0.7, len * 1.5, -len, m(len, 0.7), -len * 0.6, -m(len, 0.2)),
  },
  {
    id: "rectPanel",
    label: "Panel",
    group: "prop",
    role: "cloth2",
    anchor: "start",
    sharp: true,
    build: ({ len }) => poly(0, -len * 0.34, len, -len * 0.38, len, len * 0.38, 0, len * 0.34),
  },
  {
    id: "ball",
    label: "Ball",
    group: "prop",
    role: "accent",
    anchor: "center",
    build: ({ len }) => blob(0, 0, m(len, 0.55), m(len, 0.55), 16),
  },
  {
    id: "spark",
    label: "Spark",
    group: "fx",
    role: "accent",
    anchor: "center",
    sharp: true,
    build: ({ len }) => {
      const pts: Vec[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const r = i % 2 === 0 ? m(len, 0.55) : m(len, 0.2);
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return pts;
    },
  },
  {
    id: "dust",
    label: "Dust puff",
    group: "fx",
    role: "white",
    anchor: "center",
    build: ({ len }) => blob(0, 0, m(len, 0.5), m(len, 0.34), 12, 0.16),
  },
];

export const PART_MAP = new Map(PARTS.map((p) => [p.id, p]));

export function buildPart(kind: string, len: number): Vec[] {
  const def = PART_MAP.get(kind);
  if (!def) return limb(len, m(len, 0.18), m(len, 0.14));
  return def.build({ len });
}

export function partDef(kind?: string): PartDef | undefined {
  return kind ? PART_MAP.get(kind) : undefined;
}

/** Shape-drawing tool helpers. */
export function ellipsePath(rx: number, ry: number, seg = 18): Vec[] {
  return blob(0, 0, rx, ry, seg);
}

export function rectPath(w: number, h: number): Vec[] {
  return poly(-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2);
}

export function starPath(r: number, points = 5, inner = 0.45): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  return pts;
}

export function translatePts(pts: Vec[], d: Vec): Vec[] {
  return pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
}

function centroidOf(pts: Vec[]): Vec {
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function rotatePts(pts: Vec[], ang: number): Vec[] {
  const c = centroidOf(pts);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  });
}

export function scalePts(pts: Vec[], s: number): Vec[] {
  const c = centroidOf(pts);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s }));
}

/** Flip a polygon horizontally — handy for mirroring a part onto the other side. */
export function flipPtsX(pts: Vec[], about = 0): Vec[] {
  return pts.map((p) => ({ x: 2 * about - p.x, y: p.y }));
}

export const PART_GROUPS: { id: string; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "limb", label: "Limbs" },
  { id: "head", label: "Head" },
  { id: "prop", label: "Props" },
  { id: "fx", label: "FX" },
];
