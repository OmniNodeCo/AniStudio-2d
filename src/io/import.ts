/**
 * Browser glue for importing art. Everything here needs the DOM (Image, canvas, FileReader),
 * which is exactly why it lives outside `src/core` — the headless check suites import the core
 * and never touch this file.
 *
 * Two jobs:
 *   1. Turn a dropped/selected file into a data URL the scene can carry in its JSON.
 *   2. Decode those data URLs into the cache the renderer reads (`src/core/images.ts`).
 */
import { BACKDROP_IMAGE_ID } from "../core/render";
import { markImageFailed, putImage } from "../core/images";
import type { Scene, ShapePart } from "../core/types";

export interface ImportedArt {
  src: string;
  /** Natural pixel size of the decoded image. */
  w: number;
  h: number;
  name: string;
  /** True when we rasterised a vector file (SVG) so it can be drawn to canvas everywhere. */
  rasterised?: boolean;
}

/** Longest edge kept when rasterising an SVG — big enough for a 4K export, small enough to store. */
const SVG_MAX = 1024;
export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

const isSvg = (file: File) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.readAsDataURL(file);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("that file is not an image this browser can open"));
    img.src = src;
  });
}

/**
 * Read any picture into a storable image. SVG is rasterised because a vector file has no fixed
 * pixel size — burning it into a PNG once means the rig, the exports and the thumbnails all see
 * exactly the same pixels.
 */
export async function readImageFile(file: File): Promise<ImportedArt> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`that image is ${(file.size / 1048576).toFixed(1)} MB — keep imports under ${MAX_IMPORT_BYTES / 1048576} MB`);
  const raw = await readAsDataURL(file);
  const img = await decode(raw);
  const name = file.name.replace(/\.[a-z0-9]+$/i, "");
  if (!isSvg(file)) {
    return { src: raw, w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1, name };
  }
  const scale = Math.min(1, SVG_MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 256) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 256) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser refused a canvas — SVG import needs one");
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL("image/png"), w, h, name, rasterised: true };
}

/** Decode one part's drawing. Silently marks failures so the canvas can draw a placeholder. */
export async function loadPartImage(part: ShapePart): Promise<boolean> {
  if (!part.image) return false;
  try {
    const img = await decode(part.image.src);
    putImage(part.id, img);
    return true;
  } catch {
    markImageFailed(part.id);
    return false;
  }
}

export async function loadBackdropImage(src: string): Promise<boolean> {
  try {
    const img = await decode(src);
    putImage(BACKDROP_IMAGE_ID, img);
    return true;
  } catch {
    markImageFailed(BACKDROP_IMAGE_ID);
    return false;
  }
}

/** Decode every import a scene carries — called after loading a project file. */
export async function loadSceneImages(scene: Scene): Promise<number> {
  const jobs = scene.shapes.filter((s) => s.image).map((s) => loadPartImage(s));
  if (scene.bgImage) jobs.push(loadBackdropImage(scene.bgImage.src));
  const results = await Promise.all(jobs);
  return results.filter(Boolean).length;
}

/** Which image file types the dock and the stage accept. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,image/gif";

export const isImageFile = (file: File): boolean =>
  file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name);
