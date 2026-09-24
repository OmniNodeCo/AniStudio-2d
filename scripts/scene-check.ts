/**
 * Headless check of the *stage*: scenery, lights, cameras and the export framing that goes with
 * them. Renders contact sheets so the result can be eyeballed, and asserts the maths.
 *
 * Run:
 *   npx esbuild scripts/scene-check.ts --bundle --platform=node --format=cjs \
 *     --external:@napi-rs/canvas --outfile=.tmp/scene-check.cjs --log-level=warning && node .tmp/scene-check.cjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require("@napi-rs/canvas") as { createCanvas: (w: number, h: number) => any };

/* ------------------------------------------------------- minimal DOM shim */
const g = globalThis as any;
g.document = {
  createElement: (tag: string) => {
    if (tag !== "canvas") return { style: {}, setAttribute() {}, click() {}, remove() {}, appendChild() {} };
    const c = createCanvas(4, 4);
    c.toBlob = (cb: (b: Blob) => void) => cb(new Blob([c.toBuffer("image/png")], { type: "image/png" }));
    c.toDataURL = () => `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`;
    return c;
  },
  body: { appendChild() {}, removeChild() {} },
};
g.Blob = g.Blob ?? (class {} as any);

async function main() {
  const { buildScene } = await import("../src/core/rig-build");
  const { RIG_MAP } = await import("../src/presets/rigs");
  const { applyDemo, applyScenerySet, applyCameraDemo } = await import("../src/presets/demos");
  const { drawShot, cameraExportBox, motionBounds } = await import("../src/core/shots");
  const { applyCamera, drawCameraOverlay, drawForegroundGuides, drawObjects, drawOverlay, drawParts, drawShadow, fitView, sceneBounds } = await import("../src/core/render");
  const { drawLightGlow, drawLightHandles, drawLightWash, lightAnchor, pickLight } = await import("../src/core/lights");
  const { cameraBox, pickActive, sampleCamera } = await import("../src/core/cameras");
  const { indexScene, poseRotations } = await import("../src/core/rig");
  const { solveFK } = await import("../src/core/fk");
  const { hitTest } = await import("../src/core/hit");
  const { objectBox } = await import("../src/core/scenery");
  const { timelineAt } = await import("../src/core/timeline");
  const { exportGif, exportPng } = await import("../src/io/export");

  let fails = 0;
  const ok = (name: string, cond: boolean, extra = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
    if (!cond) fails++;
  };

  const RIG_IDS = ["kid", "cat", "ninja", "robot", "dragon", "bird", "wizard", "blob"];
  const CW = 300;
  const CH = 250;
  type Cell = { canvas: any; label: string };
  const rows: Cell[][] = [];

  for (const id of RIG_IDS) {
    const def = RIG_MAP.get(id)!;
    const scene = buildScene(def);
    if (def.demo) applyDemo(scene, def.demo);
    const objects = applyScenerySet(scene);
    const cams = applyCameraDemo(scene);
    ok(`${id} demo animates the rig`, Object.keys(scene.tracks).length > 3, `${Object.keys(scene.tracks).length} tracks`);
    ok(`${id} set has scenery + lights`, objects > 8 && (scene.lights ?? []).length >= 2, `${objects} objects, ${scene.lights?.length} lights`);
    ok(`${id} cameras with shots`, cams === 2 && (scene.cameras ?? []).every((c) => c.shots.length > 0), (scene.cameras ?? []).map((c) => `${c.name}:${c.shots.length}`).join(", "));

    // every scenery object must build finite geometry (a broken shape would render as NaN)
    let bad = 0;
    for (const ob of scene.objects ?? []) {
      const b = objectBox(ob, scene, 4);
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.w > 0) || !(b.h > 0)) bad++;
    }
    ok(`${id} scenery geometry is finite`, bad === 0, bad ? `${bad} broken objects` : `${scene.objects?.length} ok`);

    // lights resolve and are pickable
    const pose = solveFK(scene, poseRotations(scene, 4), 4);
    const light = scene.lights![0];
    const hitL = pickLight(scene, pose, lightAnchor(light, scene, pose), 1);
    ok(`${id} lights are pickable`, !!hitL && (scene.lights ?? []).some((l) => l.id === hitL.id), hitL?.name ?? "nothing");

    // cameras frame, and shots drive the sampling window
    const cam = pickActive(scene, scene.activeCamera)!;
    const tl = timelineAt(scene, scene.frames - 1, cam.id);
    ok(`${id} shot 2 drives the timeline`, tl.start > 0 && tl.end === scene.frames - 1, `window ${tl.start}–${tl.end}`);
    const sample = sampleCamera(cam, scene.frames - 1, tl);
    ok(`${id} animated camera has keys`, cam.keys.length >= 2 && sample.zoom !== cam.zoom, `zoom ${cam.zoom.toFixed(2)} → ${sample.zoom.toFixed(2)}`);
    // the establishing shot of the example cameras must actually hold the character
    const wide = scene.cameras![0];
    let inside = true;
    for (let f = wide.shots[0].start; f <= wide.shots[0].end; f += 2) {
      const b = cameraBox(wide, f, 1280, 720, timelineAt(scene, f, wide.id));
      const pf = solveFK(scene, poseRotations(scene, f), f);
      for (const bone of scene.bones) {
        for (const p2 of [pf.pos[bone.id], pf.end[bone.id]]) {
          if (!p2) continue;
          if (p2.x < b.x - 1 || p2.x > b.x + b.w + 1 || p2.y < b.y - 1 || p2.y > b.y + b.h + 1) inside = false;
        }
      }
    }
    ok(`${id} the establishing shot holds the character`, inside, `${wide.name} frames the whole rig`);

    const box = cameraExportBox(scene, 0, scene.frames - 1, 512, 288, "shot", cam.id);
    ok(`${id} shot framing box is sane`, Number.isFinite(box.w) && box.w > 20 && box.h > 20, `${Math.round(box.w)}×${Math.round(box.h)}`);

    // the real export path through the camera must produce bytes and not a blank frame
    const opts = { scale: 0.5, transparent: false, overlay: false, from: 0, to: Math.min(9, scene.frames - 1), framing: "shot" as const, camId: cam.id, aspect: 16 / 9 };
    const still = Buffer.from(await (await exportPng(scene, opts, Math.floor(scene.frames / 2))).arrayBuffer());
    ok(`${id} camera still export`, still.length > 1500, `${still.length}b`);
    const gif = Buffer.from(await (await exportGif(scene, opts)).arrayBuffer());
    ok(`${id} camera gif export`, gif.length > 2000 && gif.subarray(0, 3).toString() === "GIF", `${gif.length}b`);

    // hit-testing scenery + lights through the real hitTest entry point
    const someObj = (scene.objects ?? []).find((o) => o.kind !== "starfield")!;
    const ob = objectBox(someObj, scene, 4);
    const mid = { x: ob.x + ob.w / 2, y: ob.y + ob.h / 2 };
    const view = fitView(scene, pose, 900, 560);
    const hitObj = hitTest(scene, pose, view, mid, { handles: false, parts: false, partsFirst: false, objects: true, lights: true, cameras: true, stageFirst: true, frame: 4 });
    ok(`${id} scenery is hittable (stage mode)`, hitObj?.kind === "object" || hitObj?.kind === "camera" || hitObj?.kind === "light", hitObj?.kind ?? "nothing");
    const sampleAt4 = sampleCamera(cam, 4, timelineAt(scene, 4, cam.id));
    const camHitPt = { x: sampleAt4.x, y: sampleAt4.y };
    const hitCam = hitTest(scene, pose, view, camHitPt, { handles: false, parts: false, partsFirst: false, objects: true, lights: true, cameras: true, stageFirst: true, frame: 4 });
    ok(`${id} camera is hittable`, hitCam?.kind === "camera", hitCam?.kind ?? "nothing");

    // ------------------------------------------------------------ contact sheet row
    const cells: Cell[] = [];
    const framesToDraw = [2, Math.floor(scene.frames * 0.5), scene.frames - 3];
    for (const f of framesToDraw) {
      const p = solveFK(scene, poseRotations(scene, f), f);
      const v = fitView(scene, p, CW, CH, 40);
      const canvas = createCanvas(CW, CH);
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      const g2 = ctx.createLinearGradient(0, 0, 0, CH);
      g2.addColorStop(0, scene.bgTop);
      g2.addColorStop(1, scene.bgBottom);
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, CW, CH);
      applyCamera(ctx, v, 1);
      const k = 1 / v.cam.zoom;
      drawLightWash(ctx, scene, p, f, v);
      drawForegroundGuides(ctx, scene, v, { grid: false, ground: true });
      drawObjects(ctx, scene, f, "back", { k });
      drawShadow(ctx, scene, p);
      drawParts(ctx, scene, p, { outlines: true });
      drawObjects(ctx, scene, f, "front", { k });
      drawLightGlow(ctx, scene, p, f, v);
      drawOverlay(ctx, scene, p, v, { showBones: false, showHandles: false, drag: null });
      if (f === framesToDraw[1]) {
        drawCameraOverlay(ctx, scene, f, v, scene.activeCamera ?? null);
        drawLightHandles(ctx, scene, p, v, null);
      }
      cells.push({ canvas, label: `${id} · frame ${f}` });
      ok(`${id} frame ${f} renders content`, sceneBounds(scene, p).w > 10, `w=${Math.round(sceneBounds(scene, p).w)}`);
    }
    rows.push(cells);
  }

  // ------------------------------------------------------------------ sheet
  mkdirSync(".tmp", { recursive: true });
  const sheet = createCanvas(CW * 3 + 8, (CH + 20) * rows.length);
  const sctx = sheet.getContext("2d") as unknown as CanvasRenderingContext2D;
  sctx.fillStyle = "#0c0d14";
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  rows.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      sctx.drawImage(cell.canvas, c * CW + 4, r * (CH + 20) + 16);
      sctx.fillStyle = "#8f9ab8";
      sctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      sctx.fillText(cell.label, c * CW + 10, r * (CH + 20) + 11);
    });
  });
  writeFileSync(".tmp/set-sheet.png", sheet.toBuffer("image/png"));
  console.log(`\nwrote .tmp/set-sheet.png (${sheet.width}x${sheet.height})`);

  // -------------------------------------------------- one scenic shot export
  const showcase = buildScene(RIG_MAP.get("wizard")!);
  applyDemo(showcase, "cast");
  applyScenerySet(showcase);
  applyCameraDemo(showcase);
  const frameCanvas = createCanvas(960, 540);
  const fctx = frameCanvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const mid = Math.floor(showcase.frames * 0.75);
  drawShot(fctx, showcase, mid, { w: 960, h: 540, framing: "camera", camId: showcase.activeCamera, overlay: false, box: motionBounds(showcase, 0, showcase.frames - 1) });
  writeFileSync(".tmp/set-camera-frame.png", frameCanvas.toBuffer("image/png"));
  const data = fctx.getImageData(0, 0, 960, 540).data;
  const colors = new Set<number>();
  for (let i = 0; i < data.length; i += 4 * 977) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  ok("camera frame is not blank", colors.size > 40, `${colors.size} sampled colours`);
  console.log("wrote .tmp/set-camera-frame.png (960x540)");

  console.log(fails ? `\n${fails} FAILURES` : "\nall scene checks passed");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error("threw:", e);
  process.exit(2);
});
