/**
 * Pose-editing helpers shared by the canvas tools and the store: turning a drag into
 * bone rotations (FK or IK), mirroring, and baking the result into keyframes.
 */
import { angleOf, clamp, dist, sub, wrapPi, type Vec } from "./math";
import { type RigPose } from "./fk";
import { clampToReach, mirrorPoint, mirrorRot, solveChain } from "./ik";
import { indexScene, poseRotations, setPosKey, setRotKey } from "./rig";
import type { IKChain, Scene } from "./types";

export interface ChainFrame {
  current: Vec[];
  parentAng: number;
  reach: number;
}

export function chainFrame(scene: Scene, pose: RigPose, chain: IKChain): ChainFrame {
  const idx = indexScene(scene);
  const pts: Vec[] = chain.bones.map((id) => pose.pos[id] ?? { x: 0, y: 0 });
  const lastId = chain.bones[chain.bones.length - 1];
  pts.push(pose.end[lastId] ?? pts[pts.length - 1]);
  const parent = idx.byId.get(chain.bones[0])?.parent;
  const parentAng = parent ? pose.ang[parent] ?? 0 : 0;
  const reach = chain.bones.reduce((a, id) => a + (idx.byId.get(id)?.length ?? 0), 0);
  return { current: pts, parentAng, reach };
}

/** Solve an IK chain to a target (world) and return local rotations for its bones. */
export function solveTo(
  scene: Scene,
  pose: RigPose,
  chain: IKChain,
  targetWorld: Vec,
  poleWorld?: Vec | null,
): Record<string, number> {
  const cf = chainFrame(scene, pose, chain);
  const root = cf.current[0];
  const target = clampToReach(root, targetWorld, cf.reach * 0.999, Math.max(4, cf.reach * 0.06));
  const res = solveChain(scene, chain.bones, { target, pole: poleWorld ?? null, current: cf.current, parentAng: cf.parentAng });
  return res.rot;
}

/** Rotate a single bone so it points at `worldPoint`. */
export function rotAimAt(scene: Scene, pose: RigPose, boneId: string, worldPoint: Vec): number {
  const idx = indexScene(scene);
  const b = idx.byId.get(boneId);
  if (!b) return 0;
  const origin = pose.pos[boneId] ?? { x: 0, y: 0 };
  const parentAng = b.parent ? pose.ang[b.parent] ?? 0 : 0;
  const want = angleOf(sub(worldPoint, origin));
  const raw = wrapPi(want - parentAng - b.rest);
  return clamp(raw, b.min ?? -Infinity, b.max ?? Infinity);
}

export const reachOf = (scene: Scene, chain: IKChain): number =>
  chain.bones.reduce((a, id) => a + (indexScene(scene).byId.get(id)?.length ?? 0), 0);

export const targetOf = (scene: Scene, pose: RigPose, chain: IKChain): Vec => {
  const last = chain.bones[chain.bones.length - 1];
  return pose.end[last] ?? pose.pos[last] ?? { ...pose.root };
};

/** Mirror a rotation map across the rig's vertical axis (hips x by default). */
export function mirrorRots(scene: Scene, rots: Record<string, number>, axisX?: number): Record<string, number> {
  const idx = indexScene(scene);
  const out: Record<string, number> = {};
  for (const [id, r] of Object.entries(rots)) {
    const b = idx.byId.get(id);
    if (!b?.mirror) continue;
    if (out[b.mirror] != null) continue;
    out[b.mirror] = mirrorRot(r);
  }
  void axisX;
  return out;
}

export function mirrorChains(scene: Scene, chainId: string): IKChain | null {
  const c = scene.chains.find((x) => x.id === chainId);
  if (!c?.mirror) return null;
  return scene.chains.find((x) => x.id === c.mirror) ?? null;
}

export function mirrorAxis(scene: Scene, pose: RigPose): number {
  const root = indexScene(scene).roots[0];
  return root ? pose.pos[root.id]?.x ?? scene.root.x : scene.root.x;
}

/** Snapshot of the whole rig's local rotations at a frame (what a "pose" is). */
export function snapshotPose(scene: Scene, frame: number): Record<string, number> {
  return poseRotations(scene, frame);
}

export function applyPoseToScene(scene: Scene, rots: Record<string, number>, frame: number): void {
  for (const [id, r] of Object.entries(rots)) setRotKey(scene, id, frame, r);
}

export function applyRootToScene(scene: Scene, pos: Vec, frame: number): void {
  const root = indexScene(scene).roots[0];
  if (root) setPosKey(scene, root.id, frame, { x: pos.x - scene.root.x, y: pos.y - scene.root.y });
}

export const poleFor = (scene: Scene, pose: RigPose, chain: IKChain): Vec | null => {
  if (!chain.pole || chain.bones.length < 2) return null;
  void scene;
  const root = pose.pos[chain.bones[0]];
  const mid = pose.pos[chain.bones[1]];
  const last = chain.bones[chain.bones.length - 1];
  const tip = pose.end[last];
  if (!root || !mid || !tip) return null;
  // Remember the current bend, so moving the hand doesn't suddenly swap elbows.
  return { ...mid };
};

export const mirroredTarget = (p: Vec, axisX: number): Vec => mirrorPoint(p, axisX);

/** Distance from the current end effector to a candidate target — used for snapping. */
export const reachDelta = (a: Vec, b: Vec): number => dist(a, b);

/** Centroid of a world-space polygon (used to pick the bone a drawn shape belongs to). */
export function centroid(pts: Vec[]): Vec {
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Closest bone (by joint or segment) to a world point — used by drop-to-attach and drawing. */
export function nearestBoneTo(scene: Scene, pose: { pos: Record<string, Vec>; end: Record<string, Vec> }, p: Vec): string | null {
  const idx = indexScene(scene);
  let best: { id: string; d: number } | null = null;
  for (const b of idx.order) {
    const a = pose.pos[b.id];
    const e = pose.end[b.id];
    if (!a || !e) continue;
    const d = Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - e.x, p.y - e.y), distToSegSq(p, a, e) ** 0.5);
    if (!best || d < best.d) best = { id: b.id, d };
  }
  return best?.id ?? null;
}

function distToSegSq(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  const dx = a.x + vx * t - p.x;
  const dy = a.y + vy * t - p.y;
  return dx * dx + dy * dy;
}
