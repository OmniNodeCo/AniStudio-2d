/** Offscreen frame renderer shared by every export path (and the sprite sheet). */
import { clamp, type Box } from "./math";
import { solveFK, type RigPose } from "./fk";
import { applyCamera, drawOverlay, drawParts, drawShadow, paintBackdrop, sceneBounds } from "./render";
import { poseRotations } from "./rig";
import type { Scene } from "./types";

export interface ShotOpts {
  w: number;
  h: number;
  transparent?: boolean;
  overlay?: boolean;
  box?: Box;
  ground?: boolean;
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

export function drawShot(ctx: CanvasRenderingContext2D, scene: Scene, frame: number, o: ShotOpts) {
  const pose = framePose(scene, frame);
  const box = o.box ?? sceneBounds(scene, pose);
  const pad = 8;
  const zoom = clamp(Math.min((o.w - pad) / Math.max(12, box.w), (o.h - pad) / Math.max(12, box.h)), 0.02, 40);
  const view = { w: o.w, h: o.h, cam: { x: box.x + box.w / 2, y: box.y + box.h / 2, zoom } };
  paintBackdrop(ctx, scene, o.w, o.h, o.transparent);
  applyCamera(ctx, view, 1);
  if (!o.transparent && o.ground !== false) drawShadow(ctx, scene, pose, 0.8);
  drawParts(ctx, scene, pose, { outlines: true });
  if (o.overlay) {
    drawOverlay(ctx, scene, pose, view, {
      showBones: true,
      showHandles: true,
      drag: null,
      uiScale: clamp(o.w / 640, 0.08, 3),
    });
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
