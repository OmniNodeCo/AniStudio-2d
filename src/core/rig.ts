import { angleLerp, applyEase, clamp, mod, type Ease, type Vec, wrapPi } from "./math";
import type { Bone, Keyframe, PosKey, Scene, Track } from "./types";

/* --------------------------------------------------------------- indexing */

export interface SceneIndex {
  byId: Map<string, Bone>;
  children: Map<string, Bone[]>;
  /** Bones ordered so that every parent appears before its children. */
  order: Bone[];
  roots: Bone[];
  chainById: Map<string, Scene["chains"][number]>;
}

const indexCache = new WeakMap<Scene, SceneIndex>();

export function indexScene(scene: Scene): SceneIndex {
  const hit = indexCache.get(scene);
  if (hit) return hit;
  const byId = new Map<string, Bone>();
  for (const b of scene.bones) byId.set(b.id, b);
  const children = new Map<string, Bone[]>();
  const roots: Bone[] = [];
  for (const b of scene.bones) {
    if (b.parent && byId.has(b.parent)) {
      const list = children.get(b.parent);
      if (list) list.push(b);
      else children.set(b.parent, [b]);
    } else {
      roots.push(b);
    }
  }
  const order: Bone[] = [];
  const walk = (b: Bone, depth: number) => {
    order.push(b);
    if (depth > 64) return;
    for (const k of children.get(b.id) ?? []) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const b of scene.bones) if (!order.includes(b)) order.push(b);
  const chainById = new Map(scene.chains.map((c) => [c.id, c]));
  const idx: SceneIndex = { byId, children, order, roots, chainById };
  indexCache.set(scene, idx);
  return idx;
}

export function boneById(scene: Scene, id: string | null | undefined): Bone | undefined {
  if (!id) return undefined;
  return indexScene(scene).byId.get(id);
}

export function isDescendantOf(idx: SceneIndex, id: string, ancestor: string): boolean {
  let b = idx.byId.get(id);
  const seen = new Set<string>();
  while (b?.parent) {
    if (b.parent === ancestor) return true;
    if (seen.has(b.parent)) return false;
    seen.add(b.parent);
    b = idx.byId.get(b.parent);
  }
  return false;
}

export function isAncestor(scene: Scene, maybeAncestor: string, id: string): boolean {
  return isDescendantOf(indexScene(scene), id, maybeAncestor);
}

/** Ancestors from parent up to the root. */
export function ancestorsOf(scene: Scene, id: string): Bone[] {
  const idx = indexScene(scene);
  const out: Bone[] = [];
  let b = idx.byId.get(id);
  while (b?.parent) {
    const p = idx.byId.get(b.parent);
    if (!p) break;
    out.push(p);
    b = p;
  }
  return out;
}

/* --------------------------------------------------------------- sampling */

function findSegment<T extends { t: number; ease: Ease }>(
  keys: T[],
  frame: number,
  frames: number,
  loop: boolean,
): { a: T; b: T; u: number } | null {
  const n = keys.length;
  if (!n) return null;
  if (n === 1) return { a: keys[0], b: keys[0], u: 0 };
  const span = Math.max(2, frames);
  const t = loop ? mod(frame, span) : frame;
  const first = keys[0];
  const last = keys[n - 1];
  if (t < first.t) {
    if (!loop) return { a: first, b: first, u: 0 };
    const gap = first.t + span - last.t;
    const u = gap > 0 ? clamp((t + span - last.t) / gap, 0, 1) : 0;
    return { a: last, b: first, u };
  }
  if (t >= last.t) {
    if (!loop) return { a: last, b: last, u: 0 };
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

/** Rotation value (relative to rest) for a channel of keys at `frame`. */
export function sampleRotKeys(keys: Keyframe[], frame: number, frames: number, loop: boolean): number | null {
  const seg = findSegment(keys, frame, frames, loop);
  if (!seg) return null;
  if (seg.a === seg.b) return seg.a.rot;
  const u = applyEase(seg.a.ease, seg.u);
  return wrapPi(angleLerp(seg.a.rot, seg.b.rot, u));
}

export function samplePosKeys(keys: PosKey[], frame: number, frames: number, loop: boolean): Vec | null {
  const seg = findSegment(keys, frame, frames, loop);
  if (!seg) return null;
  if (seg.a === seg.b) return { x: seg.a.x, y: seg.a.y };
  const u = applyEase(seg.a.ease, seg.u);
  return { x: seg.a.x + (seg.b.x - seg.a.x) * u, y: seg.a.y + (seg.b.y - seg.a.y) * u };
}

export const emptyTrack = (): Track => ({ rot: [], pos: [] });

export function trackOf(scene: Scene, boneId: string): Track {
  return scene.tracks[boneId] ?? emptyTrack();
}

export function frameHasKeys(scene: Scene, frame: number): boolean {
  for (const tr of Object.values(scene.tracks)) {
    if (tr.rot.some((k) => k.t === frame) || tr.pos.some((k) => k.t === frame)) return true;
  }
  return false;
}

/** Local rotations (relative to rest) for every bone at `frame`, with optional live drag overrides. */
export function poseRotations(
  scene: Scene,
  frame: number,
  overrides?: Record<string, number> | null,
): Record<string, number> {
  const idx = indexScene(scene);
  const out: Record<string, number> = {};
  for (const b of idx.order) {
    let r = 0;
    const tr = scene.tracks[b.id];
    if (tr && tr.rot.length) {
      const s = sampleRotKeys(tr.rot, frame, scene.frames, scene.loop);
      if (s != null) r = s;
    }
    out[b.id] = r;
  }
  if (overrides) for (const [k, val] of Object.entries(overrides)) if (k in out) out[k] = val;
  return out;
}

export function rootPosAtFrame(scene: Scene, frame: number): Vec {
  let p: Vec = { ...scene.root };
  for (const b of indexScene(scene).roots) {
    const tr = scene.tracks[b.id];
    if (!tr || !tr.pos.length) continue;
    const s = samplePosKeys(tr.pos, frame, scene.frames, scene.loop);
    if (s) p = { x: scene.root.x + s.x, y: scene.root.y + s.y };
    break;
  }
  return p;
}

/* ------------------------------------------------------------- key editing */

export function ensureTrack(scene: Scene, boneId: string): Track {
  let tr = scene.tracks[boneId];
  if (!tr) {
    tr = emptyTrack();
    scene.tracks[boneId] = tr;
  }
  return tr;
}

const byFrame = <T extends { t: number }>(arr: T[]): T[] => arr.slice().sort((a, b) => a.t - b.t);

/** Write (or replace) the rotation key of a bone at a frame. Keeps neighbouring easings sane. */
export function setRotKey(scene: Scene, boneId: string, frame: number, rot: number, ease: Ease = "easeInOut"): void {
  const tr = ensureTrack(scene, boneId);
  const r = wrapPi(rot);
  const at = tr.rot.findIndex((k) => k.t === frame);
  if (at >= 0) {
    tr.rot[at] = { ...tr.rot[at], rot: r };
    return;
  }
  // Inherit the easing of the segment we are being inserted into; the previous key keeps its own.
  const prev = [...tr.rot].reverse().find((k) => k.t < frame);
  const incoming = prev?.ease ?? "easeInOut";
  tr.rot = byFrame([...tr.rot, { t: frame, rot: r, ease: incoming }]);
  void ease;
}

export function setPosKey(scene: Scene, boneId: string, frame: number, p: Vec, ease: Ease = "easeInOut"): void {
  const tr = ensureTrack(scene, boneId);
  const at = tr.pos.findIndex((k) => k.t === frame);
  if (at >= 0) {
    tr.pos[at] = { ...tr.pos[at], x: p.x, y: p.y };
    return;
  }
  tr.pos = byFrame([...tr.pos, { t: frame, x: p.x, y: p.y, ease }]);
}

export function removeKeyAt(scene: Scene, boneId: string, frame: number): void {
  const tr = scene.tracks[boneId];
  if (!tr) return;
  tr.rot = tr.rot.filter((k) => k.t !== frame);
  tr.pos = tr.pos.filter((k) => k.t !== frame);
  if (!tr.rot.length && !tr.pos.length) delete scene.tracks[boneId];
}

export function pruneTrack(scene: Scene, boneId: string): void {
  const tr = scene.tracks[boneId];
  if (tr && !tr.rot.length && !tr.pos.length) delete scene.tracks[boneId];
}

export function clearKeys(scene: Scene, boneId?: string): void {
  if (!boneId) {
    scene.tracks = {};
    return;
  }
  delete scene.tracks[boneId];
}

export function allKeyFrames(scene: Scene): number[] {
  const set = new Set<number>();
  for (const tr of Object.values(scene.tracks)) {
    for (const k of tr.rot) set.add(k.t);
    for ( const k of tr.pos) set.add(k.t);
  }
  return [...set].sort((a, b) => a - b);
}

export function keyCount(scene: Scene): number {
  let n = 0;
  for (const tr of Object.values(scene.tracks)) n += tr.rot.length + tr.pos.length;
  return n;
}

export function setEaseForKeys(scene: Scene, boneId: string, frames: number[], ease: Ease): void {
  const tr = scene.tracks[boneId];
  if (!tr) return;
  const set = new Set(frames);
  tr.rot = tr.rot.map((k) => (set.has(k.t) ? { ...k, ease } : k));
  tr.pos = tr.pos.map((k) => (set.has(k.t) ? { ...k, ease } : k));
}

/**
 * Slide a set of keyframes along the timeline. Keys already sitting where the moved ones
 * land are replaced (dragging a key onto its neighbour swaps into it, it never stacks).
 */
export function shiftKeys(scene: Scene, boneId: string, frames: number[], delta: number): void {
  const tr = scene.tracks[boneId];
  if (!tr) return;
  const sel = new Set(frames);
  const maxF = Math.max(0, scene.frames - 1);
  const slide = <T extends { t: number }>(list: T[]): T[] => {
    const moved = list.filter((k) => sel.has(k.t)).map((k) => ({ ...k, t: clamp(k.t + delta, 0, maxF) }));
    if (!moved.length) return list;
    const dest = new Set(moved.map((k) => k.t));
    return byFrame([...list.filter((k) => !sel.has(k.t) && !dest.has(k.t)), ...moved]);
  };
  tr.rot = slide(tr.rot);
  tr.pos = slide(tr.pos);
}

export function deleteKeys(scene: Scene, boneId: string, frames: number[]): void {
  const tr = scene.tracks[boneId];
  if (!tr) return;
  const set = new Set(frames);
  tr.rot = tr.rot.filter((k) => !set.has(k.t));
  tr.pos = tr.pos.filter((k) => !set.has(k.t));
  pruneTrack(scene, boneId);
}
