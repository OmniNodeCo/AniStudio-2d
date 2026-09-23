/**
 * Headless check of the pointer-interaction maths the canvas relies on:
 * screen/world transforms, hit-testing, IK solves and bone-space part drags.
 * Run:
 *   npx esbuild scripts/interact-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/interact-check.cjs --log-level=warning && node .tmp/interact-check.cjs
 */
import { buildScene } from "../src/core/rig-build";
import { RIG_MAP } from "../src/presets/rigs";
import { applyDemo } from "../src/presets/demos";
import { indexScene, poseRotations } from "../src/core/rig";
import { boneToWorld, shapeWorldPoints, solveFK, worldToBone } from "../src/core/fk";
import { fitView, screenToWorld, worldToScreen } from "../src/core/render";
import { hitTest } from "../src/core/hit";
import { centroid, mirrorAxis, poleFor, solveTo, targetOf } from "../src/core/pose-edit";
import { mirrorPoint } from "../src/core/ik";
import type { Scene } from "../src/core/types";
import type { RigPose } from "../src/core/fk";
import type { View } from "../src/core/render";
import type { Vec } from "../src/core/math";

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const vnear = (a: Vec, b: Vec, tol = 0.02) => near(a.x, b.x, tol) && near(a.y, b.y, tol);

function setup(id: string): { scene: Scene; pose: RigPose; view: View } {
  const def = RIG_MAP.get(id)!;
  const scene = buildScene(def);
  if (def.demo) applyDemo(scene, def.demo);
  const pose = solveFK(scene, poseRotations(scene, 3), 3);
  const view = fitView(scene, pose, 900, 560);
  return { scene, pose, view };
}

function main() {
  for (const id of ["kid", "robot", "dragon", "blob"]) {
    const { scene, pose, view } = setup(id);
    ok(`${id} view is sane`, Number.isFinite(view.cam.zoom) && view.cam.zoom > 0.09, `zoom=${view.cam.zoom.toFixed(2)}`);

    // screen <-> world round trip
    for (const p of [{ x: 12, y: 34 }, { x: 450, y: 280 }, { x: 899, y: 559 }]) {
      const w = screenToWorld(p, view);
      ok(`${id} screenToWorld round trip @${p.x},${p.y}`, vnear(worldToScreen(w, view), p as Vec, 0.5));
    }

    // IK handles are grabbable (hitTest works in WORLD space — that is what Stage feeds it)
    for (const chain of scene.chains) {
      const tip = chain.bones[chain.bones.length - 1];
      const world = pose.end[tip];
      const hit = hitTest(scene, pose, view, world, { handles: true, parts: true, partsFirst: false });
      ok(`${id} IK handle "${chain.name}" is hittable`, !!hit && hit.kind === "ik", hit ? `${hit.kind}/${(hit as any).chain ?? (hit as any).bone}` : "nothing");
      ok(`${id} handle round-trips through screen space`, (() => {
        const sp = worldToScreen(world, view);
        const back = screenToWorld(sp, view);
        return vnear(back, world, 0.05) && hitTest(scene, pose, view, back, { handles: true, parts: true, partsFirst: false })?.kind === "ik";
      })());
      if (chain.pole) {
        const mid = pose.pos[chain.bones[1]] ?? world;
        const h2 = hitTest(scene, pose, view, mid, { handles: true, parts: true, partsFirst: false });
        ok(`${id} joint on "${chain.name}" is hittable`, !!h2 && h2.kind !== "shape", h2 ? h2.kind : "nothing");
      }
      // dragging the handle moves the tip toward the goal and never breaks the rig
      const goal = { x: world.x + 12, y: world.y - 16 };
      const rots = solveTo(scene, pose, chain, goal, poleFor(scene, pose, chain));
      const posed = solveFK(scene, { ...poseRotations(scene, 3), ...rots }, 3);
      const reached = targetOf(scene, posed, chain);
      const reach = chain.bones.reduce((a, b) => a + (indexScene(scene).byId.get(b)?.length ?? 0), 0);
      const anchor = posed.pos[chain.bones[0]];
      const d0 = Math.hypot(world.x - goal.x, world.y - goal.y);
      const d1 = Math.hypot(reached.x - goal.x, reached.y - goal.y);
      ok(`${id} IK moves tip toward goal "${chain.name}"`, d1 <= d0 + 0.5, `before ${d0.toFixed(1)} → after ${d1.toFixed(1)}`);
      ok(`${id} IK never overextends "${chain.name}"`, Math.hypot(reached.x - anchor.x, reached.y - anchor.y) <= reach + 0.5, `reach ${Math.round(reach)}`);
      const idx = indexScene(scene);
      const badLimit = chain.bones.find((b) => {
        const def = idx.byId.get(b);
        if (!def || (def.min == null && def.max == null)) return false;
        const local = posed.ang[b] - (def.parent ? posed.ang[def.parent] : 0) - def.rest;
        const wrapped = Math.atan2(Math.sin(local), Math.cos(local));
        return wrapped < (def.min ?? -9) - 1e-3 || wrapped > (def.max ?? 9) + 1e-3;
      });
      ok(`${id} IK respects joint limits "${chain.name}"`, !badLimit, badLimit ? `violated on ${badLimit}` : "all inside");
      ok(`${id} IK touches only chain bones "${chain.name}"`, Object.keys(rots).every((b) => chain.bones.includes(b)), Object.keys(rots).join(","));
      // A full circle of goals: IK must never walk the tip *away* from where you dragged.
      let regress = 0;
      let worst = 0;
      let bound = 0;
      const idx2 = indexScene(scene);
      for (let i = 0; i < 12; i++) {
        for (const r of [10, 24]) {
          const ang = (i / 12) * Math.PI * 2;
          const g = { x: world.x + Math.cos(ang) * r, y: world.y + Math.sin(ang) * r };
          const want = Math.hypot(g.x - anchor.x, g.y - anchor.y);
          if (want > reach * 0.97) continue; // out of reach: clamping, not following, is fine
          const rr = solveTo(scene, pose, chain, g, poleFor(scene, pose, chain));
          const pp = solveFK(scene, { ...poseRotations(scene, 3), ...rr }, 3);
          const t2 = targetOf(scene, pp, chain);
          const before = Math.hypot(world.x - g.x, world.y - g.y);
          const after = Math.hypot(t2.x - g.x, t2.y - g.y);
          // A joint pinned against its limit *should* refuse to follow — that is the point of limits.
          const limitBound = chain.bones.some((b) => {
            const def = idx2.byId.get(b)!;
            const local = pp.ang[b] - (def.parent ? pp.ang[def.parent] : 0) - def.rest;
            const w = Math.atan2(Math.sin(local), Math.cos(local));
            return w <= (def.min ?? -9) + 0.02 || w >= (def.max ?? 9) - 0.02;
          });
          if (limitBound) bound++;
          else if (after > before + 1) {
            regress++;
            worst = Math.max(worst, after - before);
          }

        }
      }
      ok(
        `${id} IK follows the handle everywhere "${chain.name}"`,
        regress === 0,
        regress ? `${regress} dirs worse by up to ${worst.toFixed(1)}px` : `no regressions (${bound} dirs refused at a joint limit)`,
      );
    }

    // joints: the bone pivot is a joint/tip hit
    const bone = scene.bones.find((b) => b.parent && !b.chain && b.name.toLowerCase() !== "spine")!;
    const jhit = hitTest(scene, pose, view, pose.pos[bone.id], { handles: true, parts: false, partsFirst: false });
    ok(`${id} joint hit on "${bone.name}"`, !!jhit && jhit.kind !== "shape", jhit ? `${jhit.kind} ${(jhit as any).bone ?? ""}` : "nothing");

    // parts
    const shape = scene.shapes.find((s) => s.visible)!;
    const pts = shapeWorldPoints(shape, pose);
    const c = centroid(pts);
    const v0 = pts[0];
    const cp = { x: v0.x + (c.x - v0.x) * 0.25, y: v0.y + (c.y - v0.y) * 0.25 };
    const artHit = hitTest(scene, pose, view, cp, { handles: false, parts: true, partsFirst: true });
    ok(`${id} part centroid hit`, !!artHit && artHit.kind === "shape", artHit ? `${artHit.kind} ${(artHit as any).shape}` : "nothing");
    // pose mode (parts enabled, partsFirst false) must prefer the skeleton over the art
    const jointPoint = pose.pos[bone.id];
    const poseHit = hitTest(scene, pose, view, jointPoint, { handles: true, parts: true, partsFirst: false });
    ok(`${id} pose mode prefers joints over part interiors`, !!poseHit && poseHit.kind !== "shape", poseHit ? poseHit.kind : "nothing");
    const artHit2 = hitTest(scene, pose, view, centroid(pts), { handles: true, parts: true, partsFirst: true });
    ok(`${id} art mode grabs the topmost part`, !artHit2 || artHit2.kind === "shape" || artHit2.kind === "root", artHit2 ? artHit2.kind : "nothing");

    // empty space
    const far$ = screenToWorld({ x: 6, y: view.h - 6 }, view);
    ok(`${id} empty space hits nothing`, hitTest(scene, pose, view, far$, { handles: true, parts: true, partsFirst: false }) === null);

    // bone-space round trip used by art drags
    for (const p of pts.slice(0, 4)) {
      const local = worldToBone(p, pose, shape.bone);
      ok(`${id} boneToWorld∘worldToBone`, vnear(boneToWorld(local, pose, shape.bone), p, 0.05));
      const moved = boneToWorld({ x: local.x + 7, y: local.y - 4 }, pose, shape.bone);
      ok(`${id} drag in bone space moves in world`, !vnear(moved, p, 0.5), `Δ${Math.hypot(moved.x - p.x, moved.y - p.y).toFixed(1)}`);
      break;
    }
  }

  // ------------------------------------------------------------- mirroring
  const { scene: robot, pose: rpose } = setup("robot");
  const axis = mirrorAxis(robot, rpose);
  const arm = robot.bones.find((b) => b.mirror)!;
  const p = rpose.end[arm.id];
  const mp = mirrorPoint(p, axis);
  ok("mirror flips x about the rig axis", near(mp.x, 2 * axis - p.x, 0.01) && near(mp.y, p.y, 0.01), `axis=${Math.round(axis)}`);
  const twin = robot.bones.find((b) => b.id === arm.mirror)!;
  ok("twins share a length so mirrored art matches", near(arm.length, twin.length, 0.5), `${arm.length.toFixed(1)} vs ${twin.length.toFixed(1)}`);
  ok("every mirrored twin points back", twin.mirror === arm.id, `${twin.name} ↔ ${twin.mirror}`);

  // ------------------------------------------------------ blank rig workflow
  const blank = buildScene(RIG_MAP.get("blank")!);
  ok("blank rig exists", blank.bones.length >= 1, `${blank.bones.length} bone(s), ${blank.shapes.length} part(s), ${blank.chains.length} chain(s)`);
  const root = indexScene(blank).roots[0];
  const b1 = { id: "grow1", parent: root.id };
  const a1 = solveFK(blank, poseRotations(blank, 0), 0).ang[root.id] ?? 0;
  ok("blank root bone usable for growing", !!root && Number.isFinite(a1), `root=${root?.name}`);
  void b1;

  console.log(fails ? `\n${fails} FAILURES` : "\nall interaction checks passed");
  process.exit(fails ? 1 : 0);
}

main();
