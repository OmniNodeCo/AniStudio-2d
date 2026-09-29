/**
 * The four new dock panels that turn the studio into a character *builder*:
 *
 *   Build      — pick a body plan, switch slots (body/head/eyes/arms/legs …) on or off, and say
 *                where each slot's art comes from: the starter rig, a premade part, a sketch or an
 *                imported drawing.
 *   Import     — drop PNG/JPG/SVG files in and weld them onto bones, or make one the background.
 *   Backdrop   — ready-made skies (with optional scenery recipes) and imported background images.
 *   Style      — palettes, outline and the finishing touches.
 */
import { useMemo, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { PALETTES, ROLES, type RoleKey } from "../core/types";
import {
  SLOTS,
  blueprintRows,
  blueprintIssues,
  partsForSlot,
  sceneCoverage,
  slotDef,
  templateSlots,
  type ArtSource,
  type SlotId,
} from "../core/slots";
import { allBackdrops } from "../state/store";
import { IMAGE_ACCEPT, readImageFile, type ImportedArt } from "../io/import";
import { RIG_MAP, RIGS } from "../presets/rigs";
import { DEMOS, DEMO_LABELS } from "../presets/demos";
import type { RigDef } from "../core/rig-build";

/* --------------------------------------------------------------- helpers */

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Read dropped/selected files, then hand each one to `apply`. */
async function takeImages(
  files: FileList | File[] | null,
  apply: (art: ImportedArt) => void,
  onError: (message: string) => void,
) {
  const list = files ? Array.from(files) : [];
  let done = 0;
  for (const file of list) {
    try {
      const art = await readImageFile(file);
      apply(art);
      done++;
    } catch (err) {
      onError(`${file.name}: ${(err as Error).message}`);
    }
  }
  return done;
}

function useFileInput(onFiles: (files: FileList | null) => void) {
  const ref = useRef<HTMLInputElement | null>(null);
  const open = () => ref.current?.click();
  const input = (
    <input
      ref={ref}
      type="file"
      accept={IMAGE_ACCEPT}
      multiple
      style={{ display: "none" }}
      onChange={(e) => {
        onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
  return { open, input };
}

/* ----------------------------------------------------------------- Build */

const ART_LABELS: { id: ArtSource; label: string }[] = [
  { id: "template", label: "starter art" },
  { id: "part", label: "premade part" },
  { id: "draw", label: "I'll sketch it" },
  { id: "import", label: "I'll import it" },
  { id: "none", label: "no art" },
];

export function BuildPanel() {
  const scene = useStudio((s) => s.scene);
  const blueprint = useStudio((s) => s.blueprint);
  const slotArm = useStudio((s) => s.slotArm);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const def = (RIG_MAP.get(blueprint.base) ?? RIGS[0]) as RigDef;
  const rows = useMemo(() => blueprintRows(def, blueprint), [def, blueprint]);
  const issues = useMemo(() => blueprintIssues(def, blueprint), [def, blueprint]);
  const coverage = useMemo(() => sceneCoverage(scene), [scene]);
  const onCount = rows.filter((r) => r.on).length;
  const selectedShape = selection.kind === "shape" ? scene.shapes.find((s) => s.id === selection.id) : undefined;
  const [fileFor, setFileFor] = useState<SlotId | null>(null);
  const importer = useFileInput(async (files) => {
    const slot = fileFor;
    await takeImages(
      files,
      (art) => a.importArt(art, { slot }),
      (msg) => a.notify(msg, "warn"),
    );
    setFileFor(null);
  });

  return (
    <div className="pane">
      {importer.input}
      <p className="pane-lead">
        Every piece of a character is a <b>slot</b>. A character needs a <b>body</b> — head, eyes,
        arms, legs and the rest are optional, so a slime with no limbs and a ghost with no legs are
        both one click away.
      </p>

      <h4 className="sec">1 · Body plan</h4>
      <div className="plan-grid">
        {RIGS.filter((r) => r.id !== "blank").map((r) => (
          <button
            key={r.id}
            className={`plan-card ${blueprint.base === r.id ? "on" : ""}`}
            onClick={() => a.setBlueprintBase(r.id)}
            title={r.hint}
          >
            <b>{r.label}</b>
            <span>{templateSlots(r as unknown as RigDef).length} slots · {r.hint}</span>
          </button>
        ))}
      </div>

      <h4 className="sec">
        2 · Slots <span className="sec-note">{onCount} on · starting from {def.label}</span>
      </h4>
      <div className="slot-list">
        {rows.map((row) => {
          const live = coverage.find((c) => c.id === row.id);
          const hasLive = !!live?.present;
          return (
            <div key={row.id} className={`slot-row ${row.on ? "" : "off"} ${row.def.required ? "req" : ""}`}>
              <label className="slot-head">
                <input
                  type="checkbox"
                  checked={row.on}
                  disabled={row.def.required}
                  onChange={(e) => a.setBlueprintSlot(row.id, { on: e.target.checked })}
                />
                <b>{row.def.label}</b>
                {row.def.required && <span className="badge req">required</span>}
                {!row.available && <span className="badge new">new bone{row.def.required ? "" : "s"}</span>}
                {hasLive && <span className="badge live" title="this character already has it">on stage</span>}
              </label>
              <span className="slot-hint">{row.def.hint}</span>
              {row.on && (
                <div className="slot-art">
                  <select
                    value={row.art}
                    title="Where this slot's art comes from"
                    onChange={(e) => a.setBlueprintSlot(row.id, { art: e.target.value as ArtSource })}
                  >
                    {ART_LABELS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {row.art === "part" && (
                    <select
                      value={row.part ?? row.def.preferred}
                      title="Which premade part to weld on"
                      onChange={(e) => a.setBlueprintSlot(row.id, { part: e.target.value })}
                    >
                      {partsForSlot(row.id).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {hasLive && !row.def.required && (
                    <button className="mini" onClick={() => a.slotRemove(row.id)} title="Take it off the character on stage">
                      −
                    </button>
                  )}
                  {!hasLive && (
                    <button className="mini" onClick={() => a.slotAdd(row.id)} title="Add this slot to the character on stage, with its own bones and IK">
                      ＋ now
                    </button>
                  )}
                  {hasLive && row.art === "part" && (
                    <button className="mini" onClick={() => a.slotSetArt(row.id, "part", row.part)} title="Swap the art on stage for this premade part">
                      use
                    </button>
                  )}
                </div>
              )}
              {row.on && row.available && (row.art === "draw" || row.art === "import") && (
                <div className="slot-actions">
                  {row.art === "draw" ? (
                    <button
                      className={`ghost ${slotArm === row.id ? "on" : ""}`}
                      onClick={() => a.setMode("draw")}
                      title="Sketch mode draws onto the first bone of this slot"
                    >
                      ✎ sketch this slot
                    </button>
                  ) : (
                    <button
                      className="ghost"
                      onClick={() => {
                        setFileFor(row.id);
                        setTimeout(() => importer.open(), 0);
                      }}
                      title="Pick a PNG/JPG/SVG and weld it to this slot's bone"
                    >
                      ⭳ import for this slot
                    </button>
                  )}
                  <button className="ghost" onClick={() => a.armSlot(row.id)} title="Arm this slot: the next drawing or import goes here">
                    {slotArm === row.id ? "armed ✓" : "arm slot"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.map((issue, i) => (
            <li key={i} className={issue.level}>
              <b>{slotDef(issue.slot).label}</b> {issue.text}
            </li>
          ))}
        </ul>
      )}

      <div className="pane-foot sticky">
        <button className="primary wide" onClick={() => a.buildCharacter()}>
          ⚒ build the character
        </button>
        <button className="ghost wide" onClick={() => a.resetBlueprint()}>
          ⟲ reset the body plan
        </button>
      </div>

      <h4 className="sec">3 · Give it something to do</h4>
      <div className="demo-grid">
        {Object.keys(DEMOS).map((d) => (
          <button key={d} className="ghost" onClick={() => a.applyDemoNow(d)} title={`Bake the “${d}” animation onto this rig`}>
            {DEMO_LABELS[d] ?? d}
          </button>
        ))}
      </div>
      <p className="tip">
        Demos write real keyframes — feet get planted, tails get follow-through. Missing slots are
        simply skipped, so a legless character still gets the arm swing and the body bob.
      </p>

      <h4 className="sec">
        4 · This character <span className="sec-note">{coverage.filter((c) => c.present).length} of {SLOTS.length} slots</span>
      </h4>
      <div className="chip-row">
        {coverage.map((c) => (
          <button
            key={c.id}
            className={`chip ${c.present ? (c.drawn ? "on" : "bare") : "off"}`}
            title={`${c.bones.length} bone(s), ${c.shapes.length} piece(s) of art — click to ${c.present ? "highlight" : "add"}`}
            onClick={() => {
              if (!c.present) a.slotAdd(c.id);
              else if (c.bones[0]) {
                a.select("bone", c.bones[0]);
                a.setMode("pose");
              }
            }}
          >
            {c.def.label}
            <em>{c.present ? (c.drawn ? c.shapes.length : "no art") : "–"}</em>
          </button>
        ))}
      </div>

      {selectedShape && (
        <div className="sel-part">
          <h4 className="sec">
            Selected part · {selectedShape.image ? "imported drawing" : selectedShape.kind ?? "custom"}
          </h4>
          <label className="field wide">
            what is this?
            <select value={selectedShape.slot ?? "body"} onChange={(e) => a.setShapeSlot(selectedShape.id, e.target.value as SlotId)}>
              {SLOTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button
              className="ghost"
              title="Keep it where it is on screen, but parent it to that slot's bone"
              onClick={() => a.weldToSlot(selectedShape.id, selectedShape.slot ?? "body")}
            >
              🔗 weld to {(selectedShape.slot && slotDef(selectedShape.slot).label) || "body"}
            </button>
            {selectedShape.image && (
              <button className="ghost" onClick={() => a.fitImageToBone(selectedShape.id)} title="Re-scale the drawing to its bone">
                ⤢ fit to bone
              </button>
            )}
          </div>
          {selectedShape.image && (
            <p className="tip">
              {selectedShape.image.name ?? "imported"} · {selectedShape.image.w}×{selectedShape.image.h}px — pose it like any
              other part: drag to move, Alt-drag to rotate, Shift-drag to scale.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Import */

export function ImportPanel() {
  const scene = useStudio((s) => s.scene);
  const slotArm = useStudio((s) => s.slotArm);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const [target, setTarget] = useState<SlotId | "auto">("auto");
  const [dragOver, setDragOver] = useState(false);
  const shapes = scene.shapes.filter((s) => s.image);
  const file = useFileInput(async (files) => {
    const slot = target === "auto" ? null : target;
    const n = await takeImages(
      files,
      (art) => a.importArt(art, { slot: slot ?? undefined }),
      (msg) => a.notify(msg, "warn"),
    );
    if (n) a.notify(`${n} drawing${n === 1 ? "" : "s"} welded to the rig`, "ok");
  });
  const bgFile = useFileInput(async (files) => {
    await takeImages(files, (art) => a.importBackdrop(art), (msg) => a.notify(msg, "warn"));
  });

  return (
    <div className="pane">
      {file.input}
      {bgFile.input}
      <p className="pane-lead">
        Draw in any app, export a PNG (or drop in a screenshot), and it becomes part of the
        character: imports are welded to a bone and pose exactly like the built-in parts.
      </p>
      <div className="grid2">
        <label className="field">
          weld to
          <select value={slotArm ?? target} onChange={(e) => {
            const v = e.target.value as SlotId | "auto";
            setTarget(v);
            a.armSlot(v === "auto" ? null : v);
          }}>
            <option value="auto">auto (from the filename)</option>
            {SLOTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          or background
          <button className="ghost" onClick={() => bgFile.open()}>
            import a backdrop
          </button>
        </label>
      </div>

      <div
        className={`drop-zone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          const files = e.dataTransfer.files;
          const slot = target === "auto" ? (slotArm ?? undefined) : target;
          await takeImages(files, (art) => a.importArt(art, { slot }), (msg) => a.notify(msg, "warn"));
        }}
      >
        <b>drop PNG · JPG · SVG here</b>
        <span>…or paste a screenshot with {navigator.platform.includes("Mac") ? "⌘V" : "Ctrl+V"}</span>
        <button className="primary" onClick={() => file.open()}>
          choose files
        </button>
        <em>
          {slotArm ? `next import fills the ${slotDef(slotArm).label} slot` : target === "auto" ? "slot guessed from the filename" : `weld to ${slotDef(target as SlotId).label}`}
        </em>
      </div>

      <h4 className="sec">
        Imported art <span className="sec-note">{shapes.length} piece{shapes.length === 1 ? "" : "s"}</span>
      </h4>
      {!shapes.length && <p className="empty">Nothing imported yet — dropped drawings show up here with a handle on every knob.</p>}
      <div className="import-list">
        {shapes.map((s) => {
          const bone = scene.bones.find((b) => b.id === s.bone);
          const size = imageQuadSize(s.pts);
          return (
            <div key={s.id} className={`import-row ${selection.id === s.id ? "on" : ""}`}>
              <button className="thumb" onClick={() => { a.select("shape", s.id); a.setMode("art"); }} title="Select it on the canvas">
                <img src={s.image!.src} alt="" />
              </button>
              <div className="import-meta">
                <b>{s.image!.name ?? s.name}</b>
                <span>
                  {s.image!.w}×{s.image!.h}px · {Math.round(size.w)}×{Math.round(size.h)} units on {bone?.name ?? s.bone}
                </span>
                <div className="row">
                  <select value={s.slot ?? "body"} onChange={(e) => a.setShapeSlot(s.id, e.target.value as SlotId)} title="Which slot is this?">
                    {SLOTS.map((sl) => (
                      <option key={sl.id} value={sl.id}>
                        {sl.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={s.bone}
                    onChange={(e) => {
                      const live = scene.bones.find((b) => b.id === e.target.value);
                      if (!live) return;
                      a.fitImageToBone(s.id);
                      a.weldToSlot(s.id, s.slot ?? "body");
                      void live;
                    }}
                    title="Parent bone (weld keeps the drawing where it is)"
                  >
                    {scene.bones.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="import-buttons">
                <button className="mini" onClick={() => a.fitImageToBone(s.id, { cover: 1.05 })} title="Scale to the bone, centred">
                  ⤢
                </button>
                <button className="mini" onClick={() => a.fitImageToBone(s.id, { cover: 1, anchor: "start" })} title="Anchor the drawing to the start of the bone">
                  ⇤
                </button>
                <button className="mini" onClick={() => a.fitImageToBone(s.id, { cover: 1, anchor: "end" })} title="Anchor the drawing to the end of the bone">
                  ⇥
                </button>
                <button className="mini" onClick={() => a.reorderShape(s.id, "front")} title="Bring to front">
                  ⤒
                </button>
                <button className="mini danger" onClick={() => a.deleteShape(s.id)} title="Delete this drawing">
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="tip">
        Filenames do the labelling: <code>nibbles-legs.png</code> lands on the legs,{" "}
        <code>hero-head.svg</code> on the head. Anything else drops on the bone you have selected —
        or the one nearest the middle of the view.
      </p>
    </div>
  );
}

const imageQuadSize = (pts: { x: number; y: number }[]) => ({
  w: Math.hypot((pts[1]?.x ?? 0) - (pts[0]?.x ?? 0), (pts[1]?.y ?? 0) - (pts[0]?.y ?? 0)),
  h: Math.hypot((pts[3]?.x ?? 0) - (pts[0]?.x ?? 0), (pts[3]?.y ?? 0) - (pts[0]?.y ?? 0)),
});

/* -------------------------------------------------------------- Backdrop */

function SkySwatch({ colors, image }: { colors: [string, string]; image?: string }) {
  return (
    <span className="sky-swatch" style={{ background: image ? `url(${image}) center/cover` : `linear-gradient(${colors[0]}, ${colors[1]})` }} />
  );
}

export function BackgroundPanel() {
  const scene = useStudio((s) => s.scene);
  const userBackdrops = useStudio((s) => s.userBackdrops);
  const a = useStudio.getState();
  const [name, setName] = useState("");
  const presets = allBackdrops(userBackdrops);
  const bg = scene.bgImage;
  const bgFile = useFileInput(async (files) => {
    await takeImages(files, (art) => a.importBackdrop(art), (msg) => a.notify(msg, "warn"));
  });

  return (
    <div className="pane">
      {bgFile.input}
      <p className="pane-lead">
        Skies you can click. Each one can bring its own scenery and lighting — the ground line,
        colours and light tint come with it, and the character stays put.
      </p>
      <div className="bd-grid">
        {presets.map((p) => {
          const mine = userBackdrops.some((u) => u.id === p.id);
          const props = (p.objects?.length ?? 0) + (p.lights?.length ?? 0);
          return (
            <div key={p.id} className={`bd-card ${scene.backdrop === p.id ? "on" : ""}`}>
              <button className="bd-go" onClick={() => a.setBackdrop(p.id, true)} title={`${p.hint} — sky, scenery and lights`}>
                <SkySwatch colors={p.swatch} />
                <b>{p.label}</b>
                <span>{p.hint}</span>
              </button>
              <div className="bd-actions">
                <button className="mini" onClick={() => a.setBackdrop(p.id, false)} title="Take only the sky and ground — keep your own set">
                  sky only
                </button>
                {props > 0 && (
                  <button className="mini" onClick={() => a.addBackdropProps(p.id)} title="Add this backdrop's scenery and lights on top of what you have">
                    + {props} props
                  </button>
                )}
                {mine && (
                  <button className="mini danger" onClick={() => a.deleteBackdrop(p.id)} title="Forget this saved backdrop">
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="sec">Save what you built</h4>
      <div className="row">
        <input className="search" placeholder="name this backdrop…" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="ghost"
          onClick={() => {
            a.saveBackdrop(name.trim() || `${scene.name} backdrop`);
            setName("");
          }}
          title="Stores the sky, ground, scenery and lights of this scene as a reusable preset"
        >
          💾 save
        </button>
      </div>

      <h4 className="sec">Your own background image</h4>
      {!bg ? (
        <button className="ghost wide" onClick={() => bgFile.open()}>
          ⭳ import a background image (PNG · JPG · SVG)
        </button>
      ) : (
        <div className="bg-image">
          <SkySwatch colors={[scene.bgTop, scene.bgBottom]} image={bg.src} />
          <div className="grid2">
            <label className="field">
              fit
              <select value={bg.fit} onChange={(e) => a.updateBgImage({ fit: e.target.value as "cover" | "contain" | "stretch" })}>
                <option value="cover">cover (fill, crop)</option>
                <option value="contain">contain (letterbox)</option>
                <option value="stretch">stretch (to frame)</option>
              </select>
            </label>
            <label className="field">
              opacity {pct(bg.opacity ?? 1)}
              <input type="range" min={0} max={1} step={0.05} value={bg.opacity ?? 1} onChange={(e) => a.updateBgImage({ opacity: Number(e.target.value) })} />
            </label>
            <label className="field">
              haze {pct(bg.dim ?? 0)}
              <input type="range" min={0} max={1} step={0.05} value={bg.dim ?? 0} onChange={(e) => a.updateBgImage({ dim: Number(e.target.value) })} />
            </label>
            <label className="field">
              haze colour
              <input type="color" value={bg.dimColor ?? scene.bgTop} onChange={(e) => a.updateBgImage({ dimColor: e.target.value })} />
            </label>
            <label className="field">
              parallax {pct(bg.parallax ?? 0)}
              <input type="range" min={0} max={1} step={0.05} value={bg.parallax ?? 0} onChange={(e) => a.updateBgImage({ parallax: Number(e.target.value) })} />
            </label>
            <label className="field">
              nudge {pct(bg.offsetY ?? 0)}
              <input type="range" min={-0.5} max={0.5} step={0.01} value={bg.offsetY ?? 0} onChange={(e) => a.updateBgImage({ offsetY: Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={!!bg.flip} onChange={(e) => a.updateBgImage({ flip: e.target.checked })} />
              mirror
            </label>
            <button className="ghost" onClick={() => bgFile.open()}>
              replace
            </button>
            <button className="ghost danger" onClick={() => a.clearBgImage()}>
              remove
            </button>
          </div>
          <p className="tip">
            {bg.w}×{bg.h}px · “fit” keeps the maths identical at every export size, so what you frame
            here is what a 4K render gets. Parallax slides the plate against the camera — 0 is a
            painted backdrop, 1 is fully locked to the world.
          </p>
        </div>
      )}

      <h4 className="sec">Sky &amp; ground</h4>
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
          ground line
          <input type="number" value={scene.ground ?? 0} onChange={(e) => a.setGround(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={scene.ground != null} onChange={(e) => a.setGround(e.target.checked ? 80 : null)} />
          draw ground &amp; shadow
        </label>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Style */

export function StyleWorkshop() {
  const scene = useStudio((s) => s.scene);
  const a = useStudio.getState();
  const [custom, setCustom] = useState<Record<string, Record<RoleKey, string>>>({});
  const palettes: Record<string, Record<RoleKey, string>> = { ...PALETTES, ...custom };

  return (
    <div className="pane">
      <p className="pane-lead">
        One palette drives every part that uses a role colour, so recolouring a whole character —
        or a whole set — is a single click.
      </p>
      <h4 className="sec">Character palettes</h4>
      <div className="pal-grid">
        {Object.entries(palettes).map(([id, colors]) => (
          <button key={id} className={`pal-card ${scene.palette.skin === colors.skin && scene.palette.cloth === colors.cloth ? "on" : ""}`} onClick={() => a.setPalette(id)} title={`Recolour to the ${id} palette`}>
            <span className="pal-dots">
              {(["skin", "cloth", "cloth2", "accent", "hair"] as RoleKey[]).map((r) => (
                <i key={r} style={{ background: colors[r] }} />
              ))}
            </span>
            <b>{id}</b>
          </button>
        ))}
      </div>

      <h4 className="sec">Roles</h4>
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
      <div className="grid2">
        <label className="field">
          outline
          <input type="color" value={scene.outline} onChange={(e) => a.setOutline(e.target.value)} />
        </label>
        <button
          className="ghost"
          title="Store these colours as your own palette"
          onClick={() => setCustom((c) => ({ ...c, [`my ${Object.keys(c).length + 1}`]: { ...scene.palette } }))}
        >
          ＋ save this palette
        </button>
      </div>

      <h4 className="sec">Scene mood</h4>
      <div className="row">
        <button className="ghost" onClick={() => a.addExampleScenery()}>
          🏞 example scenery
        </button>
        <button className="ghost" onClick={() => a.addExampleCameras()}>
          🎥 example cameras
        </button>
        <button className="ghost" onClick={() => a.fitAll()}>
          ⤢ fit the whole set
        </button>
      </div>
      <p className="tip">
        Parts read roles, not colours: recolour <b>skin</b> and every hand, head and leg follows.
        Imported drawings keep their own pixels — drop them on a bone and they move with it.
      </p>
    </div>
  );
}
