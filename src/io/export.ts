/** Everything the studio can spit out: GIF, WebM, PNG sequence, sprite sheet, project file. */
import JSZip from "jszip";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { cameraExportBox, canvasBlob, drawShot, framePose, makeCanvas, motionBounds, type Framing, type ShotOpts } from "../core/shots";
import { sceneBounds } from "../core/render";
import type { Scene } from "../core/types";

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "animation";

export interface ExportOpts {
  scale: number;
  transparent: boolean;
  overlay: boolean;
  width?: number;
  height?: number;
  from?: number;
  to?: number;
  /** "fit" (tight on the character), "camera" (cinematic, through the lens) or "shot" (steady). */
  framing?: Framing;
  camId?: string | null;
  /** Width ÷ height used when a camera frames the export (defaults to 16:9). */
  aspect?: number;
}

const framingOf = (o: ExportOpts): Framing => o.framing ?? "fit";

/** Framing box for a range: the character's motion, or what the camera covers. */
function framingBox(scene: Scene, o: ExportOpts, from: number, to: number) {
  const framing = framingOf(o);
  if (framing === "fit") return motionBounds(scene, from, to);
  const aspect = o.aspect ?? 16 / 9;
  // A camera's zoom is aspect independent, so any reference height works; only the ratio matters.
  return cameraExportBox(scene, from, to, 720 * aspect, 720, framing, o.camId ?? null);
}

function shotSize(scene: Scene, o: ExportOpts, box: { w: number; h: number }) {
  const s = o.scale;
  const framing = framingOf(o);
  if (framing !== "fit") {
    return {
      w: Math.max(64, Math.round(o.width ?? box.w * s)),
      h: Math.max(64, Math.round(o.height ?? box.h * s)),
    };
  }
  return {
    w: Math.max(64, Math.round(o.width ?? (box.w + 24) * s)),
    h: Math.max(64, Math.round(o.height ?? (box.h + 24) * s)),
  };
}

/** Everything `drawShot` needs to know about framing for this export. */
function shotOpts(scene: Scene, o: ExportOpts, from: number, to: number): Pick<ShotOpts, "framing" | "camId" | "unionBox"> {
  const framing = framingOf(o);
  return {
    framing,
    camId: o.camId ?? null,
    unionBox: framing === "shot" ? motionBounds(scene, from, to) : null,
  };
}

function setup(scene: Scene, o: ExportOpts, from: number, to: number) {
  const box = framingBox(scene, o, from, to);
  const { w, h } = shotSize(scene, o, box);
  return { box, w, h, shot: shotOpts(scene, o, from, to) };
}

/* ------------------------------------------------------------------- GIF */

export async function exportGif(
  scene: Scene,
  o: ExportOpts,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const from = o.from ?? 0;
  const to = o.to ?? scene.frames - 1;
  const { box, w, h, shot } = setup(scene, o, from, to);
  const { ctx } = makeCanvas(w, h);
  const gif = GIFEncoder();
  const delay = Math.max(20, Math.round(1000 / Math.max(1, scene.fps)));
  // Transparent GIFs need the alpha channel in the quantiser; 1-bit alpha keeps the palette small.
  const format = o.transparent ? "rgba4444" : "rgb565";
  for (let f = from; f <= to; f++) {
    drawShot(ctx, scene, f, { w, h, transparent: o.transparent, overlay: o.overlay, box, ...shot });
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256, {
      format,
      oneBitAlpha: o.transparent,
      clearAlpha: o.transparent,
      clearAlphaThreshold: 127,
    });
    if (o.transparent) palette[0] = [0, 0, 0, 0];
    const index = applyPalette(data, palette, format);
    gif.writeFrame(index, w, h, {
      palette,
      delay,
      repeat: 0,
      transparent: o.transparent,
      transparentIndex: 0,
      first: f === from,
    });
    onProgress?.((f - from + 1) / (to - from + 1));
    // let the UI breathe between frames
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

/* ------------------------------------------------------------- PNG frames */

export async function exportPngZip(
  scene: Scene,
  o: ExportOpts,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const from = o.from ?? 0;
  const to = o.to ?? scene.frames - 1;
  const { box, w, h, shot } = setup(scene, o, from, to);
  const { canvas, ctx } = makeCanvas(w, h);
  const zip = new JSZip();
  const name = slug(scene.name);
  for (let f = from; f <= to; f++) {
    drawShot(ctx, scene, f, { w, h, transparent: o.transparent, overlay: o.overlay, box, ...shot });
    zip.file(`${name}/${String(f).padStart(4, "0")}.png`, canvas.toDataURL("image/png").split(",")[1], { base64: true });
    onProgress?.((f - from + 1) / (to - from + 1));
    if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  zip.file(
    `${name}/manifest.json`,
    JSON.stringify({ app: "AniStudio2D", name: scene.name, fps: scene.fps, from, to, width: w, height: h, loop: scene.loop }, null, 2),
  );
  return zip.generateAsync({ type: "blob" });
}

/* ----------------------------------------------------------- sprite sheet */

export interface SheetResult {
  png: Blob;
  json: string;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

export async function exportSpriteSheet(scene: Scene, o: ExportOpts, colsWanted?: number): Promise<SheetResult> {
  const from = o.from ?? 0;
  const to = o.to ?? scene.frames - 1;
  const count = to - from + 1;
  const framing = framingOf(o);
  const box = framingBox(scene, o, from, to);
  const pad = framing === "fit" ? 12 : 0;
  const cw = Math.max(24, Math.round((box.w + pad) * o.scale));
  const ch = Math.max(24, Math.round((box.h + pad) * o.scale));
  const cols = Math.max(1, Math.min(colsWanted ?? Math.ceil(Math.sqrt(count)), count));
  const rows = Math.ceil(count / cols);
  const { canvas, ctx } = makeCanvas(cols * cw, rows * ch);
  if (!o.transparent) {
    ctx.fillStyle = scene.bgBottom;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const cell = makeCanvas(cw, ch);
  for (let i = 0; i < count; i++) {
    const f = from + i;
    drawShot(cell.ctx, scene, f, { w: cw, h: ch, transparent: o.transparent, overlay: false, box, ...shotOpts(scene, o, from, to) });
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.clearRect(x, y, cw, ch);
    ctx.drawImage(cell.canvas, x, y);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  const json = JSON.stringify(
    {
      image: `${slug(scene.name)}-sheet.png`,
      size: { w: canvas.width, h: canvas.height },
      frame: { w: cw, h: ch },
      columns: cols,
      rows,
      fps: scene.fps,
      loop: scene.loop,
      pivot: { x: 0.5, y: 1 },
      origin: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
      frames: Array.from({ length: count }, (_, i) => ({
        filename: `${slug(scene.name)}-${i}.png`,
        frame: { x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch },
        rotated: false,
        trimmed: false,
        sourceSize: { w: cw, h: ch },
        spriteSourceSize: { x: 0, y: 0, w: cw, h: ch },
      })),
    },
    null,
    2,
  );
  return { png: await canvasBlob(canvas), json, cols, rows, cw, ch };
}

/* ----------------------------------------------------------- single frame */

export async function exportPng(scene: Scene, o: ExportOpts, frame = o.from ?? 0): Promise<Blob> {
  const framing = framingOf(o);
  const box = framing === "fit" ? sceneBounds(scene, framePose(scene, frame)) : framingBox(scene, o, frame, frame);
  const { w, h } = shotSize(scene, o, box);
  const { canvas, ctx } = makeCanvas(w, h);
  drawShot(ctx, scene, frame, { w, h, transparent: o.transparent, overlay: o.overlay, box, framing, camId: o.camId ?? null });
  return canvasBlob(canvas);
}

/* ------------------------------------------------------------------ WebM */

export async function exportWebm(scene: Scene, o: ExportOpts, onProgress?: (p: number) => void): Promise<Blob | null> {
  const from = o.from ?? 0;
  const to = o.to ?? scene.frames - 1;
  const { box, w, h, shot } = setup(scene, o, from, to);
  const { canvas, ctx } = makeCanvas(w % 2 ? w + 1 : w, h % 2 ? h + 1 : h);
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(scene.fps);
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return null;
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start();
  const per = 1000 / scene.fps;
  const frames = to - from + 1;
  for (let i = 0; i < frames; i++) {
    drawShot(ctx, scene, from + i, { w, h, transparent: false, overlay: o.overlay, box, ...shot });
    onProgress?.((i + 1) / frames);
    await new Promise((r) => setTimeout(r, per));
  }
  await new Promise((r) => setTimeout(r, 220));
  rec.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}

/* -------------------------------------------------------- project file */

export function projectBlob(scene: Scene, poseLib: unknown = []): Blob {
  return new Blob(
    [JSON.stringify({ app: "AniStudio2D", version: 1, savedAt: new Date().toISOString(), scene, poseLib }, null, 2)],
    { type: "application/json" },
  );
}

export function parseProject(text: string): { scene: Scene; poseLib?: unknown } {
  const data = JSON.parse(text);
  const scene: Scene | undefined = data.scene ?? data;
  if (!scene || !Array.isArray(scene.bones)) throw new Error("Not an AniStudio project file");
  // fill in anything a hand-written file might be missing
  return {
    scene: {
      ...scene,
      tracks: scene.tracks ?? {},
      shapes: scene.shapes ?? [],
      chains: scene.chains ?? [],
      objects: scene.objects ?? [],
      lights: scene.lights ?? [],
      cameras: scene.cameras ?? [],
      frames: scene.frames ?? 24,
      fps: scene.fps ?? 24,
      loop: scene.loop ?? true,
      name: scene.name ?? "imported",
      root: scene.root ?? { x: 0, y: 0 },
    },
    poseLib: data.poseLib,
  };
}
