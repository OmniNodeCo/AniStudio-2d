import { distToPolyline, pointInPolygon, type Vec } from "./math";
import { shapeWorldPoints, type RigPose } from "./fk";
import { poleHandle } from "./ik";
import { indexScene } from "./rig";
import type { Scene } from "./types";
import type { View } from "./render";

export type Hit =
  | { kind: "ik"; chain: string }
  | { kind: "pole"; chain: string }
  | { kind: "joint"; bone: string }
  | { kind: "tip"; bone: string }
  | { kind: "root"; bone: string }
  | { kind: "shape"; shape: string; bone: string }
  | { kind: "bone"; bone: string };

export interface HitOpts {
  /** Test IK / pole handles. */
  handles: boolean;
  /** Test shape polygons (art mode & pose mode). */
  parts: boolean;
  /** Prefer parts over joints (art mode). */
  partsFirst: boolean;
  /** Ignore which chain is dragged, e.g. only the selected one. */
  chains?: string[];
}

export function hitTest(scene: Scene, pose: RigPose, view: View, p: Vec, o: HitOpts): Hit | null {
  const px = (r: number) => r / view.cam.zoom;
  const idx = indexScene(scene);

  const testParts = (): Hit | null => {
    const shapes = scene.shapes.filter((s) => s.visible).sort((a, b) => b.z - a.z);
    for (const s of shapes) {
      const pts = shapeWorldPoints(s, pose);
      if (pts.length < 2) continue;
      if (s.closed && pointInPolygon(p, pts)) return { kind: "shape", shape: s.id, bone: s.bone };
      if (pts.length > 1 && distToPolyline(p, pts) < px(5)) return { kind: "shape", shape: s.id, bone: s.bone };
    }
    return null;
  };

  const testHandles = (): Hit | null => {
    if (!o.handles) return null;
    for (const chain of scene.chains) {
      if (!chain.show) continue;
      if (o.chains && !o.chains.includes(chain.id)) continue;
      const tipId = chain.bones[chain.bones.length - 1];
      const tip = pose.end[tipId];
      const root = pose.pos[chain.bones[0]];
      if (tip && Math.hypot(tip.x - p.x, tip.y - p.y) < px(15)) {
        return { kind: "ik", chain: chain.id };
      }
      if (chain.pole && root && chain.bones.length >= 2) {
        const mid = pose.pos[chain.bones[1]];
        if (mid) {
          const h = poleHandle(root, mid, tip ?? mid);
          if (Math.hypot(h.x - p.x, h.y - p.y) < px(13)) return { kind: "pole", chain: chain.id };
        }
      }
    }
    return null;
  };

  const testJoints = (): Hit | null => {
    let bestTip: { hit: Hit; d: number } | null = null;
    let bestJoint: { hit: Hit; d: number } | null = null;
    for (const b of idx.order) {
      const isRoot = !b.parent;
      const j = pose.pos[b.id];
      const t = pose.end[b.id];
      if (j) {
        const d = Math.hypot(j.x - p.x, j.y - p.y);
        if (d < px(11)) {
          const hit: Hit = isRoot ? { kind: "root", bone: b.id } : { kind: "joint", bone: b.id };
          if (!bestJoint || d < bestJoint.d) bestJoint = { hit, d };
        }
      }
      if (t) {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        const inChain = b.chain && scene.chains.some((c) => c.id === b.chain && c.show);
        if (d < px(inChain ? 4 : 11) && !inChain) {
          const hit: Hit = { kind: "tip", bone: b.id };
          if (!bestTip || d < bestTip.d) bestTip = { hit, d };
        }
      }
    }
    return bestJoint?.hit ?? bestTip?.hit ?? null;
  };

  const testBones = (): Hit | null => {
    let best: { hit: Hit; d: number } | null = null;
    for (const b of idx.order) {
      const s = pose.pos[b.id];
      const e = pose.end[b.id];
      if (!s || !e) continue;
      const d = distToPolyline(p, [s, e]);
      if (d < px(6) && (!best || d < best.d)) best = { hit: { kind: "bone", bone: b.id }, d };
    }
    return best?.hit ?? null;
  };

  const partsHit = o.parts ? testParts() : null;
  const handleHit = testHandles();
  const jointHit = testJoints();
  const boneHit = testBones();

  if (o.partsFirst) return partsHit ?? handleHit ?? jointHit ?? boneHit;
  // Rig-first, so a big shirt never swallows an elbow: handle → joint → art → bone.
  return handleHit ?? jointHit ?? partsHit ?? boneHit;
}

export const isHandle = (h: Hit | null): h is { kind: "ik" | "pole"; chain: string } => !!h && (h.kind === "ik" || h.kind === "pole");
