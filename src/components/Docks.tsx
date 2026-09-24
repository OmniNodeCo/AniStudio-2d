import { useMemo, useState } from "react";
import { useStudio } from "../state/store";
import { PARTS, PART_GROUPS, buildPart } from "../core/parts";
import { clamp, deg, EASES, rad, wrapPi, type Ease, type Vec } from "../core/math";
import { indexScene } from "../core/rig";
import { RIGS } from "../presets/rigs";
import { DEMOS, DEMO_LABELS } from "../presets/demos";
import { LIGHTS, SCENERY, SCENERY_GROUPS, objectBox } from "../core/scenery";
import { ROLES, type LightKind, type RoleKey, type Scene, type SceneObject, type SceneryKind } from "../core/types";
import { sampleCamera } from "../core/cameras";
import { timelineAt } from "../core/timeline";
import { ExportPanel } from "./ExportPanel";

/* ------------------------------------------------------------- left dock */

export function LeftDock() {
  const [tab, setTab] = useState<"parts" | "rig" | "set" | "scene">("parts");
  return (
    <aside className="dock left">
      <nav className="tabs">
        {(["parts", "rig", "set", "scene"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "parts" ? "Parts" : t === "rig" ? "Rig & IK" : t === "set" ? "Set" : "Scene"}
          </button>
        ))}
      </nav>
      <div className="dock-body">
        {tab === "parts" && <PartsLibrary />}
        {tab === "rig" && <RigPanel />}
        {tab === "set" && <StagePanel />}
        {tab === "scene" && <ScenePanel />}
      </div>
    </aside>
  );
}

function PartsLibrary() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const partKind = useStudio((s) => s.partKind);
  const a = useStudio.getState();
  const groups = useMemo(() => {
    const out = PART_GROUPS.map((g) => ({ group: g.label, parts: PARTS.filter((p) => p.group === g.id) }));
    return out.filter((g) => g.parts.length);
  }, []);
  const targetBone = selection.kind === "bone" ? selection.id : scene.bones[0]?.id ?? null;
  const [filter, setFilter] = useState("");

  return (
    <div className="pane">
      <p className="pane-lead">
        Drag a part onto the character to weld it to the bone underneath — or click it to attach to
        <b> {scene.bones.find((b) => b.id === targetBone)?.name ?? "the root"}</b>.
      </p>
      <input className="search" placeholder="filter parts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {groups.map((g) => {
        const items = g.parts.filter((p) => p.label.toLowerCase().includes(filter.toLowerCase()) || p.id.includes(filter.toLowerCase()));
        if (!items.length) return null;
        return (
          <div className="part-group" key={g.group}>
            <h4>{g.group}</h4>
            <div className="part-grid">
              {items.map((p) => (
                <button
                  key={p.id}
                  className={`part-tile ${partKind === p.id ? "hot" : ""}`}
                  title={`${p.label} — drag to the canvas, or click to attach`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-anipart", p.id);
                    e.dataTransfer.setData("text/plain", p.id);
                    e.dataTransfer.effectAllowed = "copy";
                    a.setPartKind(p.id);
                  }}
                  onClick={() => {
                    a.setPartKind(p.id);
                    if (targetBone) a.addPart(p.id, targetBone);
                    else a.notify("Select a bone first", "warn");
                  }}
                >
                  <PartThumb kind={p.id} role={p.role} palette={scene.palette} outline={scene.outline} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="pane-foot">
        <button className="ghost" onClick={() => a.setMode("draw")}>
          ✎ draw your own shape
        </button>
        <button className="ghost" onClick={() => a.fitPartsToBones()} title="Rebuild every welded part at its bone's current length">
          ↺ re-fit parts to bones
        </button>
      </div>
    </div>
  );
}

function PartThumb({ kind, role, palette, outline }: { kind: string; role: RoleKey; palette: Record<RoleKey, string>; outline: string }) {
  const pts = useMemo(() => buildPart(kind, 64), [kind]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x0);
  const h = Math.max(1, Math.max(...ys) - y0);
  const pad = 6;
  const size = 46;
  const k = Math.min((size - pad) / w, (size - pad) / h);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`translate(${(size - w * k) / 2 - x0 * k} ${(size - h * k) / 2 - y0 * k}) scale(${k})`}>
        <polygon
          points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill={palette[role] ?? "#cfd6ff"}
          stroke={outline}
          strokeWidth={3 / k}
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function RigPanel() {
  const scene = useStudio((s) => s.scene);
  const chainPick = useStudio((s) => s.chainPick);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const idx = useMemo(() => indexScene(scene), [scene]);
  const [pole, setPole] = useState(true);

  return (
    <div className="pane">
      <div className="rig-tools">
        <button
          className="ghost"
          onClick={() => {
            const from = selection.kind === "bone" ? selection.id : scene.bones[0]?.id;
            if (!from) return a.notify("No bone to extend", "warn");
            const pose = a.basePose();
            const end = pose.end[from] ?? scene.root;
            const ang = pose.ang[from] ?? 0;
            a.addBone(from, end, { x: end.x + Math.cos(ang) * 28, y: end.y + Math.sin(ang) * 28 });
          }}
        >
          ＋ grow a bone (28u)
        </button>
        <button className="ghost" onClick={() => a.autoRig()} title="Turn every un-rigged limb chain into an IK chain">
          ⚡ auto-rig limbs with IK
        </button>
        <button
          className="ghost"
          disabled={chainPick.length < 2}
          onClick={() => a.makeChainFromPick(pole)}
          title="Build an IK chain from the bones you shift-clicked"
        >
          ◎ make IK chain from {chainPick.length || "…"} picked
        </button>
        <label className="check">
          <input type="checkbox" checked={pole} onChange={(e) => setPole(e.target.checked)} />
          add pole (elbow/knee) handle
        </label>
      </div>

      <h4 className="sec">Bones</h4>
      <div className="bone-list">
        {idx.order.map((b) => {
          const chain = b.chain ? scene.chains.find((c) => c.id === b.chain) : null;
          const depth = depthOf(idx, b.id);
          return (
            <div key={b.id} className={`bone-row ${selection.id === b.id ? "sel" : ""}`}>
              <span style={{ width: depth * 9 }} />
              <button className="bname" onClick={() => a.select("bone", b.id)} title={`${b.name} · length ${Math.round(b.length)}`}>
                {b.name}
              </button>
              {chain && <i className="dot" style={{ background: chain.color }} title={chain.name} />}
              <label className="pick" title="Add to IK chain selection">
                <input type="checkbox" checked={chainPick.includes(b.id)} onChange={() => a.toggleChainPick(b.id)} />
              </label>
            </div>
          );
        })}
      </div>

      <h4 className="sec">IK chains</h4>
      {scene.chains.length === 0 && <p className="empty">No chains yet. Shift-click a few bones in a row on the canvas, then “make IK chain”.</p>}
      {scene.chains.map((c) => (
        <div key={c.id} className={`chain-row ${selection.id === c.id ? "sel" : ""}`}>
          <button className="swatch" style={{ background: c.color }} onClick={() => a.select("chain", c.id)} title="Select chain" />
          <button className="bname" onClick={() => a.select("chain", c.id)}>
            {c.name}
            <em>{c.bones.map((b) => idx.byId.get(b)?.name ?? b).join(" → ")}</em>
          </button>
          <label className="mini-check" title="Pole (elbow/knee) handle">
            <input type="checkbox" checked={c.pole} onChange={() => a.setChainPole(c.id, !c.pole)} />
          </label>
          <label className="mini-check" title="Show handles on the canvas">
            <input type="checkbox" checked={c.show} onChange={() => a.toggleChain(c.id)} />
          </label>
          <button className="mini danger" title="Delete chain" onClick={() => a.deleteChain(c.id)}>
            ✕
          </button>
        </div>
      ))}
      <p className="tip">
        Tip: IK is an authoring tool here — when you drag a handle, AniStudio solves the chain and
        writes the resulting rotations as keyframes, so playback and export never need a solver.
      </p>
    </div>
  );
}

function ScenePanel() {
  const scene = useStudio((s) => s.scene);
  const a = useStudio.getState();
  return (
    <div className="pane">
      <h4 className="sec">Start from a rigged character</h4>
      <div className="rig-grid">
        {RIGS.map((r) => (
          <button
            key={r.id}
            className={`rig-card ${scene.rigId === r.id ? "on" : ""}`}
            onClick={() => (r.id === "blank" ? a.newScene() : a.loadRig(r.id, false))}
            title={r.hint}
          >
            <b>{r.label}</b>
            <span>{r.hint}</span>
          </button>
        ))}
      </div>
      <h4 className="sec">Build the set</h4>
      <div className="demo-grid">
        <button className="ghost" onClick={() => a.addExampleScenery()} title="Hills, foliage, horizon and a key light that matches your sky">
          🏞 add example scenery
        </button>
        <button className="ghost" onClick={() => a.addExampleCameras()} title="An establishing wide and a close-up with a push-in — real shots you can re-time">
          🎥 add example cameras
        </button>
      </div>
      <h4 className="sec">Generate a starting animation (baked IK + keys)</h4>
      <div className="demo-grid">
        {Object.keys(DEMOS).map((d) => (
          <button key={d} className="ghost" onClick={() => a.applyDemoNow(d)} title={`Generate "${d}" onto the current rig`}>
            {DEMO_LABELS[d] ?? d}
          </button>
        ))}
      </div>
      <p className="tip">
        Demos write real keyframes on your rig: feet get planted, tails get follow-through. Scrub to
        any frame and drag a handle to fix a pose — that is the whole point.
      </p>
      <h4 className="sec">Colours</h4>
      <PaletteGrid />
      <h4 className="sec">Backdrop</h4>
      <div className="grid2">
        <label className="field">
          sky
          <input type="color" value={scene.bgTop} onChange={(e) => a.setBg(e.target.value, scene.bgBottom)} />
        </label>
        <label className="field">
          floor
          <input type="color" value={scene.bgBottom} onChange={(e) => a.setBg(scene.bgTop, e.target.value)} />
        </label>
        <label className="field">
          outline
          <input type="color" value={scene.outline} onChange={(e) => a.setOutline(e.target.value)} />
        </label>
        <label className="field">
          ground y
          <input
            type="number"
            value={scene.ground ?? 0}
            onChange={(e) => a.setGround(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={scene.ground != null} onChange={(e) => a.setGround(e.target.checked ? 80 : null)} />
        draw ground line &amp; contact shadow
      </label>
      <ExportPanel />
    </div>
  );
}

function PaletteGrid() {
  const scene = useStudio((s) => s.scene);
  const a = useStudio.getState();
  return (
    <div className="role-grid">
      {ROLES.map((r) => (
        <label key={r} className="role" title={`Recolour every part using "${r}"`}>
          <input
            type="color"
            value={scene.palette[r]}
            onChange={(e) =>
              a.mutate((d) => {
                d.palette[r] = e.target.value;
              }, "palette colour")
            }
          />
          <span>{r}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ right dock */

export function RightDock() {
  const selection = useStudio((s) => s.selection);
  return (
    <aside className="dock right">
      <div className="dock-body">
        {selection.kind === "shape" ? (
          <ShapeInspector />
        ) : selection.kind === "chain" ? (
          <ChainInspector />
        ) : selection.kind === "object" ? (
          <ObjectInspector />
        ) : selection.kind === "light" ? (
          <LightInspector />
        ) : selection.kind === "camera" ? (
          <CameraInspector />
        ) : (
          <BoneInspector />
        )}
        <LayersPanel />
        <PoseLibrary />
      </div>
    </aside>
  );
}

function BoneInspector() {
  const scene = useStudio((s) => s.scene);
  const frame = useStudio((s) => s.frame);
  const live = useStudio((s) => s.live);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const id = selection.kind === "bone" ? selection.id : null;
  const bone = id ? scene.bones.find((b) => b.id === id) : null;
  const rotNow = id ? wrapPi((live?.rot?.[id] ?? scene.tracks[id]?.rot.find((k) => k.t === frame)?.rot) ?? 0) : 0;

  if (!bone) {
    return (
      <div className="pane">
        <h4 className="sec">Inspector</h4>
        <p className="empty">Click a bone or a body part on the canvas to edit it. Everything here is live — changes become keyframes at the current frame.</p>
      </div>
    );
  }

  return (
    <div className="pane">
      <h4 className="sec">Bone</h4>
      <input className="name-input" value={bone.name} onChange={(e) => a.updateBone(bone.id, { name: e.target.value })} />
      <div className="grid2">
        <label className="field">
          length
          <input type="number" value={Math.round(bone.length)} onChange={(e) => a.updateBone(bone.id, { length: Math.max(1, Number(e.target.value)) })} />
        </label>
        <label className="field">
          parent
          <select value={bone.parent ?? ""} onChange={(e) => a.reparentBone(bone.id, e.target.value || null)}>
            <option value="">— none (root) —</option>
            {scene.bones.filter((b) => b.id !== bone.id).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="slider">
        <span>rest {deg(bone.rest).toFixed(0)}°</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={deg(bone.rest)}
          onChange={(e) => a.updateBone(bone.id, { rest: rad(Number(e.target.value)) })}
        />
      </label>
      <label className="slider">
        <span>
          pose @ {frame} <b>{deg(rotNow).toFixed(1)}°</b>
        </span>
        <input
          type="range"
          min={-180}
          max={180}
          step={0.5}
          value={deg(rotNow)}
          onChange={(e) => a.setLive({ rot: { ...(live?.rot ?? {}), [bone.id]: rad(Number(e.target.value)) } })}
          onPointerUp={() => a.commitLive()}
          onBlur={() => a.commitLive()}
        />
      </label>
      <div className="row-btns">
        <button className="ghost" onClick={() => a.keySelectedBone()}>
          🔑 key bone
        </button>
        <button className="ghost" onClick={() => a.zeroBone(bone.id)} title="Return this bone to its rest angle and key that">
          → rest
        </button>
        <button className="ghost danger" onClick={() => a.deleteBone(bone.id)}>
          delete bone
        </button>
      </div>

      <h4 className="sec">Bend limits (relative to rest)</h4>
      <label className="slider">
        <span>
          min <b>{Math.round(deg(bone.min ?? -180))}</b>°
        </span>
        <input
          type="range"
          min={-180}
          max={0}
          step={1}
          value={Math.round(deg(bone.min ?? -180))}
          onChange={(e) => a.setLimits(bone.id, { min: rad(Number(e.target.value)), max: bone.max ?? undefined })}
        />
      </label>
      <label className="slider">
        <span>
          max <b>{Math.round(deg(bone.max ?? 180))}</b>°
        </span>
        <input
          type="range"
          min={0}
          max={180}
          step={1}
          value={Math.round(deg(bone.max ?? 180))}
          onChange={(e) => a.setLimits(bone.id, { min: bone.min ?? undefined, max: rad(Number(e.target.value)) })}
        />
      </label>
      <p className="tip">Limits stop IK from snapping elbows and knees the wrong way when you drag a handle past the joint.</p>

      <h4 className="sec">Whole character</h4>
      <div className="grid2">
        <label className="field">
          anchor x
          <input type="number" value={Math.round(scene.root.x)} onChange={(e) => a.setRigRoot({ x: Number(e.target.value) })} />
        </label>
        <label className="field">
          anchor y
          <input type="number" value={Math.round(scene.root.y)} onChange={(e) => a.setRigRoot({ y: Number(e.target.value) })} />
        </label>
      </div>
      <label className="slider">
        <span>
          facing <b>{Math.round(deg(scene.rootRot ?? 0))}°</b>
        </span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(deg(scene.rootRot ?? 0))}
          onChange={(e) => a.setRigRoot({ rot: rad(Number(e.target.value)) })}
        />
      </label>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.setRigRoot({ rot: wrapPi((scene.rootRot ?? 0) + Math.PI) })} title="Face the other way">
          ⇄ turn 180°
        </button>
        <button className="ghost" onClick={() => a.setRigRoot({ rot: 0 })}>
          upright
        </button>
        <button className="ghost" onClick={() => a.rotateRigBy(rad(-10))} title="Animated turn — writes a key on the root bone at this frame">
          ↺ turn (keyed)
        </button>
        <button className="ghost" onClick={() => a.rotateRigBy(rad(10))}>
          ↻ turn (keyed)
        </button>
      </div>
      <p className="tip">
        The anchor is where the character stands. <b>Facing</b> is a rest rotation for the whole rig;
        the keyed buttons write a rotation key on the root bone, so you can animate turns. Alt-dragging
        the hips on the canvas does the same thing.
      </p>

      <h4 className="sec">Mirror pair</h4>
      <select
        value={bone.mirror ?? ""}
        onChange={(e) => a.updateBone(bone.id, { mirror: e.target.value || null })}
      >
        <option value="">— none —</option>
        {scene.bones
          .filter((b) => b.id !== bone.id)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
      <p className="tip">With a pair set (and Mirror on in the toolbar), posing one limb poses its twin the other way.</p>
    </div>
  );
}

function ShapeInspector() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const shape = scene.shapes.find((x) => x.id === selection.id);
  if (!shape) return null;
  return (
    <div className="pane">
      <h4 className="sec">Part</h4>
      <input className="name-input" value={shape.name} onChange={(e) => a.updateShape(shape.id, { name: e.target.value })} />
      <label className="field">
        welded to
        <select value={shape.bone} onChange={(e) => a.updateShape(shape.id, { bone: e.target.value })}>
          {scene.bones.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <h4 className="sec">Colour</h4>
      <div className="role-chips">
        {ROLES.map((r) => (
          <button
            key={r}
            className={`chip-role ${shape.role === r && !shape.fill ? "on" : ""}`}
            style={{ background: scene.palette[r] }}
            title={`Use palette colour “${r}”`}
            onClick={() => a.setShapeRole(shape.id, r)}
          />
        ))}
        <label className="chip-role custom" title="Custom fill">
          <input
            type="color"
            value={shape.fill ?? scene.palette[shape.role ?? "skin"]}
            onChange={(e) => a.setShapeFill(shape.id, e.target.value)}
          />
        </label>
      </div>
      <label className="slider">
        <span>opacity {Math.round((shape.opacity ?? 1) * 100)}%</span>
        <input type="range" min={0.1} max={1} step={0.05} value={shape.opacity ?? 1} onChange={(e) => a.updateShape(shape.id, { opacity: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>outline {shape.strokeWidth ?? 3}</span>
        <input type="range" min={0} max={8} step={0.5} value={shape.strokeWidth ?? 3} onChange={(e) => a.updateShape(shape.id, { strokeWidth: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={!!shape.sharp} onChange={(e) => a.updateShape(shape.id, { sharp: e.target.checked })} />
        sharp corners (off = soft/rounded)
      </label>
      <div className="row-btns">
        <button className="ghost" onClick={() => a.reorderShape(shape.id, 1)}>
          ↑ forward
        </button>
        <button className="ghost" onClick={() => a.reorderShape(shape.id, -1)}>
          ↓ back
        </button>
        <button className="ghost" onClick={() => a.duplicateShape(shape.id)}>
          ⧉ duplicate
        </button>
        <button className="ghost danger" onClick={() => a.deleteShape(shape.id)}>
          ✕ delete
        </button>
      </div>
      {shape.kind && (
        <button
          className="ghost"
          onClick={() => a.updateShape(shape.id, { pts: buildPart(shape.kind!, Math.max(16, scene.bones.find((b) => b.id === shape.bone)?.length ?? 40)) })}
          title="Rebuild this part from its library shape at the bone's current length"
        >
          ↺ re-fit to bone
        </button>
      )}
    </div>
  );
}

function ChainInspector() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const chain = scene.chains.find((c) => c.id === selection.id);
  const idx = useMemo(() => indexScene(scene), [scene]);
  if (!chain) return null;
  const reach = chain.bones.reduce((acc, b) => acc + (idx.byId.get(b)?.length ?? 0), 0);
  return (
    <div className="pane">
      <h4 className="sec">IK chain</h4>
      <input className="name-input" value={chain.name} onChange={(e) => a.mutate((d) => { const c = d.chains.find(x => x.id === chain.id); if (c) c.name = e.target.value; }, "chain name")} />
      <div className="chain-bones">
        {chain.bones.map((b, i) => (
          <span key={b}>
            <button onClick={() => a.select("bone", b)}>{idx.byId.get(b)?.name ?? b}</button>
            {i < chain.bones.length - 1 && <em>→</em>}
          </span>
        ))}
      </div>
      <p className="tip">
        Total reach <b>{Math.round(reach)}u</b>. The ring handle sits on the last bone{chain.pole ? ", the triangle is the pole (elbow/knee)." : "."}
      </p>
      <label className="check">
        <input type="checkbox" checked={chain.show} onChange={() => a.toggleChain(chain.id)} />
        show handles on the canvas
      </label>
      <label className="check">
        <input type="checkbox" checked={chain.pole} onChange={() => a.setChainPole(chain.id, !chain.pole)} />
        pole handle
      </label>
      <label className="field">
        handle colour
        <input
          type="color"
          value={chain.color}
          onChange={(e) =>
            a.mutate((d) => {
              const c = d.chains.find((x) => x.id === chain.id);
              if (c) c.color = e.target.value;
            }, "chain colour")
          }
        />
      </label>
      <label className="field">
        mirror chain
        <select
          value={chain.mirror ?? ""}
          onChange={(e) =>
            a.mutate((d) => {
              const c = d.chains.find((x) => x.id === chain.id);
              if (c) c.mirror = e.target.value || null;
            }, "chain mirror")
          }
        >
          <option value="">— none —</option>
          {scene.chains
            .filter((c) => c.id !== chain.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <div className="row-btns">
        <button className="ghost danger" onClick={() => a.deleteChain(chain.id)}>
          delete chain
        </button>
        <button className="ghost" onClick={() => a.notify("Grab the ring on the canvas and drag — the whole chain follows", "info")}>
          how do I use it?
        </button>
      </div>
    </div>
  );
}

function LayersPanel() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const sorted = [...scene.shapes].sort((x, y) => y.z - x.z);
  return (
    <div className="pane">
      <h4 className="sec">Parts / layers</h4>
      <div className="layers">
        {sorted.map((sh) => (
          <div key={sh.id} className={`layer ${selection.kind === "shape" && selection.id === sh.id ? "sel" : ""}`}>
            <button
              className="swatch"
              style={{ background: sh.fill ?? scene.palette[sh.role ?? "skin"] }}
              onClick={() => a.select("shape", sh.id)}
              title="Select part"
            />
            <button className="bname" onClick={() => a.select("shape", sh.id)}>
              {sh.name}
              <em>{indexScene(scene).byId.get(sh.bone)?.name ?? sh.bone}</em>
            </button>
            <label className="mini-check" title="Visible">
              <input type="checkbox" checked={sh.visible} onChange={() => a.updateShape(sh.id, { visible: !sh.visible })} />
            </label>
            <button className="mini" title="Move forward" onClick={() => a.reorderShape(sh.id, 1)}>
              ▲
            </button>
            <button className="mini" title="Move back" onClick={() => a.reorderShape(sh.id, -1)}>
              ▼
            </button>
          </div>
        ))}
        {!sorted.length && <p className="empty">No parts yet — drag some from the Parts tab.</p>}
      </div>
    </div>
  );
}

function PoseLibrary() {
  const poseLib = useStudio((s) => s.poseLib);
  const a = useStudio.getState();
  const [name, setName] = useState("");
  return (
    <div className="pane">
      <h4 className="sec">Pose library</h4>
      <div className="row-btns">
        <input className="name-input" placeholder="pose name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="ghost"
          onClick={() => {
            const n = name.trim() || `pose ${poseLib.length + 1}`;
            a.savePose(n);
            setName("");
          }}
        >
          save
        </button>
      </div>
      <div className="pose-list">
        {poseLib.map((p) => (
          <div key={p.name} className="pose-row">
            <button className="bname" onClick={() => a.applyPose(p.name)} title="Key this pose at the current frame">
              {p.name}
            </button>
            <button className="mini" title="Copy the pose from the current frame instead" onClick={() => a.savePose(p.name)}>
              ↻
            </button>
            <button className="mini danger" onClick={() => a.deletePose(p.name)}>
              ✕
            </button>
          </div>
        ))}
        {!poseLib.length && (
          <p className="empty">
            Save a pose once, then stamp it onto any frame — great for contact / passing / pose-to-pose
            workflows.
          </p>
        )}
      </div>
      <h4 className="sec">Utilities</h4>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.copyPose()}>
          copy pose
        </button>
        <button className="ghost" onClick={() => a.pastePose()}>
          paste
        </button>
        <button className="ghost" onClick={() => a.clearAllKeys()}>
          clear all keys
        </button>
        <button
          className="ghost"
          onClick={() => {
            const from = 0;
            const to = clamp(useStudio.getState().scene.frames - 1, 0, 999);
            a.notify(`Keys live from frame ${from} to ${to}`, "info");
          }}
        >
          key range
        </button>
      </div>
    </div>
  );
}

function depthOf(idx: ReturnType<typeof indexScene>, id: string): number {
  let n = 0;
  let b = idx.byId.get(id);
  while (b?.parent) {
    n++;
    b = idx.byId.get(b.parent);
  }
  return n;
}

/* --------------------------------------------------------------- set panel */

/**
 * The Set tab: what the character is standing in, what lights it and who is filming it.
 * Click an item to drop it on the ground under the current view, then drag it on the canvas.
 */
function StagePanel() {
  const scene = useStudio((s) => s.scene);
  const view = useStudio((s) => s.view);
  const frame = useStudio((s) => s.frame);
  const selection = useStudio((s) => s.selection);
  const cameraViewOn = useStudio((s) => s.cameraView);
  const a = useStudio.getState();
  const [sceneryFilter, setSceneryFilter] = useState("");
  const [lightFilter, setLightFilter] = useState("");
  const objects = scene.objects ?? [];
  const lights = scene.lights ?? [];
  const cameras = scene.cameras ?? [];
  const groundY = scene.ground ?? view.cam.y + 40;
  const place: Vec = { x: Math.round(view.cam.x), y: Math.round(groundY) };

  const groups = useMemo(
    () =>
      SCENERY_GROUPS.map((g) => ({
        label: g.label,
        items: SCENERY.filter((s) => s.group === g.id).filter((s) => s.label.toLowerCase().includes(sceneryFilter.toLowerCase())),
      })).filter((g) => g.items.length),
    [sceneryFilter],
  );
  const lightKinds = LIGHTS.filter((l) => l.label.toLowerCase().includes(lightFilter.toLowerCase()));

  return (
    <div className="pane">
      <h4 className="sec">Cameras</h4>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.addCamera()} title="Snap a camera to what you are looking at right now">
          ＋ add camera (this view)
        </button>
      </div>
      {cameras.length > 0 && (
        <div className="cam-list">
          {cameras.map((c) => (
            <div key={c.id} className={`cam-row ${selection.id === c.id ? "sel" : ""}`}>
              <button
                className={`cam-dot ${scene.activeCamera === c.id ? "on" : ""}`}
                title={scene.activeCamera === c.id ? "Framing the stage — click to stop looking through it" : "Look through this camera"}
                onClick={() => a.setActiveCamera(scene.activeCamera === c.id ? null : c.id)}
              >
                🎥
              </button>
              <button className="bname" onClick={() => a.select("camera", c.id)}>
                {c.name}
                <em>
                  {c.shots.length ? `${c.shots.length} shot${c.shots.length === 1 ? "" : "s"}` : "no shots"} · {c.keys.length} keys
                </em>
              </button>
              <button className="mini" title="Key the camera at the playhead" onClick={() => a.keyCamera(c.id, frame)}>
                🔑
              </button>
              <button className="mini danger" title="Delete camera" onClick={() => a.deleteCamera(c.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.addShot()} title="New shot from the playhead; the timeline then loops inside the shot">
          ✂ new shot here
        </button>
        <button className="ghost" onClick={() => a.frameCameraOnContent()} title="Fit the camera around everything that moves in this shot">
          ⤢ frame on the action
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={cameraViewOn} onChange={() => a.toggleFlag("cameraView")} />
        look through the active camera
      </label>
      <label className="check">
        <input type="checkbox" checked={scene.showObjects !== false} onChange={(e) => a.setSceneFlag("showObjects", e.target.checked)} />
        draw scenery
      </label>
      <label className="check">
        <input type="checkbox" checked={scene.showLights !== false} onChange={(e) => a.setSceneFlag("showLights", e.target.checked)} />
        draw lights &amp; glows
      </label>
      <p className="tip">
        A camera is a shot: it frames the stage, and the timeline loops <b>inside</b> its current shot.
        Animated cameras (with keys) get a dopesheet row below — press <b>K</b> with a camera selected.
      </p>

      <h4 className="sec">Scenery — click to place</h4>
      <input className="search" placeholder="filter scenery…" value={sceneryFilter} onChange={(e) => setSceneryFilter(e.target.value)} />
      {groups.map((g) => (
        <div className="part-group" key={g.label}>
          <h4>{g.label}</h4>
          <div className="part-grid">
            {g.items.map((s) => (
              <button key={s.id} className="part-tile" title={`${s.label} — add it at ground level`} onClick={() => a.addObject(s.id as SceneryKind, place)}>
                <SceneryThumb kind={s.id as SceneryKind} scene={scene} seed={3} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.scatterObjects("pine", 7)} title="A quick forest along the ground">
          🌲 scatter pines
        </button>
        <button className="ghost" onClick={() => a.scatterObjects("bush", 9)}>
          🌿 scatter bushes
        </button>
      </div>

      {objects.length > 0 && (
        <>
          <h4 className="sec">Placed ({objects.length})</h4>
          <div className="layers">
            {[...objects]
              .sort((x, y) => y.z - x.z)
              .map((o) => (
                <div key={o.id} className={`layer ${selection.id === o.id ? "sel" : ""}`}>
                  <button className="swatch" style={{ background: o.color ?? scene.palette[o.role ?? "cloth"] }} onClick={() => a.select("object", o.id)} />
                  <button className="bname" onClick={() => a.select("object", o.id)}>
                    {o.name}
                    <em>{o.z >= 1 ? "front" : "background"}</em>
                  </button>
                  <label className="mini-check" title="Visible">
                    <input type="checkbox" checked={o.visible} onChange={() => a.updateObject(o.id, { visible: !o.visible })} />
                  </label>
                  <button className="mini" title="Bring forward" onClick={() => a.reorderObject(o.id, 1)}>
                    ▲
                  </button>
                  <button className="mini" title="Send back" onClick={() => a.reorderObject(o.id, -1)}>
                    ▼
                  </button>
                  <button className="mini danger" title="Delete" onClick={() => a.deleteObject(o.id)}>
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </>
      )}

      <h4 className="sec">Lights — click to add</h4>
      <input className="search" placeholder="filter lights…" value={lightFilter} onChange={(e) => setLightFilter(e.target.value)} />
      <div className="part-grid">
        {lightKinds.map((l) => (
          <button
            key={l.id}
            className="part-tile"
            title={`${l.label} — ${l.hint}`}
            onClick={() => a.addLight(l.id as LightKind, { x: Math.round(view.cam.x), y: Math.round(groundY - 70) })}
          >
            <span className="light-dot" style={{ background: l.color, boxShadow: `0 0 12px ${l.color}` }} />
            <span>{l.label}</span>
          </button>
        ))}
      </div>
      {lights.length > 0 && (
        <div className="cam-list">
          {lights.map((l) => (
            <div key={l.id} className={`cam-row ${selection.id === l.id ? "sel" : ""}`}>
              <button className="swatch" style={{ background: l.color }} onClick={() => a.select("light", l.id)} title="Select light" />
              <button className="bname" onClick={() => a.select("light", l.id)}>
                {l.name}
                <em>
                  {l.follow ? "follows an object" : `${Math.round(l.radius)}u reach`} · {Math.round(l.intensity * 100)}%
                </em>
              </button>
              <label className="mini-check" title="Visible">
                <input type="checkbox" checked={l.visible} onChange={() => a.updateLight(l.id, { visible: !l.visible })} />
              </label>
              <button className="mini danger" title="Delete light" onClick={() => a.deleteLight(l.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="tip">
        Lights are drawn twice: a <b>wash</b> tints the whole backdrop, then an additive <b>glow</b> is
        painted over your character — so a torch really does light the person standing next to it.
        Fires flicker; everything else stays put, which keeps exports stable.
      </p>
    </div>
  );
}

/** Tiny colour swatch that shows a scenery object's default look. */
function SceneryThumb({ kind, scene, seed }: { kind: SceneryKind; scene: Scene; seed: number }) {
  const pts = useMemo(() => {
    const probe: SceneObject = { id: `thumb-${kind}`, name: kind, kind, x: 0, y: 0, scale: 1, rot: 0, z: 2, visible: true, seed };
    return objectBox(probe, scene, 0);
  }, [kind, scene, seed]);
  const color = scene.palette[(SCENERY.find((s) => s.id === kind)?.role ?? "cloth") as RoleKey] ?? "#9aa4c0";
  const w = Math.max(1, pts.w);
  const h = Math.max(1, pts.h);
  return (
    <span className="scenery-thumb" title={kind}>
      <i style={{ background: color, height: `${clamp(6 + (h / 200) * 34, 6, 38)}px`, width: `${clamp(6 + (w / 240) * 34, 6, 36)}px`, borderRadius: h < 60 ? "50%" : "3px" }} />
    </span>
  );
}

/* ------------------------------------------------------------- inspectors */

function ObjectInspector() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const obj = (scene.objects ?? []).find((o) => o.id === selection.id);
  if (!obj) return null;
  return (
    <div className="pane">
      <h4 className="sec">Scenery — {obj.kind}</h4>
      <input className="name-input" value={obj.name} onChange={(e) => a.updateObject(obj.id, { name: e.target.value })} />
      <div className="grid2">
        <label className="field">
          x
          <input type="number" value={Math.round(obj.x)} onChange={(e) => a.updateObject(obj.id, { x: Number(e.target.value) })} />
        </label>
        <label className="field">
          y
          <input type="number" value={Math.round(obj.y)} onChange={(e) => a.updateObject(obj.id, { y: Number(e.target.value) })} />
        </label>
      </div>
      <label className="slider">
        <span>scale {obj.scale.toFixed(2)}×</span>
        <input type="range" min={0.2} max={4} step={0.05} value={obj.scale} onChange={(e) => a.updateObject(obj.id, { scale: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>rotation {Math.round(deg(obj.rot))}°</span>
        <input type="range" min={-180} max={180} step={1} value={Math.round(deg(obj.rot))} onChange={(e) => a.updateObject(obj.id, { rot: rad(Number(e.target.value)) })} />
      </label>
      <label className="slider">
        <span>depth {obj.z.toFixed(2)} ({obj.z >= 1 ? "in front" : "behind"} the character)</span>
        <input type="range" min={0} max={3} step={0.05} value={obj.z} onChange={(e) => a.updateObject(obj.id, { z: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>opacity {Math.round((obj.opacity ?? 1) * 100)}%</span>
        <input type="range" min={0.1} max={1} step={0.05} value={obj.opacity ?? 1} onChange={(e) => a.updateObject(obj.id, { opacity: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>variation {obj.seed ?? 1}</span>
        <input type="range" min={1} max={40} step={1} value={obj.seed ?? 1} onChange={(e) => a.updateObject(obj.id, { seed: Number(e.target.value) })} />
      </label>
      <h4 className="sec">Colours</h4>
      <label className="field">
        palette role
        <select value={obj.role ?? ""} onChange={(e) => a.updateObject(obj.id, { role: (e.target.value || undefined) as RoleKey | undefined })}>
          <option value="">— from the catalog —</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <div className="grid2">
        <label className="field">
          main
          <input type="color" value={obj.color ?? scene.palette[obj.role ?? "cloth"]} onChange={(e) => a.updateObject(obj.id, { color: e.target.value })} />
        </label>
        <label className="field">
          secondary
          <input type="color" value={obj.color2 ?? "#334155"} onChange={(e) => a.updateObject(obj.id, { color2: e.target.value })} />
        </label>
      </div>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.reorderObject(obj.id, "front")}>
          to front
        </button>
        <button className="ghost" onClick={() => a.reorderObject(obj.id, "back")}>
          to background
        </button>
        <button className="ghost" onClick={() => a.duplicateObject(obj.id)}>
          ⧉ duplicate
        </button>
        <button className="ghost danger" onClick={() => a.deleteObject(obj.id)}>
          ✕ delete
        </button>
      </div>
      <p className="tip">Objects below 1.0 paint behind the character, 1.0 and up in front — that is how you build depth cheaply.</p>
    </div>
  );
}

function LightInspector() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const light = (scene.lights ?? []).find((l) => l.id === selection.id);
  if (!light) return null;
  const def = LIGHTS.find((l) => l.id === light.kind);
  return (
    <div className="pane">
      <h4 className="sec">Light — {def?.label ?? light.kind}</h4>
      <input className="name-input" value={light.name} onChange={(e) => a.updateLight(light.id, { name: e.target.value })} />
      <div className="grid2">
        <label className="field">
          x
          <input type="number" value={Math.round(light.x)} onChange={(e) => a.updateLight(light.id, { x: Number(e.target.value) })} />
        </label>
        <label className="field">
          y
          <input type="number" value={Math.round(light.y)} onChange={(e) => a.updateLight(light.id, { y: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field">
        colour
        <input type="color" value={light.color} onChange={(e) => a.updateLight(light.id, { color: e.target.value })} />
      </label>
      <label className="slider">
        <span>intensity {Math.round(light.intensity * 100)}%</span>
        <input type="range" min={0} max={2} step={0.05} value={light.intensity} onChange={(e) => a.updateLight(light.id, { intensity: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>reach {Math.round(light.radius)}u</span>
        <input type="range" min={40} max={1200} step={10} value={light.radius} onChange={(e) => a.updateLight(light.id, { radius: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>flicker {Math.round((light.flicker ?? 0) * 100)}%</span>
        <input type="range" min={0} max={0.5} step={0.01} value={light.flicker ?? 0} onChange={(e) => a.updateLight(light.id, { flicker: Number(e.target.value) })} />
      </label>
      {light.kind === "spot" && (
        <>
          <label className="slider">
            <span>aim {Math.round(deg(light.angle ?? -70))}°</span>
            <input type="range" min={-180} max={180} step={1} value={Math.round(deg(light.angle ?? -Math.PI / 2))} onChange={(e) => a.updateLight(light.id, { angle: rad(Number(e.target.value)) })} />
          </label>
          <label className="slider">
            <span>beam {Math.round(deg(light.spread ?? 0.35))}°</span>
            <input type="range" min={5} max={80} step={1} value={Math.round(deg(light.spread ?? 0.35))} onChange={(e) => a.updateLight(light.id, { spread: rad(Number(e.target.value)) })} />
          </label>
        </>
      )}
      <label className="field">
        follows
        <select value={light.follow ?? ""} onChange={(e) => a.attachLightTo(light.id, e.target.value || null)}>
          <option value="">— stays where it is —</option>
          {(scene.objects ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          {scene.bones.map((b) => (
            <option key={b.id} value={b.id}>
              bone: {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={light.visible} onChange={() => a.updateLight(light.id, { visible: !light.visible })} />
        shining
      </label>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.updateLight(light.id, { x: scene.root.x, y: (scene.ground ?? scene.root.y) - 60 })}>
          centre on the stage
        </button>
        <button className="ghost danger" onClick={() => a.deleteLight(light.id)}>
          ✕ delete light
        </button>
      </div>
      <p className="tip">
        A light that follows an object rides it (use it for torches) — the offset in <b>x/y</b> is
        measured from the object's anchor.
      </p>
    </div>
  );
}

function CameraInspector() {
  const scene = useStudio((s) => s.scene);
  const frame = useStudio((s) => s.frame);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const cam = (scene.cameras ?? []).find((c) => c.id === selection.id);
  if (!cam) return null;
  const tl = timelineAt(scene, frame, cam.id);
  const sample = sampleCamera(cam, frame, tl);
  const active = scene.activeCamera === cam.id;
  const idx = cam.shots.findIndex((s) => frame >= s.start && frame <= s.end);
  return (
    <div className="pane">
      <h4 className="sec">Camera</h4>
      <input className="name-input" value={cam.name} onChange={(e) => a.updateCamera(cam.id, { name: e.target.value })} />
      <div className="row-btns">
        <button className={`ghost ${active ? "on" : ""}`} onClick={() => a.setActiveCamera(active ? null : cam.id)}>
          {active ? "● framing the stage" : "look through this"}
        </button>
      </div>
      <div className="grid2">
        <label className="field">
          x
          <input type="number" value={Math.round(sample.x)} onChange={(e) => a.updateCamera(cam.id, { x: Number(e.target.value) })} />
        </label>
        <label className="field">
          y
          <input type="number" value={Math.round(sample.y)} onChange={(e) => a.updateCamera(cam.id, { y: Number(e.target.value) })} />
        </label>
      </div>
      <label className="slider">
        <span>zoom {sample.zoom.toFixed(2)}× @720px</span>
        <input
          type="range"
          min={0.2}
          max={6}
          step={0.02}
          value={sample.zoom}
          onChange={(e) => {
            const zoom = Number(e.target.value);
            if (cam.keys.length) {
              const keys = cam.keys.map((k) => (k.t === frame ? { ...k, zoom } : k));
              const hit = keys.some((k) => k.t === frame);
              a.updateCamera(cam.id, hit ? { zoom, keys } : { zoom });
              if (!hit) a.keyCamera(cam.id, frame);
            } else {
              a.updateCamera(cam.id, { zoom });
            }
          }}
        />
      </label>
      <p className="tip">Zoom is measured at a 720px-tall view, so the framing survives export size changes.</p>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.keyCamera(cam.id, frame)}>
          🔑 key camera here
        </button>
        <button className="ghost" onClick={() => a.frameCameraOnContent(cam.id)}>
          ⤢ frame the action
        </button>
        <button className="ghost" onClick={() => a.clearCameraKeys(cam.id)} disabled={!cam.keys.length}>
          clear moves
        </button>
      </div>

      <h4 className="sec">Shots ({cam.shots.length})</h4>
      <div className="shot-list">
        {cam.shots.map((sh, i) => (
          <div key={i} className={`shot-item ${i === idx ? "on" : ""}`}>
            <span className="shot-name">#{i + 1}</span>
            <input
              type="number"
              className="tiny-num"
              value={sh.start}
              min={0}
              max={scene.frames - 1}
              onChange={(e) => a.updateShot(cam.id, i, { start: Number(e.target.value) })}
              title="First frame"
            />
            <input
              type="number"
              className="tiny-num"
              value={sh.end}
              min={0}
              max={scene.frames - 1}
              onChange={(e) => a.updateShot(cam.id, i, { end: Number(e.target.value) })}
              title="Last frame"
            />
            <button className="mini" title="Cut to this shot" onClick={() => { a.setActiveCamera(cam.id); a.setFrame(sh.start); }}>
              ⏱
            </button>
            <button className="mini danger" title="Delete shot" onClick={() => a.deleteShot(cam.id, i)}>
              ✕
            </button>
          </div>
        ))}
        {!cam.shots.length && <p className="empty">No shots yet — the camera still frames the stage, but the timeline loops the whole scene.</p>}
      </div>
      <div className="row-btns wrap">
        <button className="ghost" onClick={() => a.addShot(cam.id, frame)}>
          ✂ add shot from frame {frame}
        </button>
      </div>

      <h4 className="sec">Camera moves ({cam.keys.length} keys)</h4>
      <div className="pose-list">
        {cam.keys.map((k) => (
          <div key={k.t} className="pose-row">
            <button className="bname" onClick={() => a.setFrame(k.t)}>
              frame {k.t} · {k.zoom.toFixed(2)}×
            </button>
            <select value={k.ease} onChange={(e) => a.easeCameraKeys(cam.id, [k.t], e.target.value as Ease)} title="Easing into the next key">
              {EASES.map((ez) => (
                <option key={ez.id} value={ez.id}>
                  {ez.label}
                </option>
              ))}
            </select>
            <button className="mini danger" onClick={() => a.deleteCameraKey(cam.id, k.t)}>
              ✕
            </button>
          </div>
        ))}
        {!cam.keys.length && <p className="empty">Locked off. Move to another frame, nudge the camera and press “key camera here” to start a move.</p>}
      </div>
      <div className="row-btns wrap">
        <button className="ghost danger" onClick={() => a.deleteCamera(cam.id)}>
          ✕ delete camera
        </button>
      </div>
      <p className="tip">
        Keyed cameras push, truck and crane: each key stores position + zoom, and the ease column is the
        blend into the next key. Exports through a camera keep the framing stable across the whole shot.
      </p>
    </div>
  );
}
