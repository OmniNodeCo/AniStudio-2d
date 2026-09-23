import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { clamp, simplify, type Vec } from "../core/math";
import { hitTest, type Hit } from "../core/hit";
import { poleHandle } from "../core/ik";
import { applyCamera, drawForegroundGuides, drawOverlay, drawParts, drawShadow, paintBackdrop, screenToWorld } from "../core/render";
import { indexScene, poseRotations } from "../core/rig";
import { boneToWorld, solveFK, worldToBone } from "../core/fk";
import { nearestBoneTo } from "../core/pose-edit";
import { PARTS } from "../core/parts";

type DragState =
  | { kind: "pan"; last: Vec }
  | { kind: "ik"; chainId: string; pole: Vec | null; offset: Vec; snapped: boolean }
  | { kind: "pole"; chainId: string }
  | { kind: "bone"; boneId: string; pivot: Vec; startAng: number; startRot: number }
  | { kind: "root"; boneId: string; offset: Vec }
  | { kind: "shape"; shapeId: string; base: Vec[]; start: Vec; mode: "move" | "rotate" | "scale" }
  | { kind: "grow"; fromBone: string; from: Vec; to: Vec; moved: boolean }
  | { kind: "resize"; boneId: string; anchor: Vec }
  | { kind: "lasso"; pts: Vec[]; start: Vec }
  | null;

const SNAP = 15 * (Math.PI / 180);

export function Stage() {
  const scene = useStudio((s) => s.scene);
  const frame = useStudio((s) => s.frame);
  const live = useStudio((s) => s.live);
  const mode = useStudio((s) => s.mode);
  const view = useStudio((s) => s.view);
  const hover = useStudio((s) => s.hover);
  const drag = useStudio((s) => s.drag);
  const selection = useStudio((s) => s.selection);
  const chainPick = useStudio((s) => s.chainPick);
  const drawPoints = useStudio((s) => s.drawPoints);
  const showGrid = useStudio((s) => s.showGrid);
  const showBones = useStudio((s) => s.showBones);
  const showHandles = useStudio((s) => s.showHandles);
  const showNames = useStudio((s) => s.showNames);
  const showShadow = useStudio((s) => s.showShadow);
  const showOnion = useStudio((s) => s.showOnion);
  const playing = useStudio((s) => s.playing);
  const mirrorX = useStudio((s) => s.mirrorX);
  const busy = useStudio((s) => s.busy);
  const a = useStudio.getState();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const spaceRef = useRef(false);
  const [size, setSize] = useState({ w: 960, h: 620 });
  const [dropHint, setDropHint] = useState(false);
  const [, force] = useState(0);
  const redraw = useCallback(() => force((n) => n + 1), []);

  const st = { scene, frame, live, mode, view, hover, drag, selection, chainPick, drawPoints, showGrid, showBones, showHandles, showNames, showShadow, showOnion, playing, mirrorX };

  // ---------------------------------------------------------------- sizing
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(220, Math.floor(r.width)), h: Math.max(180, Math.floor(r.height)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    a.setView({ w: size.w, h: size.h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  useEffect(() => {
    const id = window.setTimeout(() => a.fit(), 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement)?.matches?.("input,textarea,select")) {
        spaceRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toWorld = useCallback(
    (cx: number, cy: number): Vec => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return screenToWorld({ x: cx - r.left, y: cy - r.top }, { ...view, w: size.w, h: size.h });
    },
    [view, size.w, size.h],
  );
  const toLocal = (cx: number, cy: number): Vec => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) };
  };

  const poseNow = useCallback(() => {
    const rots = poseRotations(scene, frame, live && Object.keys(live.rot).length ? live.rot : undefined);
    return solveFK(scene, rots, frame, live?.root ?? undefined);
  }, [scene, frame, live]);

  /** Scene with live part edits applied, so dragging art previews smoothly. */
  const sceneNow = useCallback(() => {
    const ls = live?.shapes;
    if (!ls || !Object.keys(ls).length) return scene;
    return { ...scene, shapes: scene.shapes.map((sh) => (ls[sh.id] ? { ...sh, pts: ls[sh.id] } : sh)) };
  }, [scene, live]);

  // ---------------------------------------------------------------- paint
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = size.w;
    const H = size.h;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const v = { ...view, w: W, h: H };
    const pose = poseNow();
    const sc = sceneNow();

    paintBackdrop(ctx, scene, W, H);
    applyCamera(ctx, v, dpr);
    drawForegroundGuides(ctx, scene, v, { grid: showGrid, ground: true });
    if (showShadow) drawShadow(ctx, scene, pose);

    // onion skin: previous frames pink, next frames cyan
    if (showOnion > 0 && !playing) {
      for (let i = showOnion; i >= 1; i--) {
        const aPrev = ((frame - i) % scene.frames + scene.frames) % scene.frames;
        if (frame - i >= 0 || scene.loop) {
          const p = solveFK(scene, poseRotations(scene, aPrev), aPrev);
          drawParts(ctx, scene, p, { silhouette: "#ff7d9c", alpha: 0.09 + 0.13 * (1 - (i - 1) / showOnion), outlines: false });
        }
        const aNext = (frame + i) % scene.frames;
        if (frame + i < scene.frames || scene.loop) {
          const p = solveFK(scene, poseRotations(scene, aNext), aNext);
          drawParts(ctx, scene, p, { silhouette: "#66e0ff", alpha: 0.09 + 0.13 * (1 - (i - 1) / showOnion), outlines: false });
        }
      }
    }

    drawParts(ctx, sc, pose, {
      selected: selection.kind === "shape" && selection.id ? [selection.id] : [],
      hover: hover?.startsWith("shape:") ? hover.slice(6) : null,
    });

    if (mode !== "art") {
      drawOverlay(ctx, scene, pose, v, {
        showBones,
        showHandles: mode === "pose" && showHandles,
        showNames,
        selectedBone: selection.kind === "bone" ? selection.id : null,
        selectedChain: selection.kind === "chain" ? selection.id : null,
        hoverId: hover,
        drag,
        restGhost: mode === "rig",
        mirrorAxis: mirrorX ? pose.pos[indexScene(scene).roots[0]?.id ?? ""]?.x ?? scene.root.x : null,
      });
    }

    const k = 1 / view.cam.zoom;
    // rig-mode: chain picking + the bone being grown
    if (mode === "rig") {
      ctx.save();
      ctx.lineCap = "round";
      for (const b of scene.bones) {
        if (!chainPick.includes(b.id)) continue;
        const p0 = pose.pos[b.id];
        const e0 = pose.end[b.id];
        if (!p0 || !e0) continue;
        ctx.strokeStyle = "#ffd166";
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 8 * k;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(e0.x, e0.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const d = dragRef.current;
      if (d && d.kind === "grow") {
        ctx.setLineDash([7 * k, 5 * k]);
        ctx.strokeStyle = "#7cf0c8";
        ctx.lineWidth = 3.4 * k;
        ctx.beginPath();
        ctx.moveTo(d.from.x, d.from.y);
        ctx.lineTo(d.to.x, d.to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#e9fff6";
        ctx.beginPath();
        ctx.arc(d.to.x, d.to.y, 4 * k, 0, Math.PI * 2);
        ctx.fill();
        const len = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
        ctx.font = `${Math.max(10, 12 * k)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(`${Math.round(len)}u`, d.to.x + 10 * k, d.to.y - 10 * k);
      }
      ctx.restore();
    }

    // draw-mode: the shape being traced
    if (mode === "draw" && drawPoints.length) {
      ctx.save();
      ctx.strokeStyle = "#ffd166";
      ctx.fillStyle = "rgba(255,209,102,0.16)";
      ctx.lineWidth = 2.4 * k;
      ctx.beginPath();
      drawPoints.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (drawPoints.length > 2) ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd166";
      for (const p of drawPoints) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (busy) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(8,9,14,0.55)";
      ctx.fillRect(0, 0, W * dpr, H * dpr);
      ctx.fillStyle = "#eaf0ff";
      ctx.font = `${14 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(busy, (W * dpr) / 2, (H * dpr) / 2);
      ctx.restore();
    }
  }, [st, size.w, size.h, poseNow, sceneNow, redraw, busy, view, frame, scene, live, mode, hover, drag, selection, chainPick, drawPoints, showGrid, showBones, showHandles, showNames, showShadow, showOnion, playing, mirrorX]);

  // ------------------------------------------------------------ interaction
  const hitOpts = () => ({
    handles: mode === "pose" && showHandles,
    parts: mode !== "rig",
    partsFirst: mode === "art" || mode === "draw",
  });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const world = toWorld(e.clientX, e.clientY);
    const local = toLocal(e.clientX, e.clientY);
    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { kind: "pan", last: local };
      return;
    }
    if (e.button !== 0) return;
    const pose = poseNow();
    const hit = hitTest(scene, pose, { ...view, w: size.w, h: size.h }, world, hitOpts());

    if (mode === "draw") {
      dragRef.current = { kind: "lasso", pts: [world], start: world };
      a.setDrawPoints([world]);
      return;
    }

    if (mode === "rig") {
      if (hit && e.shiftKey && "bone" in hit) {
        a.toggleChainPick(hit.bone);
        return;
      }
      if (hit && (hit.kind === "tip" || hit.kind === "joint" || hit.kind === "root")) {
        const boneId = hit.bone;
        const from = hit.kind === "tip" ? pose.end[boneId] : pose.pos[boneId];
        if (e.altKey && hit.kind === "tip") {
          dragRef.current = { kind: "resize", boneId, anchor: pose.pos[boneId] };
        } else {
          dragRef.current = { kind: "grow", fromBone: boneId, from, to: world, moved: false };
          a.select("bone", boneId);
        }
        return;
      }
      if (hit?.kind === "bone") return a.select("bone", hit.bone);
      if (hit?.kind === "shape") return a.select("bone", hit.bone);
      a.select("none", null);
      return;
    }

    if (mode === "art") {
      if (hit?.kind === "shape") {
        const shape = scene.shapes.find((x) => x.id === hit.shape);
        if (!shape) return;
        a.checkpoint("move part");
        a.select("shape", shape.id);
        dragRef.current = {
          kind: "shape",
          shapeId: shape.id,
          base: shape.pts,
          start: world,
          mode: e.altKey ? "rotate" : e.shiftKey ? "scale" : "move",
        };
        return;
      }
      if (hit && "bone" in hit) return a.select("bone", hit.bone);
      a.select("none", null);
      return;
    }

    // pose mode
    if (!hit) {
      a.select("none", null);
      return;
    }
    switch (hit.kind) {
      case "ik": {
        const chain = scene.chains.find((c) => c.id === hit.chain)!;
        const tip = pose.end[chain.bones[chain.bones.length - 1]];
        a.checkpoint("IK pose");
        a.select("chain", chain.id);
        dragRef.current = {
          kind: "ik",
          chainId: chain.id,
          pole: chain.pole ? poleHandle(pose.pos[chain.bones[0]], pose.pos[chain.bones[1]], tip) : null,
          offset: { x: tip.x - world.x, y: tip.y - world.y },
          snapped: false,
        };
        a.setDrag({ kind: "ik", id: chain.id, point: tip, reach: { center: pose.pos[chain.bones[0]], radius: reachOf(scene, chain.bones) } });
        return;
      }
      case "pole": {
        a.checkpoint("pole");
        a.select("chain", hit.chain);
        dragRef.current = { kind: "pole", chainId: hit.chain };
        a.setDrag({ kind: "pole", id: hit.chain });
        return;
      }
      case "tip":
      case "joint": {
        // Grabbing a joint rotates the bone that ends there (grab the elbow → the upper
        // arm swings). Grabbing a tip rotates the bone whose tip you are holding.
        const boneId = hit.kind === "joint" ? indexScene(scene).byId.get(hit.bone)?.parent ?? hit.bone : hit.bone;
        const pivot = pose.pos[boneId];
        a.checkpoint("pose");
        a.select("bone", boneId);
        dragRef.current = {
          kind: "bone",
          boneId,
          pivot,
          startAng: Math.atan2(world.y - pivot.y, world.x - pivot.x),
          startRot: poseRotations(scene, frame)[boneId] ?? 0,
        };
        a.setDrag({ kind: "joint", id: boneId, point: pivot });
        return;
      }
      case "root": {
        a.checkpoint("root move");
        a.select("bone", hit.bone);
        dragRef.current = { kind: "root", boneId: hit.bone, offset: { x: pose.pos[hit.bone].x - world.x, y: pose.pos[hit.bone].y - world.y } };
        a.setDrag({ kind: "root", id: hit.bone, point: pose.pos[hit.bone] });
        return;
      }
      case "shape": {
        const shape = scene.shapes.find((x) => x.id === hit.shape);
        if (!shape) return;
        a.select("bone", shape.bone);
        a.setKeySel(null);
        return;
      }
      case "bone":
        a.select("bone", hit.bone);
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(e.clientX, e.clientY);
    const d = dragRef.current;
    if (!d) {
      const pose = poseNow();
      const hit = hitTest(scene, pose, { ...view, w: size.w, h: size.h }, world, hitOpts());
      a.setHover(hit ? hoverKey(hit) : null);
      return;
    }
    if (d.kind === "pan") {
      const local = toLocal(e.clientX, e.clientY);
      a.panBy(local.x - d.last.x, local.y - d.last.y);
      d.last = local;
      return;
    }
    if (d.kind === "lasso") {
      d.pts.push(world);
      const s2 = d.pts.length > 6 ? simplify(d.pts, 1.6 / view.cam.zoom) : d.pts;
      a.setDrawPoints(s2);
      return;
    }
    if (d.kind === "grow") {
      d.to = world;
      d.moved = true;
      redraw();
      return;
    }
    if (d.kind === "resize") {
      const len = Math.max(6, Math.hypot(world.x - d.anchor.x, world.y - d.anchor.y));
      a.updateBone(d.boneId, { length: Math.round(len) });
      dragRef.current = { ...d, anchor: d.anchor };
      return;
    }
    if (d.kind === "shape") {
      applyShapeDrag(d, world, e.altKey, e.shiftKey);
      return;
    }
    if (d.kind === "ik") {
      const raw = { x: world.x + d.offset.x, y: world.y + d.offset.y };
      const ground = scene.ground;
      const chain = scene.chains.find((c) => c.id === d.chainId);
      const tipBone = chain ? chain.bones[chain.bones.length - 1] : null;
      const lift = tipBone ? soleLift(scene, tipBone) : 0;
      const snapWindow = 12 / view.cam.zoom;
      const snapped = ground != null && Math.abs(raw.y - (ground - lift)) < snapWindow;
      const target = snapped ? { x: raw.x, y: ground - lift } : raw;
      a.ikDrag(d.chainId, target, d.pole);
      d.snapped = snapped;
      if (chain) a.setDrag({ kind: "ik", id: d.chainId, point: target, snapped, reach: { center: poseNow().pos[chain.bones[0]], radius: reachOf(scene, chain.bones) } });
      return;
    }
    if (d.kind === "pole") {
      a.poleDrag(d.chainId, world);
      return;
    }
    if (d.kind === "bone") {
      const ang = Math.atan2(world.y - d.pivot.y, world.x - d.pivot.x);
      let delta = ang - d.startAng;
      if (e.shiftKey) delta = Math.round(delta / SNAP) * SNAP;
      const r = d.startRot + delta;
      a.setLive({ rot: { ...(live?.rot ?? {}), [d.boneId]: r } });
      if (mirrorX) {
        const twin = indexScene(scene).byId.get(d.boneId)?.mirror;
        if (twin) a.setLive({ rot: { ...(live?.rot ?? {}), [d.boneId]: r, [twin]: -r } });
      }
      return;
    }
    if (d.kind === "root") {
      const p = { x: world.x + d.offset.x, y: world.y + d.offset.y };
      a.rootDrag(e.shiftKey ? { x: p.x, y: Math.round(p.y / 10) * 10 } : p);
      a.setDrag({ kind: "root", id: d.boneId, point: p });
      return;
    }
  };

  const applyShapeDrag = (d: Extract<DragState, { kind: "shape" }>, world: Vec, alt: boolean, shift: boolean) => {
    const shape = scene.shapes.find((x) => x.id === d.shapeId);
    if (!shape) return;
    const pose = poseNow();
    const centreLocal = centroid(d.base);
    const centre = boneToWorld(centreLocal, pose, shape.bone);
    if (alt) {
      const ang = Math.atan2(world.y - centre.y, world.x - centre.x) - Math.atan2(d.start.y - centre.y, d.start.x - centre.x);
      a.shapeDrag(shape.id, rotateAbout(d.base, ang));
      return;
    }
    if (shift) {
      const r0 = Math.hypot(d.start.x - centre.x, d.start.y - centre.y);
      const r1 = Math.hypot(world.x - centre.x, world.y - centre.y);
      const sc = r0 > 1 ? clamp(r1 / r0, 0.25, 4) : 1;
      a.shapeDrag(shape.id, d.base.map((p) => ({ x: centreLocal.x + (p.x - centreLocal.x) * sc, y: centreLocal.y + (p.y - centreLocal.y) * sc })));
      return;
    }
    const from = worldToBone(d.start, pose, shape.bone);
    const to = worldToBone(world, pose, shape.bone);
    const local = { x: to.x - from.x, y: to.y - from.y };
    a.shapeDrag(shape.id, d.base.map((p) => ({ x: p.x + local.x, y: p.y + local.y })));
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "lasso") {
      if (d.pts.length > 6) {
        const bone = nearestBoneTo(scene, poseNow(), centroid(d.pts));
        if (bone) {
          a.finishLasso(d.pts, bone);
        } else {
          a.notify("Draw on a bone — switch to Rig mode and grow one first", "warn");
          a.setDrawPoints([]);
        }
      } else {
        // a single click: add a polygon vertex
        a.setDrawPoints([...drawPoints, d.start]);
      }
      return;
    }
    if (d.kind === "grow") {
      const len = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
      if (d.moved && len > 8) a.addBone(d.fromBone, d.from, d.to);
      redraw();
      return;
    }
    if (d.kind === "pan") return;
    a.commitLive();
    a.setDrag(null);
  };

  const onDoubleClick = () => {
    if (mode === "draw" && drawPoints.length > 2) a.finishDraw();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.shiftKey) {
      a.panBy(e.deltaY, 0);
      return;
    }
    a.zoomAt(Math.exp(-e.deltaY * 0.0016), toLocal(e.clientX, e.clientY));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(false);
    const kind = e.dataTransfer.getData("application/x-anipart") || e.dataTransfer.getData("text/plain");
    if (!kind) return;
    const world = toWorld(e.clientX, e.clientY);
    const bone = nearestBoneTo(scene, poseNow(), world) ?? (selection.kind === "bone" ? selection.id : null) ?? scene.bones[0]?.id;
    if (!bone) return a.notify("Grow a bone first (Rig mode), then drop parts on it", "warn");
    a.addPart(kind, bone);
  };

  const cursor = cursorFor(hover, mode);

  return (
    <div
      ref={wrapRef}
      className={`stage${dropHint ? " dropping" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dropHint) setDropHint(true);
      }}
      onDragLeave={() => setDropHint(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onPointerLeave={() => a.setHover(null)}
      />
      <StageHud snapped={!!(drag && drag.kind === "ik" && drag.snapped)} />
    </div>
  );
}

/* ------------------------------------------------------------------ utils */

const centroid = (pts: Vec[]): Vec => {
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

const rotateAbout = (pts: Vec[], ang: number): Vec[] => {
  const c = centroid(pts);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }));
};

const reachOf = (scene: Parameters<typeof indexScene>[0], boneIds: string[]): number => {
  const idx = indexScene(scene);
  return boneIds.reduce((acc, id) => acc + (idx.byId.get(id)?.length ?? 0), 0);
};

/** How far below a joint the welded art reaches, so feet can snap flat onto the ground. */
function soleLift(scene: Parameters<typeof indexScene>[0], tipBone: string): number {
  let low = 0;
  for (const sh of scene.shapes) {
    if (sh.bone !== tipBone) continue;
    for (const p of sh.pts) low = Math.max(low, Math.abs(p.y));
  }
  return clamp(low * 0.55, 0, 26);
}

function hoverKey(hit: Hit): string {
  switch (hit.kind) {
    case "ik":
      return `ik:${hit.chain}`;
    case "pole":
      return `pole:${hit.chain}`;
    case "joint":
      return `joint:${hit.bone}`;
    case "tip":
      return `tip:${hit.bone}`;
    case "root":
      return `root:${hit.bone}`;
    case "shape":
      return `shape:${hit.shape}`;
    default:
      return `bone:${hit.bone}`;
  }
}

function cursorFor(hover: string | null, mode: string): string {
  if (!hover) return mode === "rig" ? "cell" : mode === "draw" ? "crosshair" : "default";
  if (hover.startsWith("ik:") || hover.startsWith("pole:")) return "grab";
  if (hover.startsWith("joint:") || hover.startsWith("tip:")) return "grab";
  if (hover.startsWith("root:")) return "move";
  if (hover.startsWith("shape:")) return mode === "art" ? "move" : "pointer";
  return "pointer";
}

function StageHud({ snapped }: { snapped: boolean }) {
  const mode = useStudio((s) => s.mode);
  const view = useStudio((s) => s.view);
  const frame = useStudio((s) => s.frame);
  const frames = useStudio((s) => s.scene.frames);
  const live = useStudio((s) => s.live);
  const a = useStudio.getState();
  const hint = {
    pose: "Drag a ring handle = IK pose for the whole limb · drag a joint = rotate one bone · drag the hips = move the character",
    rig: "Drag out from a joint to grow a bone · Shift-click bones to collect them, then “Make IK chain”",
    art: "Drag parts to nudge them · Alt = rotate · Shift = scale · drop new parts from the library on the left",
    draw: "Drag to trace freehand, or click-click-click for a polygon · Enter or double-click welds it to the bone",
  }[mode];
  const bones = useStudio((s) => s.scene.bones.length);
  const parts = PARTS.length;
  return (
    <>
      <div className="hud hud-hint">{hint}</div>
      <div className="hud hud-zoom">
        <button className="mini" onClick={() => a.zoomAt(1 / 1.25, { x: view.w / 2, y: view.h / 2 })} title="Zoom out">
          −
        </button>
        <span>{Math.round(view.cam.zoom * 100)}%</span>
        <button className="mini" onClick={() => a.zoomAt(1.25, { x: view.w / 2, y: view.h / 2 })} title="Zoom in">
          +
        </button>
        <button className="mini" onClick={() => a.fit()} title="Fit character to view (F)">
          ⤢
        </button>
      </div>
      <div className="hud hud-count">
        {bones} bones · {parts} parts to drag
      </div>
      <div className="hud hud-frame">
        <b>{frame + 1}</b>
        <span>/{frames}</span>
        {live && Object.keys(live.rot).length > 0 && <em className="chip warn">unkeyed</em>}
        {snapped && <em className="chip ok">planted on ground</em>}
      </div>
    </>
  );
}
