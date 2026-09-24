/**
 * Headless exercise of every store action the UI calls.
 * Run:
 *   npx esbuild scripts/store-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/store-check.cjs --log-level=warning && node .tmp/store-check.cjs
 */
import { useStudio } from "../src/state/store";
import { indexScene, poseRotations } from "../src/core/rig";
import { solveFK, shapeWorldPoints } from "../src/core/fk";
import { cameraBox, sampleCamera } from "../src/core/cameras";
import { lightAnchor } from "../src/core/lights";
import { sceneBounds } from "../src/core/render";
import { timelineAt } from "../src/core/timeline";

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};
const st = () => useStudio.getState();

function keyCount(boneId: string, frame: number): number {
  const tr = st().scene.tracks[boneId];
  if (!tr) return 0;
  return tr.rot.filter((k) => k.t === frame).length + tr.pos.filter((k) => k.t === frame).length;
}

async function main() {
  // ------------------------------------------------------------- boot state
  ok("boot", st().scene.bones.length > 8 && st().scene.frames > 8, `${st().scene.bones.length} bones, ${st().scene.frames} frames, rig=${st().scene.rigId}`);
  ok("boot has chains", st().scene.chains.length >= 2, st().scene.chains.map((c) => c.name).join(", "));
  ok("boot is keyed", Object.keys(st().scene.tracks).length > 3);

  // ------------------------------------------------------------------ posing
  const chain = st().scene.chains[0];
  const poseBefore = { ...poseRotations(st().scene, st().frame) };
  const f0 = st().frame;
  st().checkpoint("ik");
  const rootBone = indexScene(st().scene).roots[0];
  const target = { ...solveFK(st().scene, poseBefore, f0).end[chain.bones[chain.bones.length - 1]] };
  st().ikDrag(chain.id, { x: target.x + 22, y: target.y - 30 });
  ok("ikDrag fills live buffer", !!st().live && Object.keys(st().live.rot).length > 0, `${Object.keys(st().live?.rot ?? {}).length} bones live`);
  ok("scene untouched while dragging", poseRotations(st().scene, f0)[chain.bones[0]] === poseBefore[chain.bones[0]]);
  st().commitLive();
  const after = poseRotations(st().scene, f0);
  ok("commitLive bakes keys", JSON.stringify(after) !== JSON.stringify(poseBefore) && keyCount(chain.bones[0], f0) === 1);
  ok("live cleared after commit", st().live === null);
  const undoDepth = st().past.length;
  st().undo();
  ok("undo reverts the IK bake", JSON.stringify(poseRotations(st().scene, f0)) === JSON.stringify(poseBefore));
  st().redo();
  ok("redo replays it", JSON.stringify(poseRotations(st().scene, f0)) === JSON.stringify(after));
  ok("undo/redo keep history", st().past.length === undoDepth - 1 || st().past.length === undoDepth, `past=${st().past.length} future=${st().future.length}`);
  void rootBone;

  // -------------------------------------------------------------- root drag
  const rootId = indexScene(st().scene).roots[0].id;
  const rootBefore = { ...st().scene.root };
  st().checkpoint("root");
  st().rootDrag({ x: rootBefore.x + 40, y: rootBefore.y });
  st().commitLive();
  ok("root drag moves the character", st().scene.root.x !== rootBefore.x || keyCount(rootId, f0) > 0, `root=${Math.round(st().scene.root.x)} keys=${keyCount(rootId, f0)}`);

  // ------------------------------------------------------------------ parts
  const shapesBefore = st().scene.shapes.length;
  st().addPart("star", chain.bones[chain.bones.length - 1]);
  ok("addPart welds art to a bone", st().scene.shapes.length === shapesBefore + 1);
  const added = st().scene.shapes[st().scene.shapes.length - 1];
  st().reorderShape(added.id, "back");
  const zBack = st().scene.shapes.find((s) => s.id === added.id)!.z;
  ok("reorderShape to back", zBack === 0, `z=${zBack}`);
  st().reorderShape(added.id, "front");
  ok("reorderShape to front", st().scene.shapes.find((s) => s.id === added.id)!.z === st().scene.shapes.length - 1);
  st().setShapeRole(added.id, "accent");
  st().setShapeFill(added.id, "#ff00aa");
  ok("setShapeFill", st().scene.shapes.find((s) => s.id === added.id)!.fill === "#ff00aa");
  st().duplicateShape(added.id);
  ok("duplicateShape", st().scene.shapes.length === shapesBefore + 2);
  const dup = st().scene.shapes[st().scene.shapes.length - 1];
  st().deleteShape(dup.id);
  st().deleteShape(added.id);
  ok("deleteShape x2", st().scene.shapes.length === shapesBefore);

  // ---------------------------------------------------------- shape dragging
  const victim = st().scene.shapes[0];
  const ptsBefore = victim.pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
  st().setLive({ shapes: { [victim.id]: victim.pts.map((p) => ({ x: p.x + 5, y: p.y })) } });
  st().commitLive();
  const ptsAfter = st().scene.shapes.find((s) => s.id === victim.id)!.pts;
  ok("art drag edits points", ptsAfter.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ") !== ptsBefore);

  // ------------------------------------------------------------------- draw
  const shapesB2 = st().scene.shapes.length;
  st().setDrawPoints([
    { x: 0, y: 0 },
    { x: 30, y: 2 },
    { x: 34, y: 26 },
    { x: 4, y: 30 },
    { x: 16, y: 14 },
    { x: 30, y: 2 },
    { x: 0, y: 0 },
  ]);
  st().finishDraw();
  ok("finishDraw makes a welded shape", st().scene.shapes.length === shapesB2 + 1 && st().drawPoints.length === 0);
  st().deleteShape(st().scene.shapes[st().scene.shapes.length - 1].id);

  // ------------------------------------------------------------------- rig
  const bonesBefore = st().scene.bones.length;
  const headId = st().scene.bones.find((b) => b.name.toLowerCase().includes("head"))?.id ?? st().scene.bones[0].id;
  const headPose = solveFK(st().scene, poseRotations(st().scene, st().frame), st().frame);
  const tip = headPose.end[headId];
  const newId = st().addBone(headId, tip, { x: tip.x + 26, y: tip.y - 6 });
  ok("addBone grows a bone", st().scene.bones.length === bonesBefore + 1, `id=${newId}`);
  const nb = st().scene.bones.find((b) => b.id === newId)!;
  ok("grown bone has sane rest length", Math.abs(nb.length - Math.hypot(26, 6)) < 0.5, `len=${nb.length.toFixed(1)}`);
  st().updateBone(newId, { length: 40 });
  ok("updateBone length", st().scene.bones.find((b) => b.id === newId)!.length === 40);
  st().setLimits(newId, { min: -0.5, max: 0.5 });
  ok("setLimits", (st().scene.bones.find((b) => b.id === newId)!.min ?? 0) === -0.5);
  st().zeroBone(newId);
  ok("zeroBone keys 0 rotation", keyCount(newId, st().frame) >= 1);
  st().toggleChainPick(newId);
  st().toggleChainPick(headId);
  ok("chainPick records clicks", st().chainPick.length === 2, st().chainPick.join(","));
  const chainsBefore = st().scene.chains.length;
  st().makeChainFromPick(true);
  ok("makeChainFromPick builds a chain", st().scene.chains.length === chainsBefore + 1, st().scene.chains.map((c) => c.name).join(", "));
  const made = st().scene.chains[st().scene.chains.length - 1];
  st().setChainPole(made.id, false);
  st().toggleChain(made.id);
  ok("toggleChain flips visibility", st().scene.chains.find((c) => c.id === made.id)!.show === false);
  st().deleteChain(made.id);
  ok("deleteChain also clears picks", st().scene.chains.every((c) => c.id !== made.id) && st().chainPick.length === 0);
  st().reparentBone(newId, null);
  ok("reparentBone to root", st().scene.bones.find((b) => b.id === newId)!.parent === null);
  st().deleteBone(newId);
  ok("deleteBone removes bone + its tracks", st().scene.bones.length === bonesBefore && st().scene.tracks[newId] === undefined);
  st().autoRig();
  ok("autoRig finds spare limbs", st().scene.chains.length >= 2, `${st().scene.chains.length} chains`);
  st().fitPartsToBones();
  ok("fitPartsToBones keeps shapes", st().scene.shapes.length > 5);

  // ------------------------------------------------------------- dopesheet
  st().setFrame(4);
  st().keyCurrentPose();
  ok("keyCurrentPose keys every bone", st().scene.bones.every((b) => keyCount(b.id, 4) >= 1), `${st().scene.bones.length} bones`);
  const someBone = st().scene.bones[3].id;
  st().setKeySel(someBone, [4]);
  st().moveSelectedKeys(2);
  const ts = (st().scene.tracks[someBone]?.rot ?? []).map((k) => k.t).join(",");
  ok("moveSelectedKeys", keyCount(someBone, 6) === 1 && keyCount(someBone, 4) === 0, `rot frames now: ${ts}`);
  st().setKeySel(someBone, [6]);
  st().setEaseOnSelected("bounce");
  ok("setEaseOnSelected", st().scene.tracks[someBone].rot.find((k) => k.t === 6)!.ease === "bounce");
  st().deleteKeysAt(6, someBone);
  ok("deleteKeysAt", keyCount(someBone, 6) === 0);
  st().setFrames(20);
  ok("setFrames truncates keys", st().scene.frames === 20 && st().scene.bones.every((b) => (st().scene.tracks[b.id]?.rot ?? []).every((k) => k.t < 20)), `frames=${st().scene.frames}`);
  st().setFrames(30);
  ok("setFrames grows length", st().scene.frames === 30);
  st().setFps(12);
  ok("setFps", st().scene.fps === 12);
  st().setLoop(false);
  ok("setLoop", st().scene.loop === false);
  st().clearAllKeys();
  ok("clearAllKeys empties tracks", st().scene.bones.every((b) => (st().scene.tracks[b.id]?.rot.length ?? 0) === 0));
  st().setFrames(16);
  st().setFps(8);

  // ------------------------------------------------------------ pose library
  st().setFrame(2);
  st().ikDrag(st().scene.chains[0].id, { x: 30, y: -60 });
  st().commitLive();
  st().savePose("wave-ish");
  ok("savePose", st().poseLib.some((p) => p.name === "wave-ish"));
  st().setFrame(5);
  const atFive = { ...poseRotations(st().scene, 5) };
  st().applyPose("wave-ish");
  ok("applyPose writes keys at the current frame", keyCount(st().scene.bones[0].id, 5) >= 1 && JSON.stringify(poseRotations(st().scene, 5)) === JSON.stringify(atFive));
  st().copyPose();
  st().setFrame(6);
  st().pastePose();
  ok("pastePose at another frame", keyCount(st().scene.bones[0].id, 6) >= 1);
  st().deletePose("wave-ish");
  ok("deletePose", !st().poseLib.some((p) => p.name === "wave-ish"));

  // ----------------------------------------------------------------- mirror
  st().loadRig("robot", false);
  ok("loadRig robot", st().scene.rigId === "robot" && st().scene.bones.length > 8);
  const armL = st().scene.bones.find((b) => b.name.toLowerCase().includes("arm") && b.mirror);
  ok("robot has mirrored twins", !!armL, armL ? `${armL.name} ↔ ${armL.mirror}` : "none");
  if (armL) {
    st().toggleFlag("mirrorX");
    const p = solveFK(st().scene, poseRotations(st().scene, st().frame), st().frame);
    st().checkpoint("mirror");
    st().rotBoneAim(armL.id, { x: p.end[armL.id].x + 30, y: p.end[armL.id].y - 40 });
    const live = st().live?.rot ?? {};
    ok("mirror drives the twin too", live[armL.mirror!] !== undefined, `${Object.keys(live).length} live rotations`);
    st().commitLive();
    st().toggleFlag("mirrorX");
  }

  // ------------------------------------------------------------------ demos
  st().applyDemoNow("wave");
  ok("applyDemoNow generates keys", Object.keys(st().scene.tracks).length > 3 && st().scene.tracks[st().scene.bones[0].id].rot.length > 2);
  const world = shapeWorldPoints(st().scene.shapes[0], solveFK(st().scene, poseRotations(st().scene, 3), 3));
  ok("shapes still resolve in world space", world.length > 2 && world.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));

  // --------------------------------------------------------------- scene io
  st().setPalette("robot");
  ok("setPalette", st().scene.palette.skin !== undefined && Object.keys(st().scene.palette).length >= 6, JSON.stringify(st().scene.palette).slice(0, 40));
  st().setOutline("#101018");
  st().setBg("#223", "#112");
  st().setGround(30);
  ok("backdrop edits", st().scene.outline === "#101018" && st().scene.ground === 30);
  st().renameScene("My toon");
  ok("renameScene", st().scene.name === "My toon");
  const snapshot = st().scene;
  st().newScene();
  ok("newScene starts blank", st().scene.bones.length <= 3 && st().mode === "rig", `mode=${st().mode}`);
  st().loadScene(snapshot, "restore", true);
  ok("loadScene restores", st().scene.name === "My toon" && st().scene.shapes.length === snapshot.shapes.length);

  // -------------------------------------------------- autoKey off behaviour
  st().setAutoKey(false);
  st().setFrame(1);
  const before1 = { ...poseRotations(st().scene, 1) };
  st().checkpoint("preview only");
  st().ikDrag(st().scene.chains[0].id, { x: 10, y: -40 });
  st().commitLive();
  ok("autoKey off = no keys written", JSON.stringify(poseRotations(st().scene, 1)) === JSON.stringify(before1));
  ok("autoKey off warns", (st().toast?.msg ?? "").includes("Auto-key"), st().toast?.msg ?? "");
  st().undo();
  st().setAutoKey(true);

  // ------------------------------------------------------------- transport
  st().setPlaying(true);
  ok("setPlaying", st().playing === true);
  st().togglePlay();
  ok("togglePlay", st().playing === false);
  st().setFrame(9);
  st().step(5);
  ok("step forward", st().frame === 14);
  st().setFrame(st().scene.frames - 1);
  st().step(3);
  ok("step clamps to length", st().frame <= st().scene.frames - 1);
  st().setSpeed(2);
  ok("setSpeed", st().speed === 2);
  st().zoomAt(1.25, { x: 200, y: 200 });
  st().panBy(12, -8);
  st().setView({ w: 800, h: 500 });
  ok("view edits", st().view.w === 800 && st().view.h === 500);
  st().fit();
  ok("fit yields a finite zoom", Number.isFinite(st().view.cam.zoom) && st().view.cam.zoom > 0.05, `zoom=${st().view.cam.zoom.toFixed(2)}`);
  st().setMode("art");
  st().select("shape", st().scene.shapes[1]?.id ?? null);
  ok("select shape", st().selection.kind === "shape" && !!st().selection.id);
  st().setBusy("working");
  ok("setBusy", st().busy === "working");
  st().setBusy(null);
  ok("history not polluted by UI state", st().past.every((p) => !!p.scene.bones.length));

  // ------------------------------------------------------- new characters
  for (const id of ["cat", "ninja", "bird", "wizard"]) {
    st().loadRig(id, true);
    const sc = st().scene;
    const keyed = Object.values(sc.tracks).reduce((n, t) => n + t.rot.length, 0);
    ok(`loadRig ${id} (rig + demo)`, sc.rigId === id && sc.bones.length > 10 && sc.chains.length >= 3 && sc.shapes.length > 10 && keyed > 10,
      `${sc.bones.length} bones, ${sc.chains.length} chains, ${sc.shapes.length} parts, ${keyed} keys`);
    const finiteShapes = sc.shapes.every((sh) => sh.pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    ok(`${id} art is finite`, finiteShapes);
    const pose = solveFK(sc, poseRotations(sc, Math.floor(sc.frames / 2)), Math.floor(sc.frames / 2));
    const moved = Object.keys(pose.pos).filter((b) => Number.isFinite(pose.pos[b].x) && Number.isFinite(pose.pos[b].y));
    ok(`${id} solves a pose every frame`, moved.length === sc.bones.length, `${moved.length}/${sc.bones.length} joints`);
  }

  // ------------------------------------------------------- character rotation
  st().loadRig("cat", false);
  {
    const sc0 = st().scene;
    const pose0 = solveFK(sc0, poseRotations(sc0, 0), 0);
    const before = { x: pose0.end[sc0.bones[2].id].x, y: pose0.end[sc0.bones[2].id].y };
    st().setRigRoot({ rot: Math.PI / 2 });
    const sc1 = st().scene;
    ok("setRigRoot stores the rotation", Math.abs((sc1.rootRot ?? 0) - Math.PI / 2) < 1e-6);
    const pose1 = solveFK(sc1, poseRotations(sc1, 0), 0);
    const after = pose1.end[sc1.bones[2].id];
    const root = pose1.pos[sc1.bones[0].id];
    const r0 = Math.hypot(before.x - root.x, before.y - root.y);
    const r1 = Math.hypot(after.x - root.x, after.y - root.y);
    ok("turning the rig keeps every bone at its own distance", Math.abs(r0 - r1) < 1.5, `${r0.toFixed(1)} → ${r1.toFixed(1)}`);
    const a0 = Math.atan2(before.y - root.y, before.x - root.x);
    const a1 = Math.atan2(after.y - root.y, after.x - root.x);
    ok("turning the rig rotates the whole skeleton", Math.abs(Math.atan2(Math.sin(a1 - a0 - Math.PI / 2), Math.cos(a1 - a0 - Math.PI / 2))) < 0.05,
      `${((a1 - a0) * 180 / Math.PI).toFixed(1)}°`);
    st().setRigRoot({ rot: 0 });
    st().checkpoint("turn");
    st().rotateRigBy(0.4);
    ok("rotateRigBy feeds the live buffer", Math.abs((st().live?.rot?.[st().scene.bones[0].id] ?? 0) - 0.4) < 1e-6);
    st().commitLive();
    ok("the turn is keyed on the root bone", keyCount(st().scene.bones[0].id, st().frame) === 1);
  }

  // ------------------------------------------------------------- scenery
  st().loadRig("kid", false);
  {
    const n0 = st().scene.objects?.length ?? 0;
    const id = st().addObject("pine", { x: 10, y: 40 });
    ok("addObject places scenery", (st().scene.objects?.length ?? 0) === n0 + 1);
    const ob = st().scene.objects!.find((o) => o.id === id)!;
    ok("placed object sits where it was dropped", ob.x === 10 && ob.y === 40 && ob.scale === 1, `${ob.x},${ob.y}`);
    st().updateObject(id, { scale: 1.4, rot: 0.3, role: "cloth" });
    const upd = st().scene.objects!.find((o) => o.id === id)!;
    ok("updateObject edits props", upd.scale === 1.4 && Math.abs(upd.rot - 0.3) < 1e-6);
    st().reorderObject(id, "front");
    ok("reorderObject can lift scenery in front of the character", st().scene.objects!.find((o) => o.id === id)!.z >= 1);
    st().reorderObject(id, "back");
    ok("reorderObject can push scenery behind the character", st().scene.objects!.find((o) => o.id === id)!.z < 1);
    st().stageDrag(id, { x: 99, y: 22 });
    st().commitLive();
    ok("dragging scenery commits it", st().scene.objects!.find((o) => o.id === id)!.x === 99);
    const uni = solveFK(st().scene, poseRotations(st().scene, 0), 0);
    const shp = sceneBounds(st().scene, uni);
    ok("scenery grows the scene bounds", Number.isFinite(shp.w) && shp.w > 0, `${Math.round(shp.w)} wide`);
    st().duplicateObject(id);
    ok("duplicateObject copies it", (st().scene.objects?.length ?? 0) === n0 + 2);
    st().deleteObject(id);
    st().deleteObject(st().scene.objects![st().scene.objects!.length - 1].id);
    ok("deleteObject clears it", (st().scene.objects?.length ?? 0) === n0);
    st().scatterObjects("pine", 5);
    ok("scatterObjects plants several", (st().scene.objects?.length ?? 0) === n0 + 5);
    ok("scattered objects vary", new Set(st().scene.objects!.map((o) => o.scale)).size > 1);
    st().deleteObject(st().scene.objects![0].id);
    st().deleteObject(st().scene.objects![0].id);
    st().deleteObject(st().scene.objects![0].id);
    st().deleteObject(st().scene.objects![0].id);
    st().deleteObject(st().scene.objects![0].id);
    ok("scenery cleared", (st().scene.objects?.length ?? 0) === n0);
  }

  // -------------------------------------------------------------- lights
  {
    const id = st().addLight("fire", { x: 0, y: 0 });
    ok("addLight creates a light", (st().scene.lights?.length ?? 0) === 1 && st().selection.kind === "light");
    st().updateLight(id, { intensity: 1.5, radius: 400, flicker: 0.3 });
    const l = st().scene.lights![0];
    ok("updateLight edits it", l.intensity === 1.5 && l.radius === 400 && l.flicker === 0.3);
    const anchor = lightAnchor(l, st().scene, solveFK(st().scene, poseRotations(st().scene, 0), 0));
    ok("light anchor resolves", Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
    st().attachLightTo(id, st().scene.bones[2].id);
    ok("attachLightTo can ride a bone", st().scene.lights![0].follow === st().scene.bones[2].id);
    const anchored = lightAnchor(st().scene.lights![0], st().scene, solveFK(st().scene, poseRotations(st().scene, 0), 0));
    const bonePos = solveFK(st().scene, poseRotations(st().scene, 0), 0).pos[st().scene.bones[2].id];
    ok("a bone-following light sits on the bone", Math.hypot(anchored.x - bonePos.x, anchored.y - bonePos.y) < 1e-6);
    st().deleteLight(id);
    ok("deleteLight removes it", (st().scene.lights?.length ?? 0) === 0);
    st().addExampleScenery();
    ok("example scenery includes objects + lights", (st().scene.objects?.length ?? 0) > 8 && (st().scene.lights?.length ?? 0) >= 2,
      `${st().scene.objects?.length} objects, ${st().scene.lights?.length} lights`);
    while ((st().scene.lights?.length ?? 0)) st().deleteLight(st().scene.lights![0].id);
    while ((st().scene.objects?.length ?? 0)) st().deleteObject(st().scene.objects![0].id);
  }

  // ------------------------------------------------------------- cameras
  {
    ok("no cameras at boot", (st().scene.cameras?.length ?? 0) === 0);
    const camId = st().addCamera();
    ok("addCamera frames the stage", st().scene.cameras!.length === 1 && st().scene.activeCamera === camId && st().mode === "camera");
    const cam0 = st().scene.cameras![0];
    ok("a new camera already owns one shot", cam0.shots.length === 1 && cam0.shots[0].start === 0);
    ok("camera zoom is normalised to 720px", cam0.zoom > 0.2 && cam0.zoom < 20, `zoom=${cam0.zoom.toFixed(2)}`);

    // a shot splits the timeline: sampling must clamp inside the current shot
    st().addShot(camId, 10, 15);
    const cam1 = st().scene.cameras![0];
    ok("addShot splits the shot", cam1.shots.length === 2, cam1.shots.map((s2) => `${s2.start}-${s2.end}`).join(", "));
    ok("the second shot does not overlap the first", cam1.shots[1].start > cam1.shots[0].end);
    st().setFrame(cam1.shots[1].start);
    const tl = timelineAt(st().scene, st().frame, camId);
    ok("the shot owns the timeline window", tl.start === cam1.shots[1].start && tl.end === cam1.shots[1].end, `${tl.start}–${tl.end}`);
    st().updateShot(camId, 1, { start: st().scene.cameras![0].shots[1].start + 1 });
    ok("updateShot re-times a take", st().scene.cameras![0].shots[1].start === cam1.shots[1].start + 1);
    st().deleteShot(camId, 1);
    ok("deleteShot drops it", st().scene.cameras![0].shots.length === 1);

    // keyed camera moves — put the playhead back inside a shot first
    st().updateShot(camId, 0, { start: 0, end: st().scene.frames - 1 });
    st().setFrame(6);
    const f0 = st().frame;
    ok("the whole scene is one take again", st().scene.cameras![0].shots.length === 1 && st().scene.cameras![0].shots[0].end === st().scene.frames - 1);
    st().keyCamera(camId, f0);
    st().setFrame(f0 + 4);
    st().zoomCamera(camId, 1.5);
    st().updateCamera(camId, { x: st().scene.cameras![0].x + 12, y: st().scene.cameras![0].y - 6 });
    st().keyCamera(camId, f0 + 4);
    const cam2 = st().scene.cameras![0];
    ok("keyCamera stores marks", cam2.keys.length >= 2, `${cam2.keys.length} keys`);
    const early = sampleCamera(cam2, f0, timelineAt(st().scene, f0, camId));
    const later = sampleCamera(cam2, f0 + 4, timelineAt(st().scene, f0 + 4, camId));
    ok("a keyed camera moves", Math.abs(later.zoom - early.zoom) > 0.01 && Math.abs(later.x - early.x) > 1,
      `zoom ${early.zoom.toFixed(2)} → ${later.zoom.toFixed(2)}`);
    const mid = sampleCamera(cam2, f0 + 2, timelineAt(st().scene, f0 + 2, camId));
    ok("camera moves interpolate", mid.zoom > Math.min(early.zoom, later.zoom) - 1e-6 && mid.zoom < Math.max(early.zoom, later.zoom) + 1e-6);

    // camera keys are dopesheet citizens: select / move / ease / delete through the store
    st().setKeySel(`cam:${camId}`, [f0 + 4]);
    st().moveSelectedKeys(-2);
    ok("camera keys can be dragged in the dopesheet", st().scene.cameras![0].keys.some((k) => k.t === f0 + 2));
    st().setKeySel(`cam:${camId}`, [f0 + 2]);
    st().setEaseOnSelected("bounce");
    ok("camera keys take easing", st().scene.cameras![0].keys.find((k) => k.t === f0 + 2)!.ease === "bounce");
    st().setKeySel(`cam:${camId}`, [f0 + 2]);
    st().deleteSelectedKeys();
    ok("camera keys can be deleted", !st().scene.cameras![0].keys.some((k) => k.t === f0 + 2));
    st().easeCameraKeys(camId, st().scene.cameras![0].keys.map((k) => k.t), "linear");
    ok("easeCameraKeys sets a batch", st().scene.cameras![0].keys.every((k) => k.ease === "linear"));

    // camera body drag writes into the live buffer, then commits — an animated camera gains a move
    const keysBefore = st().scene.cameras![0].keys.length;
    const dragFrame = st().frame;
    st().checkpoint("camera drag");
    st().stageDrag(camId, { x: 40, y: -20 });
    ok("dragging a camera fills the live buffer", Object.keys(st().live?.objs ?? {}).length === 1);
    st().commitLive();
    ok("the camera drag commits", st().live === null && Math.abs(st().scene.cameras![0].x - 40) < 1e-6);
    ok(
      "dragging an animated camera keys the move at this frame",
      st().scene.cameras![0].keys.length === keysBefore + 1 && st().scene.cameras![0].keys.some((k) => k.t === dragFrame && Math.abs(k.x - 40) < 1e-6),
      `${keysBefore} → ${st().scene.cameras![0].keys.length} keys`,
    );

    st().clearCameraKeys(camId);
    ok("clearCameraKeys locks it off", st().scene.cameras![0].keys.length === 0);
    st().frameCameraOnContent(camId);
    const framed = sampleCamera(st().scene.cameras![0], st().frame, timelineAt(st().scene, st().frame, camId));
    ok("frameCameraOnContent fits the character", framed.zoom > 0.1 && Number.isFinite(framed.x) && Number.isFinite(framed.y), `zoom=${framed.zoom.toFixed(2)}`);
    {
      // the fitted lens must actually contain the whole character during the take
      const camNow = st().scene.cameras!.find((c) => c.id === camId)!;
      const win = timelineAt(st().scene, st().frame, camId);
      let inside = true;
      for (let f = win.start; f <= win.end; f += 2) {
        const b = cameraBox(camNow, f, 1280, 720, win);
        const pose = solveFK(st().scene, poseRotations(st().scene, f, undefined, camId), f);
        for (const bone of st().scene.bones) {
          for (const p2 of [pose.pos[bone.id], pose.end[bone.id]]) {
            if (!p2) continue;
            if (p2.x < b.x - 1 || p2.x > b.x + b.w + 1 || p2.y < b.y - 1 || p2.y > b.y + b.h + 1) inside = false;
          }
        }
      }
      ok("the framed camera keeps the character in shot", inside, "joints inside the lens rect for the whole take");
    }
    st().fitAll();
    ok("fitAll keeps the camera finite", Number.isFinite(st().view.cam.zoom) && st().view.cam.zoom > 0.02, `zoom=${st().view.cam.zoom.toFixed(2)}`);
    st().addExampleCameras();
    ok("example cameras come with shots", (st().scene.cameras?.length ?? 0) >= 3 && st().scene.activeCamera != null,
      (st().scene.cameras ?? []).map((c) => c.name).join(", "));
    st().setActiveCamera(null);
    ok("free view clears the framing camera", st().scene.activeCamera === null);
    while ((st().scene.cameras?.length ?? 0)) st().deleteCamera(st().scene.cameras![0].id);
    ok("deleting every camera falls back to free view", (st().scene.cameras?.length ?? 0) === 0);
  }

  console.log(fails ? `\n${fails} FAILURES` : "\nall store checks passed");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error("threw:", e);
  process.exit(2);
});
