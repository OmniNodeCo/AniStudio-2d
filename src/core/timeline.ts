/**
 * Timeline resolution — the glue between cameras, shots and keyframe sampling.
 *
 * A camera owns one or more **shots** (frame ranges). When a camera is active it decides two
 * things at once:
 *   · framing — where the stage looks from, and
 *   · the sampling window — keys loop *inside the shot*, so each take is its own little animation.
 *
 * With no cameras in the scene everything falls back to the classic `0 … frames-1` timeline, so
 * older projects and the quick rigs behave exactly as before.
 */
import { clamp, mod } from "./math";
import type { Camera, Scene, Shot } from "./types";

export interface Timeline {
  start: number;
  /** Inclusive. */
  end: number;
  loop: boolean;
}

export function cameraById(scene: Scene, id?: string | null): Camera | null {
  if (!id) return null;
  return (scene.cameras ?? []).find((c) => c.id === id) ?? null;
}

/** The camera that should be driving the timeline: the active one, else the first with shots. */
export function mainCamera(scene: Scene, cameraId?: string | null): Camera | null {
  const list = scene.cameras ?? [];
  if (!list.length) return null;
  return cameraById(scene, cameraId ?? scene.activeCamera) ?? list.find((c) => c.shots.length) ?? list[0];
}

export function shotAt(camera: Camera | null, frame: number): Shot | null {
  if (!camera || !camera.shots.length) return null;
  const sorted = [...camera.shots].sort((a, b) => a.start - b.start);
  return sorted.find((s) => frame >= s.start && frame <= s.end) ?? (frame < sorted[0].start ? sorted[0] : sorted[sorted.length - 1]);
}

export function shotIndexAt(camera: Camera | null, frame: number): number {
  if (!camera) return -1;
  const shot = shotAt(camera, frame);
  return shot ? camera.shots.indexOf(shot) : -1;
}

/** Sampling window for a frame: the shot that contains it, else the whole scene. */
export function timelineAt(scene: Scene, frame: number, cameraId?: string | null): Timeline {
  const cam = mainCamera(scene, cameraId);
  const shot = shotAt(cam, frame);
  if (!shot) return { start: 0, end: Math.max(1, scene.frames - 1), loop: scene.loop };
  const start = clamp(Math.round(shot.start), 0, Math.max(0, scene.frames - 1));
  const end = clamp(Math.round(shot.end), start + 1, Math.max(1, scene.frames - 1));
  return { start, end, loop: scene.loop };
}

export function timelineFrames(tl: Timeline): number {
  return Math.max(2, tl.end - tl.start + 1);
}

/** True when the scene actually cuts somewhere (used by the UI to show camera machinery). */
export function hasCinematicTimeline(scene: Scene): boolean {
  return (scene.cameras ?? []).some((c) => c.shots.length > 0);
}

export interface KeySeg<T> {
  a: T;
  b: T;
  u: number;
}

/**
 * Locate the key segment covering `frame`. Keys are absolute frames; wrapping happens inside the
 * timeline window, so a shot loops from its own start to its own end.
 */
export function findKeySegment<T extends { t: number; ease: unknown }>(
  keys: T[],
  frame: number,
  frames: number,
  loop: boolean,
  tl?: Timeline,
): KeySeg<T> | null {
  const n = keys.length;
  if (!n) return null;
  if (n === 1) return { a: keys[0], b: keys[0], u: 0 };
  const start = tl ? tl.start : 0;
  const end = tl ? tl.end : Math.max(1, frames - 1);
  const looping = tl ? tl.loop : loop;
  const span = Math.max(2, end - start + 1);
  const t = looping ? start + mod(frame - start, span) : clamp(frame, start, end);
  const first = keys[0];
  const last = keys[n - 1];
  if (t < first.t) {
    if (!looping) return { a: first, b: first, u: 0 };
    const gap = first.t + span - last.t;
    const u = gap > 0 ? clamp((t + span - last.t) / gap, 0, 1) : 0;
    return { a: last, b: first, u };
  }
  if (t >= last.t) {
    if (!looping) return { a: last, b: last, u: 0 };
    const gap = first.t + span - last.t;
    const u = gap > 0 ? clamp((t - last.t) / gap, 0, 1) : 0;
    return { a: last, b: first, u };
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      const d = b.t - a.t;
      return { a, b, u: d <= 0 ? 1 : (t - a.t) / d };
    }
  }
  return { a: last, b: last, u: 0 };
}

/** Union of every key time in the scene plus every shot boundary — used for auto lights. */
export function keyFrameTimes(scene: Scene): number[] {
  const set = new Set<number>();
  for (const tr of Object.values(scene.tracks)) {
    for (const k of tr.rot) set.add(k.t);
    for (const k of tr.pos) set.add(k.t);
  }
  for (const cam of scene.cameras ?? []) {
    for (const k of cam.keys) set.add(k.t);
    for (const s of cam.shots) {
      set.add(s.start);
      set.add(s.end);
    }
  }
  return [...set].sort((a, b) => a - b);
}
