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
import { makeCamera } from "../core/cameras";
import { makeLight, makeObject } from "../core/scenery";
import { sceneBounds } from "../core/render";
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

/** Foot target solver used by the quadruped + biped demos: plant, lift, and keep the sole flat. */
function stepLeg(
  scene: Scene,
  frame: number,
  chainId: string,
  upperId: string,
  lowerId: string,
  endBoneId: string,
  target: Vec,
  pole: Vec,
  toeLead = 14,
) {
  const solved = bakeIK(scene, frame, chainId, target, pole);
  const ankle = solved.end[lowerId];
  const flat = rotAimAt(scene, solved, endBoneId, { x: ankle.x + toeLead, y: ankle.y });
  bake(scene, frame, { [endBoneId]: wrapPi(flat) });
  void upperId;
  return solved;
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


/* -------------------------------------------------------------- the prowl */

/** Cat prowl: diagonal gait, IK paws, tail follow-through. */
function prowl(scene: Scene) {
  const f = scene.frames;
  const ground = scene.ground ?? 60;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    bakeRoot(scene, frame, { x: scene.root.x + 2 * Math.sin(p * 2), y: scene.root.y + 1.6 * Math.cos(2 * p) - 1 });
    bake(scene, frame, {
      spine: rad(2 * Math.sin(p * 2)),
      chest: rad(-2 + 2 * Math.sin(p * 2)),
      neck: rad(3 + 3 * Math.sin(p)),
      head: rad(-5 - 4 * Math.sin(p + 0.6)),
      jaw: rad(1 + 2 * Math.sin(p * 2)),
      earA: rad(7 * Math.sin(p * 2 + 0.3)),
      earB: rad(5 * Math.sin(p * 2 + 0.8)),
    });
    // far legs just swing; near legs get the IK treatment so paws stay planted
    for (const [side, off] of [
      ["frontUpB", Math.PI],
      ["backUpB", 0],
    ] as const) {
      const a = p + off + (side.startsWith("front") ? Math.PI : 0);
      bake(scene, frame, { [side]: rad(16 * Math.sin(a)), [side.replace("Up", "Lo")]: rad(-8 - 12 * Math.max(0, Math.sin(a))) });
    }
    for (const leg of [
      { chain: "frontLeg", up: "frontUp", lo: "frontLo", paw: "frontPaw", off: 0 },
      { chain: "backLeg", up: "backUp", lo: "backLo", paw: "backPaw", off: Math.PI },
    ]) {
      const pose = poseAt(scene, frame);
      const hip = pose.pos[leg.up];
      const a = p + leg.off;
      const lift = clamp01(Math.sin(a - Math.PI)) ** 1.2 * 16;
      stepLeg(
        scene,
        frame,
        leg.chain,
        leg.up,
        leg.lo,
        leg.paw,
        { x: hip.x + 17 * Math.cos(a), y: ground - 4 - lift },
        { x: hip.x + (leg.chain === "frontLeg" ? -16 : 18), y: (hip.y + ground) / 2 },
        12,
      );
    }
    // Tail: dragged behind, lagging the body — follow-through for free.
    const pose = poseAt(scene, frame);
    const base = pose.pos.tail1 ?? pose.root;
    bakeIK(scene, frame, "tail", {
      x: base.x - 44 - 6 * Math.sin(p + 1.1),
      y: base.y - 22 - 12 * Math.cos(p * 2 - 0.6),
    });
  }
}

/* --------------------------------------------------------------- the slash */

/** Ninja slash: an anticipation beat, two cuts, and a scarf that lags behind. */
function slash(scene: Scene) {
  const f = scene.frames;
  const ground = scene.ground ?? 74;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    const cut = Math.sin(p * 2);
    bakeRoot(scene, frame, { x: scene.root.x + 3 * Math.sin(p * 2 - 0.4), y: scene.root.y + 1.5 * Math.cos(p * 4) });
    bake(scene, frame, {
      hips: rad(3 * Math.sin(p)),
      spine: rad(-3 + 9 * cut),
      chest: rad(2 + 5 * cut),
      neck: rad(2 - 4 * cut),
      head: rad(-3 - 7 * cut),
      bandL: rad(-26 * Math.sin(p * 2 - 0.9) - 8),
      bandL2: rad(-16 * Math.sin(p * 2 - 1.3) - 5),
      armUpB: rad(10 + 14 * Math.sin(p + 0.7)),
      armLoB: rad(-30 - 16 * Math.sin(p + 1.1)),
    });
    // Sword arm: hand sweeps a wide arc from over the shoulder to across the body.
    const pose = poseAt(scene, frame);
    const sh = pose.pos.armUpF ?? pose.root;
    const sweep = Math.sin(p * 2 - 0.5);
    const target = { x: sh.x + 16 + 26 * sweep, y: sh.y - 30 + 26 * Math.cos(p * 2 - 0.5) };
    const solved = bakeIK(scene, frame, "armF", target, sh.y < target.y ? { x: sh.x + 30, y: sh.y - 6 } : { x: sh.x + 26, y: sh.y + 10 });
    const wrist = solved.pos.handF ?? solved.end.armLoF;
    const fore = solved.end.armLoF;
    bake(scene, frame, { sword: rotAimAt(scene, solved, "sword", { x: fore.x + (fore.x - wrist.x), y: fore.y + (fore.y - wrist.y) - 40 * cut }) });
    // Stance: feet stay planted, knees take the weight shift.
    for (const leg of [
      { chain: "legF", up: "legUpF", lo: "legLoF", foot: "footF", dir: -1 },
      { chain: "legB", up: "legUpB", lo: "legLoB", foot: "footB", dir: 1 },
    ]) {
      const pv = poseAt(scene, frame);
      const hip = pv.pos[leg.up];
      stepLeg(
        scene,
        frame,
        leg.chain,
        leg.up,
        leg.lo,
        leg.foot,
        { x: hip.x + leg.dir * 16 + 3 * Math.sin(p), y: ground - 6 },
        { x: hip.x + leg.dir * 42, y: hip.y + 44 },
        18,
      );
    }
  }
}

/* ----------------------------------------------------------------- the flap */

/** Falcon flight: wing sweep, tucked legs, tail fan acting as a rudder. */
function flap(scene: Scene) {
  const f = scene.frames;
  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    bakeRoot(scene, frame, { x: scene.root.x, y: scene.root.y - 6 * Math.sin(p) - 2 });
    bake(scene, frame, {
      body: rad(2 * Math.sin(p + 0.2)),
      chest: rad(3 * Math.sin(p + 0.3)),
      neck: rad(-4 - 4 * Math.sin(p)),
      head: rad(3 + 5 * Math.sin(p + 0.8)),
      beak: rad(2 + 3 * Math.sin(p * 2)),
      crest: rad(10 * Math.sin(p * 2 + 0.5)),
      wingUp: rad(-44 + 62 * Math.sin(p)),
      wingLo: rad(10 - 40 * Math.sin(p + 0.6)),
      wingUpB: rad(-40 + 58 * Math.sin(p + 0.25)),
      wingLoB: rad(12 - 36 * Math.sin(p + 0.85)),
      legUp: rad(18 + 6 * Math.sin(p)),
      legLo: rad(46),
    });
    const pose = poseAt(scene, frame);
    const base = pose.pos.tail1 ?? pose.root;
    bakeIK(scene, frame, "tail", {
      x: base.x - 30,
      y: base.y + 6 * Math.sin(p - 1.0) - 2,
    });
    // Wing tips get their own IK pass so the far wing never crosses the body.
    const wing = poseAt(scene, frame);
    const shoulder = wing.pos.wingUpB ?? wing.root;
    bakeIK(scene, frame, "wingR", { x: shoulder.x + 30 * Math.cos(p + 0.4), y: shoulder.y - 26 + 24 * Math.sin(p + 0.3) });
  }
}

/* ----------------------------------------------------------------- the cast */

/** Wizard cast: raise the staff, lean back, and a glow light wakes up on the orb. */
function cast(scene: Scene) {
  const f = scene.frames;
  const ground = scene.ground ?? 76;
  // A light that rides the staff hand — flickering, so the orb reads as magic.
  const orb = makeLight("glow", 0, 0);
  orb.name = "Staff orb";
  orb.follow = "handF";
  orb.color = "#bda6ff";
  orb.radius = 220;
  orb.intensity = 0.9;
  orb.flicker = 0.14;
  scene.lights = [...(scene.lights ?? []), orb];
  scene.showLights = true;

  for (let frame = 0; frame < f; frame += 2) {
    const p = (frame / f) * TAU;
    const rise = 0.5 + 0.5 * Math.sin(p - Math.PI / 2); // 1 at the top of the loop
    bakeRoot(scene, frame, { x: scene.root.x, y: scene.root.y - 2 * rise });
    bake(scene, frame, {
      hips: rad(-2 * rise),
      spine: rad(-4 - 6 * rise),
      chest: rad(2 + 4 * rise),
      neck: rad(4 + 4 * rise),
      head: rad(-8 - 6 * rise),
      hat: rad(4 * Math.sin(p)),
      hatTip: rad(-10 * rise + 4 * Math.sin(p * 2)),
      beard: rad(-6 - 10 * rise),
      armUpB: rad(-14 - 22 * rise),
      armLoB: rad(-26 - 18 * rise),
    });
    const pose = poseAt(scene, frame);
    const sh = pose.pos.armUpF ?? pose.root;
    // Hand lifts the staff overhead: a straight rise with a little overshoot.
    const target = { x: sh.x + 10 + 16 * rise, y: sh.y - 8 - 52 * rise };
    const solved = bakeIK(scene, frame, "armF", target, rise > 0.4 ? { x: sh.x + 34, y: sh.y + 6 } : { x: sh.x + 34, y: sh.y + 30 });
    const hand = solved.end.armLoF;
    bake(scene, frame, { staff: rotAimAt(scene, solved, "staff", { x: hand.x - 6 - 6 * rise, y: hand.y - 40 - 30 * rise }) });
    for (const leg of [
      { chain: "legF", up: "legUpF", lo: "legLoF", foot: "footF", dir: -1 },
      { chain: "legB", up: "legUpB", lo: "legLoB", foot: "footB", dir: 1 },
    ]) {
      const pv = poseAt(scene, frame);
      const hip = pv.pos[leg.up];
      stepLeg(
        scene,
        frame,
        leg.chain,
        leg.up,
        leg.lo,
        leg.foot,
        { x: hip.x + leg.dir * 17, y: ground - 6 },
        { x: hip.x + leg.dir * 40, y: hip.y + 44 },
        18,
      );
    }
  }
}

/* ------------------------------------------------------- set & camera demos */

/** A ready-made location: horizon, some foliage, and a key light that matches the sky. */
export function applyScenerySet(scene: Scene): number {
  const ground = scene.ground ?? scene.root.y + 70;
  const rx = scene.root.x;
  const dark = isDark(scene.bgBottom);
  const made = [
    makeObject("mountain", rx - 240, ground, 3),
    makeObject("hill", rx - 40, ground, 7),
    makeObject("hill", rx + 150, ground, 12),
    makeObject("cloud", rx - 150, ground - 210, 2),
    makeObject("cloud", rx + 120, ground - 250, 5),
    makeObject("pine", rx - 150, ground, 2),
    makeObject("pine", rx - 108, ground, 6),
    makeObject("tree", rx + 128, ground, 4),
    makeObject("bush", rx - 66, ground, 8),
    makeObject("bush", rx + 74, ground, 11),
    makeObject("grass", rx - 30, ground, 5),
    makeObject("grass", rx + 40, ground, 9),
    makeObject("rock", rx + 96, ground, 3),
    makeObject("fence", rx + 186, ground, 1),
  ];
  made[0].scale = 1.25;
  made[2].scale = 0.85;
  made[1].z = 0.09;
  made[2].z = 0.07;
  made[6].scale = 1.2;
  made[9].scale = 1.3;
  scene.objects = [...(scene.objects ?? []), ...made];
  scene.showObjects = true;

  const key = makeLight(dark ? "moon" : "sun", rx - 60, ground - 260);
  key.intensity = dark ? 0.5 : 0.42;
  const warm = makeLight(dark ? "cool" : "warm", rx + 40, ground - 40);
  warm.radius = 320;
  warm.intensity = dark ? 0.35 : 0.45;
  scene.lights = [...(scene.lights ?? []), key, warm];
  scene.showLights = true;
  return made.length;
}

/** Two shots with a push-in: an establishing wide, then a close-up that creeps in. */
export function applyCameraDemo(scene: Scene): number {
  const frames = scene.frames;
  const mid = Math.max(2, Math.round(frames * 0.45));
  const box = sceneBounds(scene, solveFK(scene, poseRotations(scene, 0), 0));
  const zoomFit = Math.min(720 / Math.max(40, box.h * 1.5), (720 * (16 / 9)) / Math.max(40, box.w * 1.5));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  const wide = makeCamera(cx, cy, zoomFit, "Wide", [{ start: 0, end: mid - 1 }]);
  const close = makeCamera(cx + 10, cy - 10, zoomFit * 1.7, "Close-up", [{ start: mid, end: frames - 1 }]);
  close.keys = [
    { t: mid, x: close.x, y: close.y, zoom: zoomFit * 1.6, ease: "easeInOut" },
    { t: frames - 1, x: close.x + 12, y: close.y - 8, zoom: zoomFit * 2.6, ease: "easeInOut" },
  ];
  scene.cameras = [...(scene.cameras ?? []), wide, close];
  scene.activeCamera = close.id;
  return 2;
}

const isDark = (hex: string): boolean => {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return true;
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 120;
};

export const DEMOS: Record<string, (scene: Scene) => void> = {
  walk: walkCycle,
  wave,
  flight,
  bounce,
  prowl,
  slash,
  flap,
  cast,
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
  prowl: "Cat prowl (quadruped IK)",
  slash: "Sword slash (2 beats)",
  flap: "Wing flap (Falcon)",
  cast: "Spell cast (staff light)",
};
