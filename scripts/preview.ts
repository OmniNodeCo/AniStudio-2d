/**
 * Offline preview renderer — lets me eyeball rig proportions and the demo animations
 * without a browser. Usage:
 *   npx esbuild scripts/preview.ts --bundle --platform=node --format=esm --outfile=.tmp/preview.mjs
 *   node .tmp/preview.mjs kid,robot,dragon,blob 0,8,16 out.png 1
 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { applyCamera, drawForegroundGuides, drawOverlay, drawParts, drawShadow, fitView } from "../src/core/render";
import { solveFK } from "../src/core/fk";
import { poseRotations } from "../src/core/rig";
import { buildScene } from "../src/core/rig-build";
import { RIG_MAP } from "../src/presets/rigs";
import { applyDemo } from "../src/presets/demos";

const arg = (i: number, def: string) => process.argv[i] ?? def;
const rigIds = arg(2, "kid,robot,dragon,blob").split(",");
const frames = arg(3, "0,8,16").split(",").map((n) => Number(n));
const out = arg(4, "preview.png");
const withOverlay = arg(5, "1") === "1";
const withDemo = arg(6, "1") === "1";
const CW = Number(arg(7, "400"));
const CH = Number(arg(8, "330"));

function renderCell(id: string, frame: number): Canvas {
  const def = RIG_MAP.get(id)!;
  const scene = buildScene(def);
  if (withDemo) applyDemo(scene, def.demo);
  const pose = solveFK(scene, poseRotations(scene, frame), frame);
  const view = fitView(scene, pose, CW, CH, 60);
  const c = createCanvas(CW, CH);
  const ctx = c.getContext("2d") as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, scene.bgTop);
  g.addColorStop(1, scene.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);
  applyCamera(ctx, view, 1);
  drawForegroundGuides(ctx, scene, view, { grid: true, ground: true });
  drawShadow(ctx, scene, pose);
  drawParts(ctx, scene, pose, { outlines: true });
  if (withOverlay) {
    drawOverlay(ctx, scene, pose, view, { showBones: true, showHandles: true, showNames: false, drag: null });
  }
  return c;
}

const sheet = createCanvas(CW * frames.length + 8, (CH + 22) * rigIds.length);
const sctx = sheet.getContext("2d") as unknown as CanvasRenderingContext2D;
sctx.fillStyle = "#0c0d14";
sctx.fillRect(0, 0, sheet.width, sheet.height);
let row = 0;
for (const id of rigIds) {
  if (!RIG_MAP.has(id)) {
    console.log("unknown rig", id);
    continue;
  }
  let col = 0;
  for (const f of frames) {
    const cell = renderCell(id, f);
    sctx.drawImage(cell as unknown as CanvasImageSource, col * CW + 4, row * (CH + 22) + 18);
    sctx.fillStyle = "#8f9ab8";
    sctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    sctx.fillText(`${id} · frame ${f}`, col * CW + 8, row * (CH + 22) + 12);
    col++;
  }
  row++;
}
mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
writeFileSync(out, sheet.toBuffer("image/png"));
console.log("wrote", out, `${sheet.width}x${sheet.height}`);
