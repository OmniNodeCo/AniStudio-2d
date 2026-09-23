/**
 * Demo animations, generated procedurally at load time.
 *
 * They are deliberately written the same way you would animate in the app: set the hips,
 * then *drag* the hands/feet/tail with IK and let the solver bake keyframes onto the bones.
 * That means the demos are 100% normal editable keyframes — scrub to any frame and re-pose.
 */
import { TAU, rad, wrapPi, type Vec } from "../core/math";
import { solveFK } from "../core/fk";
import { rotAimAt, solveTo } from "../core/pose-edit";
import { poseRotations, setPosKey, setRotKey } from "../core/rig";
import type { IKChain, Scene } from "../core/types";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function chainOf(scene: Scene, id: string): IKChain {
  const c = scene.chains.find((x) => x.id === id);
  if (!c) throw new Error(`missing IK chain: ${id}`);
  return c;
}

function poseAt(scene: Scene, frame: number) {
  return solveFK(scene, poseRotations(scene, frame), frame);
}

function bake(scene: Scene, frame: number, rots: Record<string, number>) {
  for (const [id, r] of Object.entries(rots)) setRotKey(scene, id, frame, r);
}

function bakeRoot(scene: Scene, frame: number, pos: Vec) {
  const root = scene.bones.find((b) => !b.parent);
  if (!root) return;
  setPosKey(scene, root.id, frame, { x: pos.x - scene.root.x, y: pos.y - scene.root.y });
}

/** Bake one IK chain solve into keys at `frame`. */
function bakeIK(scene: Scene, frame: number, chainId: string, target: Vec, pole?: Vec | null) {
  const c = chainOf(scene, chainId);
  const pose = poseAt(scene, frame);
  const rots = solveTo(scene, pose, c, target, pole ?? null);
  bake(scene, frame, rots);
  return poseAt(scene, frame);
}

/* --------------------------------------------------------------- the walk */

function walkCycle(scene: Scene) {
  const f = scene.frames;
  const ground = scene.ground ?? 86;
  const ankleY = ground - 6;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    const rootX = scene.root.x;
    // Hips: weight shift + twice-per-cycle bob.
    bakeRoot(scene, frame, { x: rootX + 2 * Math.sin(p), y: scene.root.y + (4 * Math.cos(2 * p) - 1) });
    bake(scene, frame, {
      hips: wrapPi(2 * rad(Math.sin(p) * 2)),
      spine: rad(5 + 2 * Math.cos(2 * p)),
      chest: rad(-3),
      neck: rad(2 + 2 * Math.sin(2 * p)),
      head: rad(-4 - 3 * Math.cos(2 * p)),
    });
    // Arms swing opposite the legs, elbows flex on the forward pass.
    for (const [side, off] of [
      ["F", Math.PI],
      ["B", 0],
    ] as const) {
      const a = p + off;
      bake(scene, frame, {
        [`armUp${side}`]: rad(30 * Math.sin(a)),
        [`armLo${side}`]: rad(-26 - 26 * (0.5 + 0.5 * Math.sin(a + 1.1))),
        [`hand${side}`]: rad(8 * Math.sin(a + 0.6)),
      });
    }
    // Legs: foot target traces a flattened ellipse — planted during stance, lifted in swing.
    for (const [side, off] of [
      ["F", 0],
      ["B", Math.PI],
    ] as const) {
      const a = p + off;
      const lift = clamp01(Math.sin(a - Math.PI)) * 24;
      const pose = poseAt(scene, frame);
      const hip = pose.pos[`legUp${side}`];
      const target = { x: hip.x + 26 * Math.cos(a) + 4, y: ankleY - lift };
      // Pole pushes the knee forward so it never bends backwards.
      const pole = { x: hip.x + 34, y: (hip.y + target.y) / 2 };
      const solved = bakeIK(scene, frame, `leg${side}`, target, pole);
      // Keep the sole flat on the ground, with a little toe lift on push-off.
      const ankle = solved.end[`legLo${side}`];
      const flat = rotAimAt(scene, solved, `foot${side}`, { x: ankle.x + 20, y: ankle.y - 1 });
      bake(scene, frame, { [`foot${side}`]: wrapPi(flat + rad(3 * Math.max(0, -Math.sin(a)))) });
    }
  }
}

/* -------------------------------------------------------------- the wave */

function wave(scene: Scene) {
  const f = scene.frames;
  const ground = scene.ground ?? 82;
  // Solid robot stance first: both feet planted, knees pushed outward by the pole handles.
  for (let frame = 0; frame < f; frame += 2) {
    const pose = poseAt(scene, frame);
    for (const [side, dir] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const hip = pose.pos[`th${side}`];
      bakeIK(scene, frame, `leg${side}`, { x: hip.x + dir * 19, y: ground - 8 }, { x: hip.x + dir * 40, y: hip.y + 46 });
    }
  }
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    const w = 2 * p;
    bakeRoot(scene, frame, { x: scene.root.x + 2 * Math.sin(w), y: scene.root.y - 1.5 * Math.sin(2 * p) });
    bake(scene, frame, {
      hips: rad(3 * Math.sin(p)),
      torso: rad(-2 - 2 * Math.sin(p)),
      head: rad(-6 + 5 * Math.sin(p + 0.6)),
      antenna: rad(14 * Math.sin(p * 2 - 0.5)),
    });
    // Idle left arm, gently weighted, mirrored-free.
    bake(scene, frame, {
      shL: rad(-6 + 3 * Math.sin(p)),
      armL: rad(4),
      foreL: rad(-22 - 5 * Math.sin(p)),
      handL: rad(8),
    });
    // Right arm: hand travels a small arc next to the head — the wave.
    const pose = poseAt(scene, frame);
    const sh = pose.pos.shR ?? pose.root;
    const target = { x: sh.x + 40 + 15 * Math.sin(w), y: sh.y - 30 + 9 * Math.cos(w) };
    const solved = bakeIK(scene, frame, "armChainR", target, null);
    const wrist = solved.end.foreR;
    const foreEnd = solved.pos.foreR;
    // Keep the "hand" ball aimed along the forearm.
    bake(scene, frame, { handR: rotAimAt(scene, solved, "handR", { x: wrist.x + (wrist.x - foreEnd.x), y: wrist.y + (wrist.y - foreEnd.y) }) });
  }
}

/* ------------------------------------------------------------------ flight */

function flight(scene: Scene) {
  const f = scene.frames;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    bakeRoot(scene, frame, { x: scene.root.x, y: scene.root.y - 7 * Math.sin(p) });
    bake(scene, frame, {
      body: rad(3 * Math.sin(p + 0.4)),
      neck: rad(-7 - 5 * Math.sin(p)),
      head: rad(4 + 6 * Math.sin(p + 0.9)),
      jaw: rad(6 + 8 * clamp01(Math.sin(p * 0.5))),
      hornL: rad(4 * Math.sin(p)),
      wingUp: rad(-46 + 44 * Math.sin(p)),
      wingLo: rad(16 - 34 * Math.sin(p + 0.7)),
      legUpF: rad(16 + 6 * Math.sin(p)),
      legLoF: rad(30),
      clawF: rad(-14),
      legUpB: rad(12 - 6 * Math.sin(p)),
      legLoB: rad(26),
      clawB: rad(-12),
    });
    // Tail: IK handle dragged in a slow, laggy circle → follow-through for free.
    const pose = poseAt(scene, frame);
    const base = pose.pos.tail1 ?? pose.root;
    const dir = -Math.PI + 0.28;
    const len = 74;
    const wob = 0.42 * Math.sin(p - 1.1);
    const target = {
      x: base.x + Math.cos(dir + wob) * len,
      y: base.y + Math.sin(dir + wob) * len + 10 * Math.sin(p * 2 - 0.8),
    };
    bakeIK(scene, frame, "tail", target, null);
  }
}

/* ------------------------------------------------------------------ bounce */

function bounce(scene: Scene) {
  const f = scene.frames;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    const air = Math.max(0, Math.sin(p));
    const squash = clamp01(-Math.sin(p)) ** 1.4;
    bakeRoot(scene, frame, { x: scene.root.x + 6 * Math.sin(p * 0.5), y: scene.root.y + 22 * squash - 30 * air });
    bake(scene, frame, {
      body1: rad(14 * Math.sin(p) + 10 * squash),
      body2: rad(-18 * Math.sin(p + 0.3) - 12 * squash),
      head: rad(8 * Math.sin(p + 0.8) + 6 * squash),
      armUpL: rad(-30 - 40 * air + 8 * squash),
      armLoL: rad(-16 - 20 * air),
      armUpR: rad(30 + 40 * air - 8 * squash),
      armLoR: rad(16 + 20 * air),
    });
    // Antenna IK: 3-bone chain chasing a delayed point = jiggly follow-through.
    const pose = poseAt(scene, frame);
    const head = pose.end.head ?? pose.root;
    const target = { x: head.x + 6 + 20 * Math.sin(p - 1.4), y: head.y - 40 - 12 * Math.cos(p * 2 - 1.0) };
    bakeIK(scene, frame, "antenna", target, null);
  }
}

export const DEMOS: Record<string, (scene: Scene) => void> = {
  walk: walkCycle,
  wave,
  flight,
  bounce,
};

export function applyDemo(scene: Scene, id?: string | null): boolean {
  if (!id) return false;
  const fn = DEMOS[id];
  if (!fn) return false;
  fn(scene);
  return true;
}

export const DEMO_LABELS: Record<string, string> = {
  walk: "Walk cycle (IK feet)",
  wave: "Wave & weight shift",
  flight: "Flight (tail follow-through)",
  bounce: "Squash & stretch bounce",
};
