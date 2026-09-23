/**
 * Inverse kinematics for authoring.
 *
 *  - `solveTwoBone` : closed-form 2-joint limb (arm / leg) with an optional pole target
 *                     that decides which way the elbow / knee bends.
 *  - `solveFabrik`  : general multi-bone solver (FABRIK + joint limits) for tails, spines,
 *                     necks and tentacles.
 *
 * Solving returns *local rotations* for the bones in the chain, which the studio bakes into
 * keyframes — so playback/export is plain FK and needs no solver at runtime.
 */
import { add, clamp, dist, norm, scale, sub, wrapPi, type Vec } from "./math";
import { indexScene } from "./rig";
import type { Scene } from "./types";

export interface ChainBone {
  id: string;
  length: number;
  rest: number;
  /** Rotation limits in radians, relative to rest. */
  min: number;
  max: number;
}

const OPEN = Math.PI * 0.995;

export function chainBones(scene: Scene, ids: string[]): ChainBone[] {
  const idx = indexScene(scene);
  return ids.map((id) => {
    const b = idx.byId.get(id);
    return {
      id,
      length: b?.length ?? 10,
      rest: b?.rest ?? 0,
      min: b?.min ?? -OPEN,
      max: b?.max ?? OPEN,
    };
  });
}

/** Desired world angle → clamped local rotation (relative to rest). */
export const toRot = (world: number, parentWorld: number, b: ChainBone): number =>
  clamp(wrapPi(world - parentWorld - b.rest), b.min, b.max);

export const toWorld = (parentWorld: number, b: ChainBone, rot: number): number => parentWorld + b.rest + rot;

export interface SolveResult {
  /** New local rotations for the chain bones. */
  rot: Record<string, number>;
  /** Solved joint positions, root → tip (length = bones + 1). */
  pts: Vec[];
  /** False when the target was out of reach (chain is fully extended). */
  reached: boolean;
  /** Distance from the solved tip to the target — used to pick a bend side that survives limits. */
  err?: number;
}

export function solveTwoBone(opts: {
  root: Vec;
  parentAng: number;
  bones: [ChainBone, ChainBone];
  target: Vec;
  pole?: Vec | null;
}): SolveResult {
  const { root, parentAng, bones, target, pole } = opts;
  const [b1, b2] = bones;
  const l1 = Math.max(1e-3, b1.length);
  const l2 = Math.max(1e-3, b2.length);
  const dir = sub(target, root);
  const raw = Math.hypot(dir.x, dir.y);
  const d = clamp(raw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const reached = raw <= l1 + l2 - 0.5 && raw >= Math.abs(l1 - l2) + 0.5;
  const ux = raw < 1e-6 ? 1 : dir.x / raw;
  const uy = raw < 1e-6 ? 0 : dir.y / raw;
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const mx = root.x + ux * along;
  const my = root.y + uy * along;
  const nx = -uy;
  const ny = ux;
  // Which way the joint currently bends (pole target), else default to the +normal side.
  const to = sub(pole ?? { x: mx + nx, y: my + ny }, { x: mx, y: my });
  const poleSide = to.x * nx + to.y * ny >= 0 ? 1 : -1;

  /** Closed-form solution for one bend side, then clamped to the joint limits. */
  const build = (sign: number): SolveResult => {
    const mid = { x: mx + nx * h * sign, y: my + ny * h * sign };
    const a1 = Math.atan2(mid.y - root.y, mid.x - root.x);
    const r1 = toRot(a1, parentAng, b1);
    const w1 = toWorld(parentAng, b1, r1);
    // Aim the second bone from the *clamped* elbow, so limits never leave the tip dangling.
    const midC = { x: root.x + Math.cos(w1) * l1, y: root.y + Math.sin(w1) * l1 };
    const a2 = Math.atan2(target.y - midC.y, target.x - midC.x);
    const r2 = toRot(a2, w1, b2);
    const w2 = toWorld(w1, b2, r2);
    const tipC = { x: midC.x + Math.cos(w2) * l2, y: midC.y + Math.sin(w2) * l2 };
    return {
      rot: { [b1.id]: r1, [b2.id]: r2 },
      pts: [root, midC, tipC],
      reached,
      err: dist(tipC, target),
    } as SolveResult & { err: number };
  };

  const wantPole = build(poleSide);
  if (wantPole.err! <= 0.6) return wantPole;
  // The remembered bend is blocked by a limit here (common when you swing a foot up:
  // the knee has to swap sides to keep the foot attached). Take whichever side lands closer.
  const other = build(-poleSide);
  return other.err! < wantPole.err! - 0.6 ? other : wantPole;
}

/** FABRIK with joint limits. Seeded from `initPts` so existing bends are respected. */
export function solveFabrik(opts: {
  root: Vec;
  parentAng: number;
  bones: ChainBone[];
  target: Vec;
  initPts: Vec[];
  iterations?: number;
  tolerance?: number;
}): SolveResult {
  const { root, parentAng, bones, target, initPts } = opts;
  const n = bones.length;
  const iters = opts.iterations ?? 30;
  const tol = opts.tolerance ?? 0.35;

  /** World angles → local rotations, each clamped to its limits. */
  const rotationsFrom = (pts: Vec[]): number[] => {
    let parent = parentAng;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const want = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
      const r = toRot(want, parent, bones[i]);
      out.push(r);
      parent = toWorld(parent, bones[i], r);
    }
    return out;
  };

  const layout = (rots: number[]): Vec[] => {
    const pts: Vec[] = [{ ...root }];
    let parent = parentAng;
    for (let i = 0; i < n; i++) {
      const w = toWorld(parent, bones[i], rots[i]);
      const prev = pts[i];
      pts.push({ x: prev.x + Math.cos(w) * bones[i].length, y: prev.y + Math.sin(w) * bones[i].length });
      parent = w;
    }
    return pts;
  };

  const solveFrom = (seedPts: Vec[]) => {
    const pts: Vec[] = [];
    for (let i = 0; i <= n; i++) pts.push(seedPts[i] ? { ...seedPts[i] } : { ...root });
    let rots = rotationsFrom(pts);
    for (let it = 0; it < iters; it++) {
      // Backward pass: plant the tip, walk back toward the root.
      pts[n] = { ...target };
      for (let i = n - 1; i >= 0; i--) {
        const dir = norm(sub(pts[i], pts[i + 1]));
        pts[i] = add(pts[i + 1], scale(dir, bones[i].length));
      }
      pts[0] = { ...root };
      // Forward pass with limits: re-place each joint from the clamped parent rotation.
      rots = rotationsFrom(pts);
      const laid = layout(rots);
      for (let i = 0; i <= n; i++) pts[i] = laid[i];
      if (dist(pts[n], target) <= tol) break;
    }
    return { rots, pts, err: dist(layout(rots)[n], target) };
  };

  let best = solveFrom(initPts);
  if (best.err > tol * 6) {
    // The seeded bend can be trapped by joint limits. Restart from "every bone aimed at the
    // target" and keep whichever result actually gets closer.
    const seed: Vec[] = [{ ...root }];
    let cur = { ...root };
    let parent = parentAng;
    for (let i = 0; i < n; i++) {
      const want = Math.atan2(target.y - cur.y, target.x - cur.x);
      const r = toRot(want, parent, bones[i]);
      const w = toWorld(parent, bones[i], r);
      cur = { x: cur.x + Math.cos(w) * bones[i].length, y: cur.y + Math.sin(w) * bones[i].length };
      seed.push(cur);
      parent = w;
    }
    const alt = solveFrom(seed);
    if (alt.err < best.err - 0.5) best = alt;
  }

  const rot: Record<string, number> = {};
  bones.forEach((b, i) => (rot[b.id] = best.rots[i]));
  return { rot, pts: layout(best.rots), reached: best.err <= tol, err: best.err };
}

export interface ChainSolveInput {
  target: Vec;
  pole?: Vec | null;
  /** Current world joint positions of the chain (root … tip). */
  current: Vec[];
  /** World angle of the bone above the chain (0 for a root chain). */
  parentAng: number;
}

/** Solve any chain length, dispatching to the right algorithm. */
export function solveChain(scene: Scene, boneIds: string[], input: ChainSolveInput): SolveResult {
  const bones = chainBones(scene, boneIds);
  const root = input.current[0] ?? { x: 0, y: 0 };
  if (bones.length === 1) {
    const b = bones[0];
    const want = Math.atan2(input.target.y - root.y, input.target.x - root.x);
    const r = toRot(want, input.parentAng, b);
    const w = toWorld(input.parentAng, b, r);
    const tip = { x: root.x + Math.cos(w) * b.length, y: root.y + Math.sin(w) * b.length };
    return { rot: { [b.id]: r }, pts: [root, tip], reached: dist(tip, input.target) < 1.5 };
  }
  if (bones.length === 2) {
    return solveTwoBone({
      root,
      parentAng: input.parentAng,
      bones: [bones[0], bones[1]] as [ChainBone, ChainBone],
      target: input.target,
      pole: input.pole ?? null,
    });
  }
  return solveFabrik({
    root,
    parentAng: input.parentAng,
    bones,
    target: input.target,
    initPts: input.current,
  });
}

/** Where the pole (elbow / knee) handle sits for the current pose. */
export function poleHandle(root: Vec, mid: Vec, tip: Vec): Vec {
  const base = { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 };
  let out = sub(mid, base);
  if (Math.hypot(out.x, out.y) < 0.75) {
    // Nearly straight limb: fall back to the perpendicular so the handle never jumps around.
    const dir = norm(sub(tip, root));
    out = { x: -dir.y, y: dir.x };
  } else {
    out = norm(out);
  }
  const off = Math.max(14, dist(root, tip) * 0.13);
  return add(mid, scale(out, off));
}

export const mirrorPoint = (p: Vec, axisX: number): Vec => ({ x: 2 * axisX - p.x, y: p.y });
export const mirrorRot = (r: number): number => wrapPi(-r);

/** Clamp a target to the chain's reach — keeps limbs from stretching when you overdrag. */
export function clampToReach(root: Vec, target: Vec, reach: number, min = 0): Vec {
  const d = sub(target, root);
  const l = Math.hypot(d.x, d.y);
  if (l <= reach && l >= min) return target;
  const t = clamp(l, Math.max(min, 1e-3), reach);
  const inv = l < 1e-6 ? 0 : t / l;
  return { x: root.x + d.x * inv, y: root.y + d.y * inv };
}
