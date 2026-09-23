/**
 * AniStudio store.
 *
 * The `Scene` (rig + art + keyframes) is the single source of truth and is treated as
 * immutable: every edit goes through `mutate()`, which deep-clones the scene, applies the
 * patch and pushes the previous version onto the undo stack.
 *
 * While you drag something we never touch the scene — the drag lives in `live` (a preview
 * buffer). On mouse-up `commitLive()` bakes it into keyframes, which is what makes
 * "grab a hand, get an animation" work.
 */
import { create } from "zustand";
import { clamp, mod, rad, deg, wrapPi, type Ease, type Vec } from "../core/math";
import { type RigPose, solveFK } from "../core/fk";
import { buildPart, scalePts, rotatePts, translatePts } from "../core/parts";
import { clearKeys, ensureTrack, indexScene, poseRotations, removeKeyAt, rootPosAtFrame, setEaseForKeys, setPosKey, setRotKey, shiftKeys, deleteKeys } from "../core/rig";
import { centroid, mirrorAxis, mirrorRots, nearestBoneTo, poleFor, rotAimAt, snapshotPose, solveTo, targetOf } from "../core/pose-edit";
import { mirrorPoint } from "../core/ik";
import { buildScene, type RigDef } from "../core/rig-build";
import { applyDemo, DEMOS } from "../presets/demos";
import { RIG_MAP, RIGS } from "../presets/rigs";
import { PALETTES, type Bone, type Pose, type RoleKey, type Scene, type ShapePart } from "../core/types";
import type { DragFeedback, View } from "../core/render";

export type Mode = "pose" | "rig" | "art" | "draw";
export type SelKind = "bone" | "shape" | "chain" | "none";

export interface LivePose {
  rot: Record<string, number>;
  root: Vec | null;
  shapes: Record<string, Vec[]>;
  empty?: boolean;
}

export interface Toast {
  msg: string;
  tone: "info" | "warn" | "ok";
  id: number;
}

const HISTORY_LIMIT = 80;
const CHAIN_COLORS = ["#7cf0c8", "#ffb347", "#5ec8ff", "#ff7a9c", "#c9a4ff", "#9be15d", "#ff8f6b", "#7ad7ff"];

const clone = <T,>(x: T): T =>
  typeof structuredClone === "function" ? structuredClone(x) : (JSON.parse(JSON.stringify(x)) as T);

const emptyLive = (): LivePose => ({ rot: {}, root: null, shapes: {} });
const liveHasContent = (l: LivePose | null): boolean =>
  !!l && (Object.keys(l.rot).length > 0 || l.root != null || Object.keys(l.shapes).length > 0);

export interface StudioState {
  scene: Scene;
  frame: number;
  playing: boolean;
  speed: number;
  mode: Mode;
  view: View;
  autoKey: boolean;
  mirrorX: boolean;
  showGrid: boolean;
  showBones: boolean;
  showHandles: boolean;
  showNames: boolean;
  showOnion: number;
  showShadow: boolean;
  selection: { kind: SelKind; id: string | null };
  keySel: { bone: string; frames: number[] } | null;
  chainPick: string[];
  hover: string | null;
  live: LivePose | null;
  drag: DragFeedback | null;
  past: { scene: Scene; label: string }[];
  future: { scene: Scene; label: string }[];
  poseLib: Pose[];
  toast: Toast | null;
  drawPoints: Vec[];
  partKind: string;
  busy: string | null;
  showHelp: boolean;
}

export interface StudioActions {
  mutate: (fn: (draft: Scene) => void, label?: string) => void;
  checkpoint: (label: string) => void;
  undo: () => void;
  redo: () => void;
  notify: (msg: string, tone?: Toast["tone"]) => void;
  setBusy: (s: string | null) => void;

  setFrame: (f: number) => void;
  step: (d: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  setMode: (m: Mode) => void;
  setView: (patch: Partial<View>) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (factor: number, screen: Vec) => void;
  fit: () => void;

  select: (kind: SelKind, id?: string | null) => void;
  setKeySel: (bone: string | null, frames?: number[]) => void;
  setHover: (h: string | null) => void;
  setDrag: (d: DragFeedback | null) => void;
  setLive: (patch: Partial<LivePose>) => void;
  clearLive: () => void;
  commitLive: () => void;
  toggleFlag: (k: "autoKey" | "mirrorX" | "showGrid" | "showBones" | "showHandles" | "showNames" | "showShadow" | "showHelp") => void;
  setShowOnion: (n: number) => void;
  setAutoKey: (v: boolean) => void;

  // posing ---------------------------------------------------------------
  basePose: () => RigPose;
  fullPose: () => RigPose;
  rotBoneAim: (boneId: string, worldPoint: Vec) => void;
  rotBoneBy: (boneId: string, delta: number) => void;
  ikDrag: (chainId: string, target: Vec, pole?: Vec | null) => void;
  poleDrag: (chainId: string, pole: Vec) => void;
  rootDrag: (p: Vec) => void;
  shapeDrag: (id: string, pts: Vec[]) => void;
  zeroBone: (id: string) => void;

  // keys -----------------------------------------------------------------
  keyCurrentPose: () => void;
  keySelectedBone: () => void;
  deleteKeysAt: (frame: number, boneId?: string) => void;
  deleteSelectedKeys: () => void;
  moveSelectedKeys: (delta: number) => void;
  setEaseOnSelected: (ease: Ease) => void;
  copyPose: () => void;
  pastePose: () => void;
  savePose: (name: string) => void;
  applyPose: (name: string) => void;
  deletePose: (name: string) => void;
  applyDemoNow: (id: string) => void;

  // rig ------------------------------------------------------------------
  addBone: (parentId: string | null, start: Vec, end: Vec) => string;
  deleteBone: (id: string) => void;
  updateBone: (id: string, patch: Partial<Bone>) => void;
  setLimits: (id: string, patch: { min?: number | null; max?: number | null }) => void;
  reparentBone: (id: string, parent: string | null) => void;
  toggleChainPick: (boneId: string) => void;
  makeChainFromPick: (pole: boolean) => void;
  deleteChain: (id: string) => void;
  toggleChain: (id: string) => void;
  setChainPole: (id: string, pole: boolean) => void;
  autoRig: () => void;

  // art ------------------------------------------------------------------
  addPart: (kind: string, boneId: string) => void;
  deleteShape: (id: string) => void;
  updateShape: (id: string, patch: Partial<ShapePart>) => void;
  commitShapePts: (id: string, pts: Vec[]) => void;
  reorderShape: (id: string, dir: -1 | 1 | "front" | "back") => void;
  duplicateShape: (id: string) => void;
  fitPartsToBones: () => void;
  setShapeRole: (id: string, role: RoleKey) => void;
  setShapeFill: (id: string, fill: string) => void;

  // scene ----------------------------------------------------------------
  setPalette: (name: string) => void;
  setOutline: (c: string) => void;
  setBg: (top: string, bottom: string) => void;
  setGround: (y: number | null) => void;
  setFps: (fps: number) => void;
  setFrames: (n: number) => void;
  setLoop: (v: boolean) => void;
  renameScene: (name: string) => void;
  clearAllKeys: () => void;
  loadRig: (id: string, withDemo?: boolean) => void;
  loadScene: (scene: Scene, label?: string, fit?: boolean) => void;
  newScene: () => void;
  setDrawPoints: (p: Vec[]) => void;
  finishDraw: () => void;
  finishLasso: (pts: Vec[], boneId: string) => void;
  setPartKind: (k: string) => void;
}

export type Studio = StudioState & StudioActions;

let toastSeq = 0;
let clipboard: { rot: Record<string, number>; root: Vec | null } | null = null;

export const useStudio = create<Studio>()((set, get) => {
  const boot = () => {
    const def = RIG_MAP.get("kid")!;
    const scene = buildScene(def);
    applyDemo(scene, def.demo);
    return scene;
  };

  const notify = (msg: string, tone: Toast["tone"] = "info") => set({ toast: { msg, tone, id: ++toastSeq } });

  let lastLabel = "";
  let lastLabelAt = 0;
  const mutate: StudioActions["mutate"] = (fn, label = "edit") => {
    const { scene, past } = get();
    const now = performance.now();
    // Repeated edits of the same kind (dragging a slider, resizing a bone) collapse into
    // one undo step so Ctrl+Z doesn't have to walk through 60 micro-edits.
    const coalesce = label === lastLabel && now - lastLabelAt < 1200;
    lastLabel = label;
    lastLabelAt = now;
    const draft = clone(scene);
    fn(draft);
    set({
      scene: draft,
      past: coalesce ? past : [...past, { scene, label }].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  /** Pose straight from the keyframes (ignores the live drag buffer). */
  const basePose = (): RigPose => {
    const { scene, frame } = get();
    return solveFK(scene, poseRotations(scene, frame), frame);
  };

  /** Pose including the live drag buffer — this is what the canvas draws. */
  const fullPose = (): RigPose => {
    const { scene, frame, live } = get();
    const rots = poseRotations(scene, frame, live && Object.keys(live.rot).length ? live.rot : undefined);
    const pose = solveFK(scene, rots, frame, live?.root ?? undefined);
    return pose;
  };

  const setLive: StudioActions["setLive"] = (patch) => {
    const cur = get().live ?? emptyLive();
    set({ live: { ...cur, ...patch } });
  };

  const commitLive: StudioActions["commitLive"] = () => {
    const { live, autoKey, frame } = get();
    if (!liveHasContent(live)) {
      set({ live: null, drag: null });
      return;
    }
    const l = live!;
    const shapeEdits = Object.entries(l.shapes);
    const rotEdits = Object.entries(l.rot);
    if (!autoKey && rotEdits.length === 0 && !l.root) {
      // only art moved: always applied
      if (shapeEdits.length)
        mutate((d) => {
          for (const [id, pts] of shapeEdits) {
            const s = d.shapes.find((x) => x.id === id);
            if (s) s.pts = pts;
          }
        }, "move part");
      set({ live: null, drag: null });
      return;
    }
    mutate((d) => {
      if (autoKey) {
        for (const [id, r] of rotEdits) setRotKey(d, id, frame, r);
        if (l.root) {
          const root = indexScene(d).roots[0];
          if (root) setPosKey(d, root.id, frame, { x: l.root.x - d.root.x, y: l.root.y - d.root.y });
        }
      }
      for (const [id, pts] of shapeEdits) {
        const s = d.shapes.find((x) => x.id === id);
        if (s) s.pts = pts;
      }
    }, autoKey ? "pose" : "art move");
    set({ live: null, drag: null });
    if (!autoKey && rotEdits.length) notify("Auto-key is off, so this pose was not recorded — press K to key it", "warn");
  };

  return {
    scene: boot(),
    frame: 0,
    playing: false,
    speed: 1,
    mode: "pose",
    view: { w: 1000, h: 700, cam: { x: 0, y: -10, zoom: 3 } },
    autoKey: true,
    mirrorX: false,
    showGrid: true,
    showBones: true,
    showHandles: true,
    showNames: false,
    showOnion: 2,
    showShadow: true,
    selection: { kind: "bone", id: "hips" },
    keySel: null,
    chainPick: [],
    hover: null,
    live: null,
    drag: null,
    past: [],
    future: [],
    poseLib: [],
    toast: null,
    drawPoints: [],
    partKind: "torso",
    busy: null,
    showHelp: false,

    mutate,
    checkpoint: (label) => {
      const { scene, past } = get();
      set({ past: [...past, { scene, label }].slice(-HISTORY_LIMIT), future: [] });
    },
    undo: () => {
      const { past, future, scene } = get();
      const last = past[past.length - 1];
      if (!last) return notify("Nothing left to undo", "warn");
      set({
        scene: last.scene,
        past: past.slice(0, -1),
        future: [{ scene, label: last.label }, ...future].slice(0, HISTORY_LIMIT),
        live: null,
      });
      notify(`Undo · ${last.label}`, "ok");
    },
    redo: () => {
      const { past, future, scene } = get();
      const next = future[0];
      if (!next) return notify("Nothing to redo", "warn");
      set({
        scene: next.scene,
        future: future.slice(1),
        past: [...past, { scene, label: next.label }].slice(-HISTORY_LIMIT),
        live: null,
      });
      notify(`Redo · ${next.label}`, "ok");
    },
    notify,
    setBusy: (s) => set({ busy: s }),

    setFrame: (f) => {
      const { scene, live, autoKey } = get();
      let nf = Math.round(f);
      nf = scene.loop ? mod(nf, scene.frames) : clamp(nf, 0, scene.frames - 1);
      if (liveHasContent(live)) {
        if (autoKey) commitLive();
        else {
          set({ live: null });
          notify("Unkeyed pose discarded — turn on Auto-key to keep poses per frame", "warn");
        }
      }
      set({ frame: nf });
    },
    step: (d) => get().setFrame(get().frame + d),
    setPlaying: (p) => set({ playing: p }),
    togglePlay: () => set({ playing: !get().playing }),
    setSpeed: (s) => set({ speed: clamp(s, 0.1, 4) }),
    setMode: (m) => set({ mode: m, drawPoints: [], live: null, drag: null, keySel: null }),
    setView: (patch) => {
      const { view } = get();
      set({ view: { ...view, ...patch, cam: { ...view.cam, ...(patch.cam ?? {}) } } });
    },
    panBy: (dx, dy) => {
      const { view } = get();
      set({ view: { ...view, cam: { ...view.cam, x: view.cam.x - dx / view.cam.zoom, y: view.cam.y - dy / view.cam.zoom } } });
    },
    zoomAt: (factor, screen) => {
      const { view } = get();
      const z0 = view.cam.zoom;
      const z1 = clamp(z0 * factor, 0.08, 12);
      const wx = (screen.x - view.w / 2) / z0 + view.cam.x;
      const wy = (screen.y - view.h / 2) / z0 + view.cam.y;
      set({
        view: {
          ...view,
          cam: { x: wx - (screen.x - view.w / 2) / z1, y: wy - (screen.y - view.h / 2) / z1, zoom: z1 },
        },
      });
    },
    fit: () => {
      const s = get();
      const pose = fullPose();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const push = (p: Vec) => {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      };
      for (const b of s.scene.bones) {
        push(pose.pos[b.id] ?? s.scene.root);
        push(pose.end[b.id] ?? s.scene.root);
      }
      for (const sh of s.scene.shapes) for (const p of sh.pts) push(p);
      if (!Number.isFinite(x0)) return;
      const pad = 70;
      const w = Math.max(40, x1 - x0);
      const h = Math.max(40, y1 - y0);
      const zoom = clamp(Math.min((s.view.w - pad) / w, (s.view.h - pad) / h), 0.1, 8);
      set({ view: { ...s.view, cam: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom } } });
    },

    select: (kind, id = null) => set({ selection: { kind, id } }),
    setKeySel: (bone, frames = []) => set({ keySel: bone ? { bone, frames } : null }),
    setHover: (h) => {
      if (get().hover !== h) set({ hover: h });
    },
    setDrag: (d) => set({ drag: d }),
    setLive,
    clearLive: () => set({ live: null, drag: null }),
    commitLive,
    toggleFlag: (k) => set({ [k]: !get()[k] } as Partial<StudioState>),
    setShowOnion: (n) => set({ showOnion: clamp(Math.round(n), 0, 6) }),
    setAutoKey: (v) => set({ autoKey: v }),

    basePose,
    fullPose,
    rotBoneAim: (boneId, worldPoint) => {
      const s = get();
      const pose = basePose();
      const r = rotAimAt(s.scene, pose, boneId, worldPoint);
      const rot = { ...s.live?.rot, [boneId]: r };
      if (s.mirrorX) Object.assign(rot, mirrorRots(s.scene, { [boneId]: r }));
      setLive({ rot });
    },
    rotBoneBy: (boneId, delta) => {
      const s = get();
      const start = poseRotations(s.scene, s.frame)[boneId] ?? 0;
      const cur = s.live?.rot?.[boneId] ?? start;
      const r = wrapPi(cur + delta);
      const rot = { ...s.live?.rot, [boneId]: r };
      if (s.mirrorX) Object.assign(rot, mirrorRots(s.scene, { [boneId]: r }));
      setLive({ rot });
    },
    ikDrag: (chainId, target, pole) => {
      const s = get();
      const chain = s.scene.chains.find((c) => c.id === chainId);
      if (!chain) return;
      const pose = basePose();
      const usePole = pole ?? poleFor(s.scene, pose, chain);
      const rot = { ...s.live?.rot, ...solveTo(s.scene, pose, chain, target, usePole) };
      const axis = mirrorAxis(s.scene, pose);
      if (s.mirrorX && chain.mirror) {
        const twin = s.scene.chains.find((c) => c.id === chain.mirror);
        if (twin) Object.assign(rot, solveTo(s.scene, pose, twin, mirrorPoint(target, axis), usePole ? mirrorPoint(usePole, axis) : null));
      } else if (s.mirrorX) {
        Object.assign(rot, mirrorRots(s.scene, rot));
      }
      setLive({ rot });
    },
    poleDrag: (chainId, pole) => {
      const s = get();
      const chain = s.scene.chains.find((c) => c.id === chainId);
      if (!chain) return;
      const pose = basePose();
      const target = targetOf(s.scene, pose, chain);
      setLive({ rot: { ...s.live?.rot, ...solveTo(s.scene, pose, chain, target, pole) } });
    },
    rootDrag: (p) => setLive({ root: p }),
    shapeDrag: (id, pts) => setLive({ shapes: { ...(get().live?.shapes ?? {}), [id]: pts } }),
    zeroBone: (id) => {
      const s = get();
      mutate((d) => void setRotKey(d, id, s.frame, 0), "zero bone");
      set({ live: null });
    },

    keyCurrentPose: () => {
      const s = get();
      const merged = { ...snapshotPose(s.scene, s.frame), ...(s.live?.rot ?? {}) };
      const root = s.live?.root ?? rootPosAtFrame(s.scene, s.frame);
      mutate((d) => {
        for (const [id, r] of Object.entries(merged)) setRotKey(d, id, s.frame, r);
        const rid = indexScene(d).roots[0]?.id;
        if (rid && root) setPosKey(d, rid, s.frame, { x: root.x - d.root.x, y: root.y - d.root.y });
      }, `key pose @${s.frame}`);
      set({ live: null });
      notify(`Keyed ${Object.keys(merged).length} bones at frame ${s.frame}`, "ok");
    },
    keySelectedBone: () => {
      const s = get();
      const id = s.selection.id;
      if (s.selection.kind !== "bone" || !id) return notify("Select a bone first", "warn");
      const r = (s.live?.rot?.[id] ?? poseRotations(s.scene, s.frame)[id]) ?? 0;
      mutate((d) => void setRotKey(d, id, s.frame, r), "key bone");
      set({ live: null });
    },
    deleteKeysAt: (frame, boneId) =>
      mutate((d) => {
        if (boneId) removeKeyAt(d, boneId, frame);
        else for (const b of d.bones) removeKeyAt(d, b.id, frame);
      }, "delete keys"),
    deleteSelectedKeys: () => {
      const s = get();
      if (!s.keySel) return notify("Click a keyframe first", "warn");
      mutate((d) => void deleteKeys(d, s.keySel!.bone, s.keySel!.frames), "delete keys");
      set({ keySel: null });
    },
    moveSelectedKeys: (delta) => {
      const s = get();
      if (!s.keySel) return;
      mutate((d) => void shiftKeys(d, s.keySel!.bone, s.keySel!.frames, delta), "move keys");
      set({ keySel: { ...s.keySel, frames: s.keySel.frames.map((f) => clamp(f + delta, 0, s.scene.frames - 1)) } });
    },
    setEaseOnSelected: (ease) => {
      const s = get();
      if (!s.keySel) return notify("Select keyframes in the dopesheet first", "warn");
      mutate((d) => void setEaseForKeys(d, s.keySel!.bone, s.keySel!.frames, ease), "ease");
      notify(`Ease → ${ease}`, "ok");
    },
    copyPose: () => {
      const s = get();
      clipboard = { rot: { ...snapshotPose(s.scene, s.frame), ...(s.live?.rot ?? {}) }, root: s.live?.root ?? rootPosAtFrame(s.scene, s.frame) };
      notify("Pose copied", "ok");
    },
    pastePose: () => {
      const s = get();
      if (!clipboard) return notify("Copy a pose first (Ctrl+C)", "warn");
      const { rot, root } = clipboard;
      mutate((d) => {
        for (const [id, r] of Object.entries(rot)) setRotKey(d, id, s.frame, r);
        const rid = indexScene(d).roots[0]?.id;
        if (rid && root) setPosKey(d, rid, s.frame, { x: root.x - d.root.x, y: root.y - d.root.y });
      }, "paste pose");
      set({ live: null });
      notify("Pose pasted onto this frame", "ok");
    },
    savePose: (name) => {
      const s = get();
      const rot = { ...snapshotPose(s.scene, s.frame), ...(s.live?.rot ?? {}) };
      set({
        poseLib: [...s.poseLib.filter((p) => p.name !== name), { name, rot, pos: { root: s.live?.root ?? rootPosAtFrame(s.scene, s.frame) } }],
      });
      notify(`Pose library: saved "${name}"`, "ok");
    },
    applyPose: (name) => {
      const s = get();
      const p = s.poseLib.find((x) => x.name === name);
      if (!p) return;
      mutate((d) => {
        for (const [id, r] of Object.entries(p.rot)) setRotKey(d, id, s.frame, r);
      }, "apply pose");
      notify(`Applied "${name}"`, "ok");
    },
    deletePose: (name) => set({ poseLib: get().poseLib.filter((p) => p.name !== name) }),
    applyDemoNow: (id) => {
      const fn = DEMOS[id];
      if (!fn) return notify("Unknown demo", "warn");
      mutate((d) => void fn(d), "demo");
      notify(`Generated "${id}" keys — edit them like any animation`, "ok");
    },

    addBone: (parentId, start, end) => {
      const id = `b${Math.random().toString(36).slice(2, 7)}`;
      const pose = basePose();
      const parentAng = parentId ? pose.ang[parentId] ?? 0 : 0;
      const ang = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(6, Math.hypot(end.x - start.x, end.y - start.y));
      mutate((d) => {
        d.bones.push({
          id,
          name: `Bone ${d.bones.length + 1}`,
          parent: parentId,
          length,
          rest: wrapPi(ang - parentAng),
          min: -Math.PI * 0.95,
          max: Math.PI * 0.95,
          w: 4,
        });
        ensureTrack(d, id);
        delete d.tracks[id];
      }, "add bone");
      set({ selection: { kind: "bone", id }, live: null });
      notify("Bone added — drop parts on it from the Parts panel", "ok");
      return id;
    },
    deleteBone: (id) => {
      const s = get();
      const kids = indexScene(s.scene).children.get(id) ?? [];
      const grand = indexScene(s.scene).byId.get(id)?.parent ?? null;
      mutate((d) => {
        for (const k of kids) {
          const b = d.bones.find((x) => x.id === k.id);
          if (b) b.parent = grand;
        }
        d.bones = d.bones.filter((b) => b.id !== id);
        delete d.tracks[id];
        d.shapes = d.shapes.filter((sh) => sh.bone !== id);
        d.chains = d.chains
          .map((c) => ({ ...c, bones: c.bones.filter((bid) => bid !== id) }))
          .filter((c) => c.bones.length > 0);
        for (const b of d.bones) if (b.mirror === id) b.mirror = null;
      }, "delete bone");
      set({ selection: { kind: "none", id: null }, live: null });
      notify(kids.length ? "Bone deleted; its children moved up a level" : "Bone deleted", "warn");
    },
    updateBone: (id, patch) =>
      mutate((d) => {
        const b = d.bones.find((x) => x.id === id);
        if (!b) return;
        Object.assign(b, patch);
        if (patch.length != null) {
          for (const sh of d.shapes) {
            if (sh.bone === id && sh.kind) sh.pts = buildPart(sh.kind, Math.max(16, patch.length));
          }
        }
      }, "bone props"),
    setLimits: (id, patch) =>
      mutate((d) => {
        const b = d.bones.find((x) => x.id === id);
        if (!b) return;
        if ("min" in patch) b.min = patch.min ?? undefined;
        if ("max" in patch) b.max = patch.max ?? undefined;
      }, "joint limits"),
    reparentBone: (id, parent) =>
      mutate((d) => {
        const b = d.bones.find((x) => x.id === id);
        if (!b || id === parent) return;
        let cur = parent ? d.bones.find((x) => x.id === parent) : null;
        while (cur) {
          if (cur.id === id) return notify("Can't parent a bone to its own child", "warn");
          cur = cur.parent ? d.bones.find((x) => x.id === cur!.parent) ?? null : null;
        }
        b.parent = parent;
      }, "reparent"),
    toggleChainPick: (boneId) => {
      const cur = get().chainPick;
      set({ chainPick: cur.includes(boneId) ? cur.filter((b) => b !== boneId) : [...cur, boneId] });
    },
    makeChainFromPick: (pole) => {
      const s = get();
      if (s.chainPick.length < 2) return notify("Pick 2+ bones in a row (shift-click them in Rig mode)", "warn");
      const idx = indexScene(s.scene);
      const picked = s.chainPick.map((id) => idx.byId.get(id)!).filter(Boolean);
      picked.sort((a, b) => depthOf(idx, a.id) - depthOf(idx, b.id));
      for (let i = 1; i < picked.length; i++) {
        if (picked[i].parent !== picked[i - 1].id) {
          return notify("Chain bones must be a connected chain (each the child of the previous)", "warn");
        }
      }
      const id = `ik${Math.random().toString(36).slice(2, 6)}`;
      const bones = picked.map((b) => b.id);
      mutate((d) => {
        d.chains.push({
          id,
          name: `IK ${d.chains.length + 1}`,
          bones,
          pole,
          show: true,
          color: CHAIN_COLORS[d.chains.length % CHAIN_COLORS.length],
        });
        for (const b of bones) {
          const bone = d.bones.find((x) => x.id === b);
          if (bone) bone.chain = id;
        }
      }, "add IK chain");
      set({ chainPick: [], selection: { kind: "chain", id } });
      notify(`IK chain ready: grab the ${pole ? "ring + triangle " : ""}handle to pose all ${bones.length} bones at once`, "ok");
    },
    deleteChain: (id) =>
      mutate((d) => {
        d.chains = d.chains.filter((c) => c.id !== id);
        for (const b of d.bones) if (b.chain === id) b.chain = null;
      }, "delete chain"),
    toggleChain: (id) =>
      mutate((d) => {
        const c = d.chains.find((x) => x.id === id);
        if (c) c.show = !c.show;
      }, "chain visibility"),
    setChainPole: (id, pole) =>
      mutate((d) => {
        const c = d.chains.find((x) => x.id === id);
        if (c) c.pole = pole;
      }, "chain pole"),
    autoRig: () => {
      let made = 0;
      mutate((d) => {
        const idx = indexScene(d);
        const used = new Set<string>();
        for (const c of d.chains) for (const b of c.bones) used.add(b);
        for (const root of idx.roots) {
          for (const limb of idx.children.get(root.id) ?? []) {
            const chain: string[] = [];
            let cur: Bone | undefined = limb;
            while (cur && chain.length < 5) {
              if (used.has(cur.id) || cur.length < 8) break;
              chain.push(cur.id);
              const kids: Bone[] = (idx.children.get(cur.id) ?? []).filter((k) => k.length >= 8 && !used.has(k.id));
              if (!kids.length) break;
              cur = kids[0];
            }
            if (chain.length >= 2) {
              const id = `ik${Math.random().toString(36).slice(2, 6)}`;
              d.chains.push({
                id,
                name: `IK ${idx.byId.get(chain[0])?.name ?? "chain"}`,
                bones: chain,
                pole: chain.length === 2,
                show: true,
                color: CHAIN_COLORS[d.chains.length % CHAIN_COLORS.length],
              });
              for (const b of chain) {
                const bb = d.bones.find((x) => x.id === b);
                if (bb) bb.chain = id;
                used.add(b);
              }
              made++;
            }
          }
        }
      }, "auto rig");
      notify(made ? `Auto-rig: ${made} IK chain(s) created from your limb chains` : "No un-rigged limbs found", made ? "ok" : "info");
    },

    addPart: (kind, boneId) => {
      const id = `p${Math.random().toString(36).slice(2, 7)}`;
      mutate((d) => {
        const bone = d.bones.find((b) => b.id === boneId);
        const len = Math.max(16, bone?.length ?? 40);
        const pts = kind === "custom" ? [{ x: 0, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: 0, y: 10 }] : buildPart(kind, len);
        d.shapes.push({
          id,
          name: kind,
          bone: boneId,
          pts,
          closed: true,
          role: roleForPart(kind),
          visible: true,
          z: d.shapes.length + 1,
          kind: kind === "custom" ? undefined : kind,
        });
      }, "add part");
      set({ selection: { kind: "shape", id }, live: null });
      notify("Part attached to the bone", "ok");
    },
    deleteShape: (id) =>
      mutate((d) => {
        d.shapes = d.shapes.filter((s) => s.id !== id);
      }, "delete part"),
    updateShape: (id, patch) =>
      mutate((d) => {
        const s = d.shapes.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      }, "part props"),
    commitShapePts: (id, pts) =>
      mutate((d) => {
        const s = d.shapes.find((x) => x.id === id);
        if (s) s.pts = pts;
      }, "move part"),
    reorderShape: (id, dir) =>
      mutate((d) => {
        const sorted = [...d.shapes].sort((a, b) => a.z - b.z);
        const i = sorted.findIndex((s) => s.id === id);
        if (i < 0) return;
        const j = dir === "front" ? sorted.length - 1 : dir === "back" ? 0 : clamp(i + dir, 0, sorted.length - 1);
        const [it] = sorted.splice(i, 1);
        sorted.splice(j, 0, it);
        sorted.forEach((s, k) => {
          const real = d.shapes.find((x) => x.id === s.id);
          if (real) real.z = k;
        });
      }, "layer order"),
    duplicateShape: (id) => {
      const nid = `p${Math.random().toString(36).slice(2, 7)}`;
      mutate((d) => {
        const s = d.shapes.find((x) => x.id === id);
        if (!s) return;
        d.shapes.push({ ...clone(s), id: nid, name: `${s.name} copy`, z: s.z + 0.5 });
      }, "duplicate part");
      set({ selection: { kind: "shape", id: nid } });
    },
    fitPartsToBones: () =>
      mutate((d) => {
        for (const s of d.shapes) {
          if (!s.kind) continue;
          const b = d.bones.find((x) => x.id === s.bone);
          s.pts = buildPart(s.kind, Math.max(16, b?.length ?? 40));
        }
      }, "fit parts"),
    setShapeRole: (id, role) =>
      mutate((d) => {
        const s = d.shapes.find((x) => x.id === id);
        if (s) {
          s.role = role;
          s.fill = undefined;
        }
      }, "recolour"),
    setShapeFill: (id, fill) =>
      mutate((d) => {
        const s = d.shapes.find((x) => x.id === id);
        if (s) s.fill = fill;
      }, "recolour"),

    setPalette: (name) =>
      mutate((d) => {
        const pal = (PALETTES as Record<string, Scene["palette"]>)[name];
        if (pal) d.palette = { ...pal };
      }, "palette"),
    setOutline: (c) => mutate((d) => void (d.outline = c), "outline"),
    setBg: (top, bottom) =>
      mutate((d) => {
        d.bgTop = top;
        d.bgBottom = bottom;
      }, "background"),
    setGround: (y) => mutate((d) => void (d.ground = y), "ground"),
    setFps: (fps) => mutate((d) => void (d.fps = clamp(Math.round(fps), 1, 120)), "fps"),
    setFrames: (n) => {
      const target = clamp(Math.round(n), 2, 600);
      const was = get().scene.frames;
      mutate((d) => {
        d.frames = target;
        if (target < was) {
          // Shrink the shot = cut the tail: keys past the end would otherwise haunt the loop.
          let cut = 0;
          for (const [id, tr] of Object.entries(d.tracks)) {
            const r0 = tr.rot.length + tr.pos.length;
            tr.rot = tr.rot.filter((k) => k.t <= target - 1);
            tr.pos = tr.pos.filter((k) => k.t <= target - 1);
            cut += r0 - (tr.rot.length + tr.pos.length);
            if (!tr.rot.length && !tr.pos.length) delete d.tracks[id];
          }
          if (cut) notify(`Removed ${cut} keyframe${cut === 1 ? "" : "s"} past frame ${target - 1}`, "info");
        }
      }, "length");
    },
    setLoop: (v) => mutate((d) => void (d.loop = v), "loop"),
    renameScene: (name) => mutate((d) => void (d.name = name), "rename"),
    clearAllKeys: () => {
      mutate((d) => void clearKeys(d), "clear all keys");
      notify("All keyframes cleared — rig is back to its rest pose", "warn");
    },
    loadRig: (id, withDemo = true) => {
      const def = RIG_MAP.get(id) as RigDef | undefined;
      if (!def) return;
      const scene = buildScene(def);
      if (withDemo && def.demo) applyDemo(scene, def.demo);
      get().loadScene(scene, `load ${def.label}`, true);
      notify(
        withDemo && def.demo ? `${def.label}: rig + demo loaded. Drag the coloured handles to re-pose!` : `${def.label} loaded — drag to pose`,
        "ok",
      );
    },
    loadScene: (scene, label = "load", doFit = true) => {
      const { past } = get();
      set({
        scene: clone(scene),
        past: [...past, { scene: get().scene, label }].slice(-HISTORY_LIMIT),
        future: [],
        live: null,
        frame: 0,
        selection: { kind: "bone", id: scene.bones[0]?.id ?? null },
      });
      if (doFit) setTimeout(() => get().fit(), 0);
    },
    newScene: () => {
      get().loadScene(buildScene(RIGS.find((r) => r.id === "blank")!), "new scene", true);
      notify("Empty stage: Rig mode → drag on the canvas to grow bones from the selected joint", "ok");
      set({ mode: "rig" });
    },
    setDrawPoints: (p) => set({ drawPoints: p }),
    finishDraw: () => {
      const s = get();
      const pts = s.drawPoints;
      const chosen = s.selection.kind === "bone" ? s.selection.id : null;
      const boneId = chosen ?? nearestBoneTo(s.scene, basePose(), centroid(pts));
      if (pts.length < 3 || !boneId) {
        notify("Draw a shape (3+ points) while a bone is selected", "warn");
        set({ drawPoints: [] });
        return;
      }
      const id = `p${Math.random().toString(36).slice(2, 7)}`;
      const pose = basePose();
      const a = pose.ang[boneId] ?? 0;
      const o = pose.pos[boneId] ?? s.scene.root;
      const cos = Math.cos(-a);
      const sin = Math.sin(-a);
      const local = pts.map((p) => {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
      });
      mutate((d) => {
        d.shapes.push({
          id,
          name: "Custom shape",
          bone: boneId,
          pts: local,
          closed: true,
          role: "skin",
          visible: true,
          z: d.shapes.length + 1,
        });
      }, "draw shape");
      set({ drawPoints: [], selection: { kind: "shape", id }, mode: "art", live: null });
      notify("Shape welded to the bone — it will follow that bone forever", "ok");
    },
    setPartKind: (k) => set({ partKind: k }),
    finishLasso: (pts, boneId) => {
      set({ drawPoints: pts, selection: boneId ? { kind: "bone", id: boneId } : get().selection });
      get().finishDraw();
    },
  };
});

function depthOf(idx: ReturnType<typeof indexScene>, id: string): number {
  let n = 0;
  let b = idx.byId.get(id);
  while (b?.parent) {
    n++;
    b = idx.byId.get(b.parent);
  }
  return n;
}

const PART_ROLES: Record<string, RoleKey> = {
  torso: "cloth",
  belly: "white",
  chest: "cloth2",
  hipbox: "cloth2",
  shell: "skin",
  neck: "skin",
  head: "skin",
  snout: "skin",
  jaw: "skin",
  ear: "skin",
  horn: "accent",
  eye: "white",
  pupil: "eye",
  mouth: "dark",
  hairSpike: "hair",
  upperArm: "skin",
  foreArm: "skin",
  hand: "skin",
  mitten: "skin",
  sleeve: "cloth",
  thigh: "cloth2",
  shin: "cloth2",
  foot: "shoe",
  paw: "shoe",
  hoof: "dark",
  wing: "accent",
  tail: "skin",
  tailTuft: "hair",
  sword: "cloth2",
  shield: "accent",
  hat: "cloth2",
  cape: "accent",
  ball: "accent",
  rectPanel: "cloth2",
  spark: "accent",
  dust: "white",
};

const roleForPart = (kind: string): RoleKey => PART_ROLES[kind] ?? "skin";

/** Degrees helper re-exported so panels don't import core/math directly. */
export const toDeg = deg;
export const toRad = rad;
export { translatePts, scalePts, rotatePts };
