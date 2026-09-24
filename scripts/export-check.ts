/**
 * Headless smoke test for the export pipeline (node + @napi-rs/canvas).
 * Run:
 *   npx esbuild scripts/export-check.ts --bundle --platform=node --format=cjs \
 *     --external:@napi-rs/canvas --outfile=.tmp/export-check.cjs --log-level=warning && node .tmp/export-check.cjs
 */
import { writeFileSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require("@napi-rs/canvas") as { createCanvas: (w: number, h: number) => any };

// --- minimal DOM shim so the browser-side exporter code runs in node ---
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
  const { applyDemo } = await import("../src/presets/demos");
  const { motionBounds } = await import("../src/core/shots");
  const { exportGif, exportPng, exportPngZip, exportSpriteSheet, projectBlob, parseProject } = await import(
    "../src/io/export"
  );

  const { applyScenerySet, applyCameraDemo } = await import("../src/presets/demos");
  const { cameraExportBox } = await import("../src/core/shots");

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name} ${extra}`);
    if (!ok) failures++;
  };

  for (const id of ["kid", "robot", "dragon", "blob", "cat", "ninja", "bird", "wizard"]) {
    const def = RIG_MAP.get(id)!;
    const scene = buildScene(def);
    if (def.demo) applyDemo(scene, def.demo);
    const to = Math.min(11, scene.frames - 1);
    const box = motionBounds(scene, 0, to);
    check(`${id} bounds`, Number.isFinite(box.w) && box.w > 10 && box.h > 10, `${Math.round(box.w)}x${Math.round(box.h)}`);

    const opts = { scale: 0.42, transparent: true, overlay: false, from: 0, to };
    const gif = await exportGif(scene, opts);
    const gifBytes = Buffer.from(await gif.arrayBuffer());
    check(`${id} gif`, gifBytes.length > 2000 && gifBytes.subarray(0, 3).toString() === "GIF", `${gifBytes.length}b`);
    if (id === "kid") writeFileSync(".tmp/out-kid.gif", gifBytes);

    const zip = await exportPngZip(scene, opts);
    const zipBytes = Buffer.from(await zip.arrayBuffer());
    check(`${id} png-zip`, zipBytes.length > 2000 && zipBytes.subarray(0, 2).toString() === "PK", `${zipBytes.length}b`);

    const sheet = await exportSpriteSheet(scene, { ...opts, scale: 0.34 }, 4);
    const sheetPng = Buffer.from(await sheet.png.arrayBuffer());
    check(`${id} sheet`, sheetPng.length > 1000, `${sheet.cols}x${sheet.rows} @${sheet.cw}x${sheet.ch}`);
    const meta = JSON.parse(sheet.json);
    check(`${id} sheet json`, Array.isArray(meta.frames) && meta.frames.length === to + 1, `${meta.frames?.length} frames`);
    if (id === "kid") writeFileSync(".tmp/out-kid-sheet.png", sheetPng);

    const still = await exportPng(scene, { scale: 0.5, transparent: false, overlay: true, from: 0, to: 0 });
    const stillBytes = Buffer.from(await still.arrayBuffer());
    check(`${id} still`, stillBytes.length > 1500, `${stillBytes.length}b`);
    writeFileSync(`.tmp/out-${id}.png`, stillBytes);

    // ------------------------------------------------ set + camera exports
    applyScenerySet(scene);
    const cams = applyCameraDemo(scene);
    check(`${id} set+frames build`, cams === 2 && (scene.objects?.length ?? 0) > 8 && (scene.lights?.length ?? 0) >= 2,
      `${scene.objects?.length} objects, ${scene.lights?.length} lights`);

    const camOpts = { scale: 0.4, transparent: false, overlay: false, from: 0, to, framing: "shot" as const, camId: scene.activeCamera ?? null, aspect: 16 / 9 };
    const camGif = Buffer.from(await (await exportGif(scene, camOpts)).arrayBuffer());
    check(`${id} gif through the camera`, camGif.length > 2000 && camGif.subarray(0, 3).toString() === "GIF", `${camGif.length}b`);

    const camZip = Buffer.from(await (await exportPngZip(scene, camOpts)).arrayBuffer());
    check(`${id} png zip through the camera`, camZip.length > 2000 && camZip.subarray(0, 2).toString() === "PK", `${camZip.length}b`);

    const camSheet = await exportSpriteSheet(scene, { ...camOpts, framing: "camera" }, 4);
    const camSheetBytes = Buffer.from(await camSheet.png.arrayBuffer());
    check(`${id} sprite sheet rendered through the camera`, camSheetBytes.length > 1000, `${camSheet.cols}x${camSheet.rows} @${camSheet.cw}x${camSheet.ch}`);

    const camStill = Buffer.from(await (await exportPng(scene, camOpts, Math.floor(scene.frames / 2))).arrayBuffer());
    check(`${id} still through the camera`, camStill.length > 1500, `${camStill.length}b`);

    const cineBox = cameraExportBox(scene, 0, to, 1280, 720, "camera", scene.activeCamera);
    const steadyBox = cameraExportBox(scene, 0, to, 1280, 720, "shot", scene.activeCamera);
    check(
      `${id} cinematic framing is wider than a single frame`,
      cineBox.w > 0 && steadyBox.w > 0 && steadyBox.w >= cineBox.w * 0.98,
      `camera ${Math.round(cineBox.w)}u, shot ${Math.round(steadyBox.w)}u`,
    );
    if (id === "cat") writeFileSync(".tmp/out-cat-camera.png", camStill);

    const text = await (await projectBlob(scene)).text();
    const back = parseProject(text);
    check(
      `${id} project round-trip`,
      back.scene.bones.length === scene.bones.length &&
        back.scene.shapes.length === scene.shapes.length &&
        Object.keys(back.scene.tracks).length === Object.keys(scene.tracks).length &&
        (back.scene.objects?.length ?? 0) === (scene.objects?.length ?? 0) &&
        (back.scene.lights?.length ?? 0) === (scene.lights?.length ?? 0) &&
        (back.scene.cameras?.length ?? 0) === (scene.cameras?.length ?? 0),
      `${back.scene.bones.length} bones / ${back.scene.shapes.length} parts / ${back.scene.objects?.length ?? 0} objects / ${back.scene.cameras?.length ?? 0} cameras`,
    );
  }

  console.log(failures ? `\n${failures} FAILURES` : "\nall export checks passed");
  process.exit(failures ? 1 : 0);
}

void main();
