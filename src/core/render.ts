/** Canvas drawing + camera helpers. Everything is drawn in world units (camera applied). */
import { clamp, emptyBox, growBox, type Vec } from "./math";
import { shapeWorldPoints, type RigPose } from "./fk";
import { poleHandle } from "./ik";
import { indexScene } from "./rig";
import type { Scene, ShapePart } from "./types";

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}
export interface View {
  w: number;
  h: number;
  cam: Cam;
}

export const worldToScreen = (p: Vec, view: View): Vec => ({
  x: (p.x - view.cam.x) * view.cam.zoom + view.w / 2,
  y: (p.y - view.cam.y) * view.cam.zoom + view.h / 2,
});

export const screenToWorld = (p: Vec, view: View): Vec => ({
  x: (p.x - view.w / 2) / view.cam.zoom + view.cam.x,
  y: (p.y - view.h / 2) / view.cam.zoom + view.cam.y,
});

export function applyCamera(ctx: CanvasRenderingContext2D, view: View, dpr: number, ox = 0, oy = 0) {
  const z = view.cam.zoom * dpr;
  ctx.setTransform(
    z,
    0,
    0,
    z,
    dpr * (ox + view.w / 2 - view.cam.x * view.cam.zoom),
    dpr * (oy + view.h / 2 - view.cam.y * view.cam.zoom),
  );
}

/** Bounding box of everything visible in the current pose (used for "fit" and export). */
export function sceneBounds(scene: Scene, pose: RigPose): Vec & { w: number; h: number } {
  let box = emptyBox();
  let any = false;
  for (const s of scene.shapes) {
    if (!s.visible) continue;
    for (const p of shapeWorldPoints(s, pose)) {
      box = growBox(box, p);
      any = true;
    }
  }
  for (const b of indexScene(scene).order) {
    const p = pose.pos[b.id];
    const e = pose.end[b.id];
    if (p) {
      box = growBox(box, p);
      any = true;
    }
    if (e) {
      box = growBox(box, e);
      any = true;
    }
  }
  if (!any) return { x: 0, y: 0, w: 240, h: 240 };
  return { x: box.x, y: box.y, w: Math.max(20, box.w), h: Math.max(20, box.h) };
}

export function fitView(scene: Scene, pose: RigPose, w: number, h: number, pad = 100): View {
  const b = sceneBounds(scene, pose);
  const zoom = clamp(Math.min((w - pad) / b.w, (h - pad) / b.h), 0.08, 8);
  return { w, h, cam: { x: b.x + b.w / 2, y: b.y + b.h / 2, zoom } };
}

/* ---------------------------------------------------------------- paths */

function tracePoly(ctx: CanvasRenderingContext2D, pts: Vec[], closed: boolean, smooth: boolean) {
  const n = pts.length;
  ctx.beginPath();
  if (n < 2) return;
  if (!smooth || n < 3) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return;
  }
  // Corner-rounding pass: curve through edge midpoints so hand-built polygons look organic.
  const at = (i: number) => pts[((i % n) + n) % n];
  const start = { x: (at(0).x + at(1).x) / 2, y: (at(0).y + at(1).y) / 2 };
  ctx.moveTo(start.x, start.y);
  for (let i = 1; i < n; i++) {
    const p = at(i);
    const nx = at(i + 1);
    ctx.quadraticCurveTo(p.x, p.y, (p.x + nx.x) / 2, (p.y + nx.y) / 2);
  }
  ctx.quadraticCurveTo(at(0).x, at(0).y, start.x, start.y);
  if (closed) ctx.closePath();
}

export function fillOf(scene: Scene, s: ShapePart): string {
  const byRole = s.role ? scene.palette[s.role] : undefined;
  return s.fill ?? byRole ?? "#c9c4d8";
}

/* ----------------------------------------------------------- background */

export function drawForegroundGuides(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: View,
  o: { grid: boolean; ground: boolean },
) {
  const { w, h } = view;
  const tl = screenToWorld({ x: 0, y: 0 }, view);
  const br = screenToWorld({ x: w, y: h }, view);

  if (o.grid) {
    const step = 25;
    const major = step * 4;
    const k = 1 / view.cam.zoom;
    ctx.save();
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) {
      if (Math.abs(x % major) > 1e-6) continue;
      ctx.moveTo(x, tl.y);
      ctx.lineTo(x, br.y);
    }
    for (let y = Math.floor(tl.y / step) * step; y < br.y; y += step) {
      if (Math.abs(y % major) > 1e-6) continue;
      ctx.moveTo(tl.x, y);
      ctx.lineTo(br.x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.setLineDash([6 * k, 7 * k]);
    ctx.beginPath();
    ctx.moveTo(0, tl.y);
    ctx.lineTo(0, br.y);
    ctx.stroke();
    ctx.restore();
  }

  if (o.ground && scene.ground != null) {
    const y = scene.ground;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 2 / view.cam.zoom;
    ctx.beginPath();
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, y, 0, y + 260);
    g.addColorStop(0, "rgba(0,0,0,0.20)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(tl.x, y, br.x - tl.x, 260);
    ctx.restore();
  }
}

/** Flat paint of the background, drawn in screen space. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, scene: Scene, w: number, h: number, transparent = false) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (transparent) {
    ctx.clearRect(0, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, scene.bgTop);
    g.addColorStop(1, scene.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Soft contact shadow that follows the root — cheap, but makes poses feel planted. */
export function drawShadow(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose, alpha = 1) {
  if (scene.ground == null) return;
  const idx = indexScene(scene);
  const root = idx.roots[0];
  const x = root ? pose.pos[root.id]?.x ?? pose.root.x : pose.root.x;
  const b = sceneBounds(scene, pose);
  const rx = Math.max(28, b.w * 0.3);
  ctx.save();
  ctx.globalAlpha = 0.2 * alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, scene.ground, rx, Math.max(6, rx * 0.15), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------------- parts */

export interface PartDrawOpts {
  alpha?: number;
  silhouette?: string | null;
  selected?: string[];
  hover?: string | null;
  outlines?: boolean;
}

export function drawParts(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose, o: PartDrawOpts = {}) {
  const alpha = o.alpha ?? 1;
  const shapes = scene.shapes.filter((s) => s.visible).sort((a, b) => a.z - b.z);
  const outlined = o.outlines ?? true;
  const flat = !!o.silhouette;

  if (outlined && !flat) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = scene.outline;
    for (const s of shapes) {
      const pts = shapeWorldPoints(s, pose);
      if (pts.length < 2) continue;
      ctx.lineWidth = (s.strokeWidth ?? 3) * 2;
      tracePoly(ctx, pts, s.closed, !s.sharp);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  for (const s of shapes) {
    const pts = shapeWorldPoints(s, pose);
    if (pts.length < 2) continue;
    tracePoly(ctx, pts, s.closed, !s.sharp);
    if (flat) {
      ctx.fillStyle = o.silhouette as string;
      ctx.fill();
      continue;
    }
    ctx.globalAlpha = alpha * (s.opacity ?? 1);
    ctx.fillStyle = fillOf(scene, s);
    ctx.fill();
    if (outlined) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = s.strokeWidth ?? 3;
      ctx.strokeStyle = s.stroke ?? scene.outline;
      ctx.stroke();
    }
  }
  ctx.restore();

  const marks = new Set([...(o.selected ?? []), ...(o.hover ? [o.hover] : [])]);
  if (marks.size) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    for (const s of shapes) {
      if (!marks.has(s.id)) continue;
      const sel = o.selected?.includes(s.id);
      ctx.strokeStyle = sel ? "#7ef0ff" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = sel ? 2.2 : 1.4;
      tracePoly(ctx, shapeWorldPoints(s, pose), s.closed, !s.sharp);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* --------------------------------------------------- skeleton + handles */

export interface DragFeedback {
  kind: "ik" | "pole" | "joint" | "root" | "shape";
  id: string;
  point?: Vec;
  reach?: { center: Vec; radius: number } | null;
  snapped?: boolean;
}

export interface OverlayOpts {
  showBones?: boolean;
  showHandles?: boolean;
  showNames?: boolean;
  selectedBone?: string | null;
  selectedChain?: string | null;
  hoverId?: string | null;
  drag?: DragFeedback | null;
  restGhost?: boolean;
  mirrorAxis?: number | null;
  /** Multiplies every on-screen handle/label size — small when exporting tiny images. */
  uiScale?: number;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose, view: View, o: OverlayOpts) {
  const k = (1 / view.cam.zoom) * (o.uiScale ?? 1);
  const idx = indexScene(scene);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (o.mirrorAxis != null) {
    const tl = screenToWorld({ x: 0, y: 0 }, view);
    const br = screenToWorld({ x: view.w, y: view.h }, view);
    ctx.save();
    ctx.setLineDash([10 * k, 8 * k]);
    ctx.strokeStyle = "rgba(255,220,120,0.35)";
    ctx.lineWidth = 1.4 * k;
    ctx.beginPath();
    ctx.moveTo(o.mirrorAxis, tl.y);
    ctx.lineTo(o.mirrorAxis, br.y);
    ctx.stroke();
    ctx.restore();
  }

  if (o.restGhost) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([4 * k, 5 * k]);
    ctx.lineWidth = 1.3 * k;
    ctx.strokeStyle = "#9fb4ff";
    for (const b of idx.order) {
      const start = restPoint(scene, b.id);
      const ang = restWorldAngle(scene, b.id);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(start.x + Math.cos(ang) * b.length, start.y + Math.sin(ang) * b.length);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (o.showBones) {
    for (const b of idx.order) {
      const p = pose.pos[b.id];
      const e = pose.end[b.id];
      if (!p || !e) continue;
      const selected = o.selectedBone === b.id;
      const hov = o.hoverId === `bone:${b.id}` || o.hoverId === `joint:${b.id}`;
      const chain = b.chain ? scene.chains.find((c) => c.id === b.chain) : undefined;
      const activeChain = chain && o.selectedChain === chain.id;
      ctx.globalAlpha = chain ? 0.95 : 0.8;
      ctx.strokeStyle = chain ? chain.color : selected || hov ? "#9df3ff" : "rgba(233,240,255,0.66)";
      ctx.lineWidth = (selected || hov ? 5.4 : b.w ?? 3.6) * k;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(16,17,24,0.92)";
      ctx.strokeStyle = selected || hov ? "#9df3ff" : "rgba(233,240,255,0.75)";
      ctx.lineWidth = 1.7 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (selected || hov ? 5.4 : 3.7) * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (activeChain) {
        ctx.strokeStyle = chain!.color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (o.showNames) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#eaefff";
        ctx.font = `${11 * k}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(b.name, p.x + 9 * k, p.y - 9 * k);
      }
    }
    // tip caps
    for (const b of idx.order) {
      const e = pose.end[b.id];
      if (!e) continue;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "rgba(233,240,255,0.7)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, 2.2 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (o.showHandles) {
    for (const chain of scene.chains) {
      if (!chain.show) continue;
      const rootId = chain.bones[0];
      const tipId = chain.bones[chain.bones.length - 1];
      const root = pose.pos[rootId];
      const tip = pose.end[tipId];
      if (!root || !tip) continue;
      const active = o.selectedChain === chain.id;
      ctx.globalAlpha = 1;

      if (o.drag && o.drag.kind === "ik" && o.drag.id === chain.id && o.drag.reach) {
        ctx.save();
        ctx.setLineDash([6 * k, 6 * k]);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.arc(o.drag.reach.center.x, o.drag.reach.center.y, o.drag.reach.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = chain.color;
      ctx.lineWidth = 2.6 * k;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, (active ? 12 : 10.5) * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = chain.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(tip.x - 5 * k, tip.y);
      ctx.lineTo(tip.x + 5 * k, tip.y);
      ctx.moveTo(tip.x, tip.y - 5 * k);
      ctx.lineTo(tip.x, tip.y + 5 * k);
      ctx.stroke();
      if (o.hoverId === `ik:${chain.id}`) {
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 16 * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (o.drag && o.drag.kind === "ik" && o.drag.id === chain.id && o.drag.point) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([4 * k, 4 * k]);
        ctx.beginPath();
        ctx.moveTo(root.x, root.y);
        ctx.lineTo(o.drag.point.x, o.drag.point.y);
        ctx.stroke();
        ctx.restore();
      }

      if (chain.pole && chain.bones.length >= 2) {
        const mid = pose.pos[chain.bones[1]];
        if (mid) {
          const handle = poleHandle(root, mid, tip);
          const hov = o.hoverId === `pole:${chain.id}`;
          ctx.globalAlpha = hov ? 1 : 0.9;
          ctx.fillStyle = "rgba(16,17,24,0.85)";
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          ctx.moveTo(handle.x, handle.y - 7.5 * k);
          ctx.lineTo(handle.x + 7 * k, handle.y + 5 * k);
          ctx.lineTo(handle.x - 7 * k, handle.y + 5 * k);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([3 * k, 5 * k]);
          ctx.beginPath();
          ctx.moveTo(mid.x, mid.y);
          ctx.lineTo(handle.x, handle.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------ rest pose cache */

const restAngles = new WeakMap<Scene, Map<string, number>>();
const restPositions = new WeakMap<Scene, Map<string, Vec>>();

export function restWorldAngle(scene: Scene, id: string): number {
  let memo = restAngles.get(scene);
  if (!memo) {
    memo = new Map();
    restAngles.set(scene, memo);
  }
  const hit = memo.get(id);
  if (hit != null) return hit;
  const b = indexScene(scene).byId.get(id);
  const a = (b?.parent ? restWorldAngle(scene, b.parent) : 0) + (b?.rest ?? 0);
  memo.set(id, a);
  return a;
}

export function restPoint(scene: Scene, id: string): Vec {
  let memo = restPositions.get(scene);
  if (!memo) {
    memo = new Map();
    restPositions.set(scene, memo);
  }
  const hit = memo.get(id);
  if (hit) return hit;
  const b = indexScene(scene).byId.get(id);
  if (!b) return { ...scene.root };
  if (!b.parent) {
    memo.set(id, { ...scene.root });
    return scene.root;
  }
  const start = restPoint(scene, b.parent);
  const a = restWorldAngle(scene, b.parent) + b.rest;
  const p = { x: start.x + Math.cos(a) * b.length, y: start.y + Math.sin(a) * b.length };
  memo.set(id, p);
  return p;
}
