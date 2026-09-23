/**
 * Headless exercise of every store action the UI calls.
 * Run:
 *   npx esbuild scripts/store-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/store-check.cjs --log-level=warning && node .tmp/store-check.cjs
 */
import { useStudio } from "../src/state/store";
import { indexScene, poseRotations } from "../src/core/rig";
import { solveFK } from "../src/core/fk";
import { shapeWorldPoints } from "../src/core/fk";

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

  console.log(fails ? `\n${fails} FAILURES` : "\nall store checks passed");
  process.exit(fails ? 1 : 0);
}

void main().catch((e) => {
  console.error("threw:", e);
  process.exit(2);
});
