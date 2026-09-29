/**
 * Imported art cache.
 *
 * A drawing you import (PNG/JPG/SVG screenshotted from anywhere) becomes a normal part whose
 * `image` field holds a data URL. Decoding is asynchronous, so the cache keeps the decoded
 * source keyed by part id and notifies whoever is drawing when one arrives. Nothing in here
 * touches the DOM — the browser glue lives in `src/io/import.ts`, which is also where the
 * headless checks stay out of the way.
 */
export type ImageSource = CanvasImageSource & { width?: number; height?: number };

const cache = new Map<string, ImageSource>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

export function putImage(id: string, source: ImageSource): void {
  cache.set(id, source);
  failed.delete(id);
  for (const fn of listeners) fn();
}

export function getImage(id: string): ImageSource | null {
  return cache.get(id) ?? null;
}

export function hasImage(id: string): boolean {
  return cache.has(id);
}

export function markImageFailed(id: string): void {
  failed.add(id);
  for (const fn of listeners) fn();
}

export function imageFailed(id: string): boolean {
  return failed.has(id);
}

export function forgetImage(id: string): void {
  cache.delete(id);
  failed.delete(id);
}

export function clearImages(): void {
  cache.clear();
  failed.clear();
  for (const fn of listeners) fn();
}

/** Called whenever an image finishes loading — the canvas subscribes to redraw itself. */
export function onImageLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const imageCount = (): number => cache.size;

/**
 * Corners of an image part, in bone space: top-left, top-right, bottom-right, bottom-left.
 * Four points is what makes an imported drawing behave like every other part — it moves with
 * its bone, can be rotated/scaled by dragging, and is hit-tested as a polygon.
 */
export function imageQuad(at: { x: number; y: number }, w: number, h: number): { x: number; y: number }[] {
  return [
    { x: at.x, y: at.y },
    { x: at.x + w, y: at.y },
    { x: at.x + w, y: at.y + h },
    { x: at.x, y: at.y + h },
  ];
}

/**
 * Fit a `w`×`h` image into a quad that spans a bone: the drawing is centred on the bone and
 * scaled so its long axis reaches about `cover` × the bone length. Imported art is usually
 * authored at a different size than the rig, so this is what makes "drop it on the bone" work.
 */
export function imageQuadForBone(
  len: number,
  natural: { w: number; h: number },
  o: { cover?: number; anchor?: "center" | "start" | "end"; flip?: boolean } = {},
) {
  const cover = o.cover ?? 1.05;
  const anchor = o.anchor ?? "center";
  const target = Math.max(12, len * cover);
  const ratio = natural.w > 0 && natural.h > 0 ? natural.h / natural.w : 1;
  const w = target;
  const h = target * ratio;
  const x = anchor === "start" ? 0 : anchor === "end" ? len - w : len / 2 - w / 2;
  const quad = imageQuad({ x, y: -h / 2 }, w, h);
  return o.flip ? quad.reverse() : quad;
}

export const quadCentre = (pts: { x: number; y: number }[]) => {
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

/** Width/height of a quad, used for the inspector readout and the thumbnail. */
export function quadSize(pts: { x: number; y: number }[]) {
  if (pts.length < 4) return { w: 0, h: 0 };
  return {
    w: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
    h: Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y),
  };
}
