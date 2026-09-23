import { useMemo, useState } from "react";
import { useStudio } from "../state/store";
import { PARTS, PART_GROUPS, buildPart } from "../core/parts";
import { clamp, deg, rad, wrapPi } from "../core/math";
import { indexScene } from "../core/rig";
import { RIGS } from "../presets/rigs";
import { DEMOS, DEMO_LABELS } from "../presets/demos";
import { ROLES, type RoleKey } from "../core/types";
import { ExportPanel } from "./ExportPanel";

/* ------------------------------------------------------------- left dock */

export function LeftDock() {
  const [tab, setTab] = useState<"parts" | "rig" | "scene">("parts");
  return (
    <aside className="dock left">
      <nav className="tabs">
        {(["parts", "rig", "scene"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "parts" ? "Parts" : t === "rig" ? "Rig & IK" : "Scene"}
          </button>
        ))}
      </nav>
      <div className="dock-body">
        {tab === "parts" && <PartsLibrary />}
        {tab === "rig" && <RigPanel />}
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
        {selection.kind === "shape" ? <ShapeInspector /> : selection.kind === "chain" ? <ChainInspector /> : <BoneInspector />}
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
