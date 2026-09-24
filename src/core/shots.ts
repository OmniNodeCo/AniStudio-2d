/** Offscreen frame renderer shared by every export path (and the sprite sheet). */
import { clamp, type Box } from "./math";
import { solveFK, type RigPose } from "./fk";
import { applyCamera, drawCameraOverlay, drawObjects, drawOverlay, drawParts, drawShadow, paintBackdrop, sceneBounds } from "./render";
import { drawLightGlow, drawLightWash } from "./lights";
import { cameraBox, pickActive, sampleCamera } from "./cameras";
import { poseRotations } from "./rig";
import { timelineAt } from "./timeline";
import type { Scene } from "./types";

export type Framing = "fit" | "camera" | "shot";

export interface ShotOpts {
  w: number;
  h: number;
  transparent?: boolean;
  overlay?: boolean;
  /** Steady framing box used to keep exports from jittering (drives canvas size too). */
  box?: Box;
  ground?: boolean;
  /** Render through a camera: "camera" = exactly what the lens sees, "shot" = widened to keep
   *  everything that moves inside the frame. `unionBox` is the pre-computed motion box of the shot. */
  framing?: Framing;
  camId?: string | null;
  unionBox?: Box | null;
}

export function framePose(scene: Scene, frame: number): RigPose {
  return solveFK(scene, poseRotations(scene, frame), frame);
}

/** Union of the character's bounding box across a frame range — keeps exports steady. */
export function motionBounds(scene: Scene, from: number, to: number): Box {
  let box: Box | null = null;
  for (let f = from; f <= to; f++) {
    const b = sceneBounds(scene, framePose(scene, f));
    if (!box) box = { ...b };
    else {
      const x0 = Math.min(box.x, b.x);
      const y0 = Math.min(box.y, b.y);
      const x1 = Math.max(box.x + box.w, b.x + b.w);
      const y1 = Math.max(box.y + box.h, b.y + b.h);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  return box ?? sceneBounds(scene, framePose(scene, from));
}

/**
 * The class of the export: what the canvas covers when a camera is in charge.
 *   "camera" → the union of everything that camera can see across the range (it may push in),
 *   "shot"   → that union widened so the moving character never leaves frame.
 */
export function cameraExportBox(scene: Scene, from: number, to: number, w: number, h: number, framing: Framing, camId?: string | null): Box {
  const cam = pickActive(scene, camId ?? scene.activeCamera);
  if (!cam || framing === "fit") return motionBounds(scene, from, to);
  let box: Box | null = null;
  for (let f = from; f <= to; f++) {
    const b = cameraBox(cam, f, w, h, timelineAt(scene, f, cam.id));
    if (!box) box = { ...b };
    else {
      const x0 = Math.min(box.x, b.x);
      const y0 = Math.min(box.y, b.y);
      const x1 = Math.max(box.x + box.w, b.x + b.w);
      const y1 = Math.max(box.y + box.h, b.y + b.h);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  const camBox = box ?? cameraBox(cam, from, w, h, timelineAt(scene, from, cam.id));
  if (framing === "camera") return camBox;
  const motion = motionBounds(scene, from, to);
  const cw = Math.max(camBox.w, motion.w * 1.06);
  const ch = Math.max(camBox.h, motion.h * 1.06);
  return { x: camBox.x + camBox.w / 2 - cw / 2, y: camBox.y + camBox.h / 2 - ch / 2, w: cw, h: ch };
}

/** World rectangle a single frame is rendered with. */
function frameView(scene: Scene, frame: number, o: ShotOpts, fallbackBox: Box) {
  const cam = pickActive(scene, o.camId ?? scene.activeCamera);
  const framing = o.framing ?? "fit";
  if (!cam || framing === "fit") {
    const zoom = clamp(Math.min((o.w - 8) / Math.max(12, fallbackBox.w), (o.h - 8) / Math.max(12, fallbackBox.h)), 0.02, 40);
    return { w: o.w, h: o.h, cam: { x: fallbackBox.x + fallbackBox.w / 2, y: fallbackBox.y + fallbackBox.h / 2, zoom } };
  }
  const tl = timelineAt(scene, frame, cam.id);
  const s = sampleCamera(cam, frame, tl);
  if (framing === "camera") {
    const b = cameraBox(cam, frame, o.w, o.h, tl, s);
    return { w: o.w, h: o.h, cam: { x: s.x, y: s.y, zoom: clamp(Math.min(o.w / b.w, o.h / b.h), 0.02, 40) } };
  }
  // "shot": keep the lens position, widen it just enough for the whole take.
  const union = o.unionBox ?? fallbackBox;
  const bw = Math.max(12, union.w);
  const bh = Math.max(12, union.h);
  return { w: o.w, h: o.h, cam: { x: union.x + union.w / 2, y: union.y + union.h / 2, zoom: clamp(Math.min(o.w / bw, o.h / bh) * 0.96, 0.02, 40) } };
}

export function drawShot(ctx: CanvasRenderingContext2D, scene: Scene, frame: number, o: ShotOpts) {
  const pose = framePose(scene, frame);
  const box = o.box ?? sceneBounds(scene, pose);
  const view = frameView(scene, frame, o, box);
  const k = 1 / view.cam.zoom;
  paintBackdrop(ctx, scene, o.w, o.h, o.transparent);
  applyCamera(ctx, view, 1);
  if (!o.transparent) drawLightWash(ctx, scene, pose, frame, view);
  drawObjects(ctx, scene, frame, "back", { k });
  if (!o.transparent && o.ground !== false) drawShadow(ctx, scene, pose, 0.8);
  drawParts(ctx, scene, pose, { outlines: true });
  drawObjects(ctx, scene, frame, "front", { k });
  if (!o.transparent) drawLightGlow(ctx, scene, pose, frame, view);
  if (o.overlay) {
    drawOverlay(ctx, scene, pose, view, {
      showBones: true,
      showHandles: true,
      drag: null,
      uiScale: clamp(o.w / 640, 0.08, 3),
    });
    drawCameraOverlay(ctx, scene, frame, view, o.camId ?? scene.activeCamera ?? null);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  return { canvas, ctx };
}

export function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), type, quality);
  });
}
