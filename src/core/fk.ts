import { dirOf, wrapPi, type Vec } from "./math";
import { indexScene, rootPosAtFrame } from "./rig";
import type { Scene, ShapePart } from "./types";

/** Solved skeleton: every bone's joint position, world direction and tip. */
export interface RigPose {
  pos: Record<string, Vec>;
  ang: Record<string, number>;
  end: Record<string, Vec>;
  root: Vec;
  /** Rotation of the whole character at its anchor (scene.rootRot). */
  body: number;
}

export function solveFK(scene: Scene, rots: Record<string, number>, frame = 0, root?: Vec): RigPose {
  const idx = indexScene(scene);
  const origin = root ?? rootPosAtFrame(scene, frame);
  // The character's own rotation is applied at the root joint, so every child inherits it.
  const body = scene.rootRot ?? 0;
  const pos: Record<string, Vec> = {};
  const ang: Record<string, number> = {};
  const end: Record<string, Vec> = {};
  for (const b of idx.order) {
    const rot = rots[b.id] ?? 0;
    if (!b.parent) {
      pos[b.id] = { x: origin.x, y: origin.y };
      ang[b.id] = body + b.rest + rot;
    } else {
      const p = idx.byId.get(b.parent);
      if (!p) {
        pos[b.id] = { ...origin };
        ang[b.id] = body + b.rest + rot;
      } else {
        const pa = ang[p.id];
        pos[b.id] = { x: end[p.id].x, y: end[p.id].y };
        ang[b.id] = pa + b.rest + rot;
      }
    }
    end[b.id] = { x: pos[b.id].x + Math.cos(ang[b.id]) * b.length, y: pos[b.id].y + Math.sin(ang[b.id]) * b.length };
  }
  return { pos, ang, end, root: origin, body };
}

/** Local-space point → world point using a bone's solved transform. */
export function boneToWorld(p: Vec, pose: RigPose, boneId: string): Vec {
  const a = pose.ang[boneId] ?? 0;
  const o = pose.pos[boneId] ?? { x: 0, y: 0 };
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: o.x + p.x * c - p.y * s, y: o.y + p.x * s + p.y * c };
}

export function worldToBone(p: Vec, pose: RigPose, boneId: string): Vec {
  const a = -(pose.ang[boneId] ?? 0);
  const o = pose.pos[boneId] ?? { x: 0, y: 0 };
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function shapeWorldPoints(shape: ShapePart, pose: RigPose): Vec[] {
  return shape.pts.map((p) => boneToWorld(p, pose, shape.bone));
}

/** World-space position of a chain's end effector (tip of the last bone). */
export function chainTip(scene: Scene, pose: RigPose, boneIds: string[]): Vec {
  const last = boneIds[boneIds.length - 1];
  return pose.end[last] ?? { ...pose.root };
}

/** Angle a bone must have in world space, expressed as a local rotation. */
export function localRotFor(parentAng: number | undefined, rest: number, worldAng: number): number {
  return wrapPi(worldAng - (parentAng ?? 0) - rest);
}

export const jointDir = (ang: number, r: number): Vec => dirOf(ang, r);
