/**
 * Cameras, shots and framing.
 *
 * A camera is resolution independent: `zoom` is pixels-per-world-unit **at a 720px tall view**,
 * so the same camera frames exactly the same slice of the set in the stage preview, a 512px GIF
 * and a 4K export — only the aspect ratio changes what fits horizontally.
 *
 * Cameras can be animated with keys (`CamKey`: x, y, zoom + ease), which is how you get pushes,
 * trucks and reveals. Each camera also owns **shots** (frame ranges); the active camera's current
 * shot drives both framing and keyframe looping (see `timeline.ts`).
 */
import { applyEase, clamp, lerp, type Ease, type Vec } from "./math";
import { findKeySegment, shotAt, type Timeline } from "./timeline";
import type { Camera, CamKey, Scene, Shot } from "./types";

/** The view height that `Camera.zoom` is measured against. */
export const CAM_REF_HEIGHT = 720;

export interface CamSample {
  x: number;
  y: number;
  zoom: number;
}

export const makeCamera = (x: number, y: number, zoom: number, name = "Camera", shots: Shot[] = []): Camera => ({
  id: `cam${Math.random().toString(36).slice(2, 6)}`,
  name,
  x,
  y,
  zoom,
  shots,
  keys: [],
  visible: true,
});

export function cameraIsAnimated(cam: Camera): boolean {
  return cam.keys.length > 0;
}

/** Camera pose at a frame: keys if it has any, else the locked-off position. */
export function sampleCamera(cam: Camera, frame: number, tl?: Timeline): CamSample {
  if (!cam.keys.length) return { x: cam.x, y: cam.y, zoom: cam.zoom };
  const seg = findKeySegment(cam.keys, frame, Math.max(...cam.keys.map((k) => k.t)) + 1, tl?.loop ?? false, tl);
  if (!seg) return { x: cam.x, y: cam.y, zoom: cam.zoom };
  const u = applyEase(seg.a.ease, seg.u);
  return {
    x: lerp(seg.a.x, seg.b.x, u),
    y: lerp(seg.a.y, seg.b.y, u),
    zoom: lerp(seg.a.zoom, seg.b.zoom, u),
  };
}

/**
 * World units a camera sees vertically. This is the same number for a 360px preview and a 4K
 * export, because `camPixelZoom` scales with the canvas — that is what makes framing portable.
 * (`viewH` is kept in the signature: the aspect ratio decides what fits horizontally.)
 */
export const camWorldHeight = (cam: Camera, _viewH = CAM_REF_HEIGHT): number => CAM_REF_HEIGHT / Math.max(0.02, cam.zoom);

/** Pixel zoom to feed the renderer for this camera in a view of height `viewH`. */
export const camPixelZoom = (cam: Camera, viewH: number): number => cam.zoom * (viewH / CAM_REF_HEIGHT);

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The world rectangle a camera sees in a view of `w × h` at `frame`. */
export function cameraBox(cam: Camera, frame: number, w: number, h: number, tl?: Timeline, sample?: CamSample): FrameBox {
  const c = sample ?? sampleCamera(cam, frame, tl);
  const vh = camWorldHeight({ ...cam, zoom: c.zoom }, h);
  const vw = vh * (w / h);
  return { x: c.x - vw / 2, y: c.y - vh / 2, w: vw, h: vh };
}

/** Apply a camera to a screen-space view: same canvas size, camera position and zoom. */
export function cameraView<T extends { w: number; h: number; cam: { x: number; y: number; zoom: number } }>(
  scene: Scene,
  view: T,
  frame: number,
  camId?: string | null,
  sample?: CamSample,
): T {
  const cam = pickActive(scene, camId);
  if (!cam) return view;
  const s = sample ?? sampleCamera(cam, frame, timelineFor(scene, frame));
  return { ...view, cam: { x: s.x, y: s.y, zoom: camPixelZoom({ ...cam, zoom: s.zoom }, view.h) } };
}

/** Active camera, unless the scene is in free-view mode. */
export function pickActive(scene: Scene, camId?: string | null): Camera | null {
  const list = scene.cameras ?? [];
  if (!list.length) return null;
  const id = camId === undefined ? scene.activeCamera : camId;
  if (!id) return null;
  return list.find((c) => c.id === id) ?? null;
}

function timelineFor(scene: Scene, frame: number): Timeline {
  const cam = pickActive(scene, scene.activeCamera);
  const shot = shotAt(cam, frame);
  if (!shot) return { start: 0, end: Math.max(1, scene.frames - 1), loop: scene.loop };
  return { start: shot.start, end: Math.max(shot.start + 1, shot.end), loop: scene.loop };
}

/** Shot containing `frame` on this camera (falls back to the nearest one). */
export function currentShot(cam: Camera, frame: number): Shot | null {
  return shotAt(cam, frame);
}

/** Does `frame` start a new shot for this camera? (UI: draw a cut marker.) */
export function isCutFrame(cam: Camera, frame: number): boolean {
  return cam.shots.some((s) => s.start === frame);
}

/* --------------------------------------------------------------- editing */

export function setCameraKey(cam: Camera, frame: number, sample: CamSample, ease: Ease = "easeInOut"): Camera {
  const keys = cam.keys.filter((k) => k.t !== frame);
  const prev = [...cam.keys].reverse().find((k) => k.t < frame);
  keys.push({ t: frame, x: sample.x, y: sample.y, zoom: sample.zoom, ease: prev?.ease ?? ease });
  keys.sort((a, b) => a.t - b.t);
  return { ...cam, keys };
}

export function removeCameraKey(cam: Camera, frame: number): Camera {
  return { ...cam, keys: cam.keys.filter((k) => k.t !== frame) };
}

export function shiftCameraKeys(cam: Camera, frames: number[], delta: number, maxFrame: number): Camera {
  const sel = new Set(frames);
  const moved = cam.keys.filter((k) => sel.has(k.t)).map((k) => ({ ...k, t: clamp(k.t + delta, 0, maxFrame) }));
  if (!moved.length) return cam;
  const dest = new Set(moved.map((k) => k.t));
  const rest = cam.keys.filter((k) => !sel.has(k.t) && !dest.has(k.t));
  return { ...cam, keys: [...rest, ...moved].sort((a, b) => a.t - b.t) };
}

export function setCameraKeyEase(cam: Camera, frames: number[], ease: Ease): Camera {
  const sel = new Set(frames);
  return { ...cam, keys: cam.keys.map((k: CamKey) => (sel.has(k.t) ? { ...k, ease } : k)) };
}

/* ------------------------------------------------------------ hit testing */

export function pickCamera(scene: Scene, world: Vec, view: { w: number; h: number; cam: { zoom: number } }, frame: number, only?: Camera | null): Camera | null {
  let best: { cam: Camera; d: number } | null = null;
  for (const cam of scene.cameras ?? []) {
    const s = sampleCamera(cam, frame, timelineFor(scene, frame));
    const d = Math.hypot(s.x - world.x, s.y - world.y);
    if (d < 18 / view.cam.zoom && (!best || d < best.d) && (!only || only.id === cam.id)) best = { cam, d };
  }
  return best?.cam ?? null;
}

/** Corner points of a camera's frame — used to draw the frustum of the cameras you are not using. */
export function cameraCorners(scene: Scene, cam: Camera, frame: number, view: { w: number; h: number }): Vec[] {
  const s = sampleCamera(cam, frame, timelineFor(scene, frame));
  const vh = camWorldHeight({ ...cam, zoom: s.zoom }, view.h);
  const vw = vh * (view.w / view.h);
  return [
    { x: s.x - vw / 2, y: s.y - vh / 2 },
    { x: s.x + vw / 2, y: s.y - vh / 2 },
    { x: s.x + vw / 2, y: s.y + vh / 2 },
    { x: s.x - vw / 2, y: s.y + vh / 2 },
  ];
}

/**
 * Fit a camera around a world box (used by “frame the shot” and the example cameras).
 * A camera at zoom z sees `CAM_REF_HEIGHT / z` world units vertically and the same scaled by the
 * view's aspect horizontally, so fitting is the *smaller* of those two zooms.
 */
export function cameraFittingBox(box: FrameBox, viewW: number, viewH: number, pad = 1.12): CamSample {
  const w = Math.max(12, box.w * pad);
  const h = Math.max(12, box.h * pad);
  const zoomForHeight = CAM_REF_HEIGHT / h;
  const zoomForWidth = (CAM_REF_HEIGHT * (viewW / Math.max(1, viewH))) / w;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, zoom: clamp(Math.min(zoomForHeight, zoomForWidth), 0.05, 24) };
}
