import { useRef, useState } from "react";
import { useStudio } from "../state/store";
import type { Mode } from "../state/store";
import { parseProject } from "../io/export";
import { ExportPanel } from "./ExportPanel";

const MODES: { id: Mode; label: string; icon: string; key: string; blurb: string }[] = [
  { id: "pose", label: "Pose", icon: "✋", key: "1", blurb: "Drag handles & joints" },
  { id: "rig", label: "Rig", icon: "🦴", key: "2", blurb: "Grow bones, build IK chains" },
  { id: "art", label: "Art", icon: "🎨", key: "3", blurb: "Move, recolour, re-layer parts" },
  { id: "draw", label: "Draw", icon: "✎", key: "4", blurb: "Trace your own shapes" },
  { id: "camera", label: "Set", icon: "🎥", key: "5", blurb: "Place cameras, lights and scenery" },
];

export function Topbar() {
  const scene = useStudio((s) => s.scene);
  const mode = useStudio((s) => s.mode);
  const showBones = useStudio((s) => s.showBones);
  const showHandles = useStudio((s) => s.showHandles);
  const showNames = useStudio((s) => s.showNames);
  const showGrid = useStudio((s) => s.showGrid);
  const showShadow = useStudio((s) => s.showShadow);
  const showOnion = useStudio((s) => s.showOnion);
  const mirrorX = useStudio((s) => s.mirrorX);
  const cameraViewOn = useStudio((s) => s.cameraView);
  const cameras = useStudio((s) => s.scene.cameras);
  const activeCamera = useStudio((s) => s.scene.activeCamera);
  const showObjects = useStudio((s) => s.scene.showObjects !== false);
  const showLights = useStudio((s) => s.scene.showLights !== false);
  const past = useStudio((s) => s.past.length);
  const future = useStudio((s) => s.future.length);
  const a = useStudio.getState();
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadFile = async (f: File | undefined | null) => {
    if (!f) return;
    try {
      const text = await f.text();
      const { scene: sc, poseLib } = parseProject(text);
      a.loadScene(sc, `load ${f.name}`, true);
      if (Array.isArray(poseLib)) useStudio.setState({ poseLib: poseLib as never });
      a.notify(`Loaded ${f.name}`, "ok");
    } catch (err) {
      a.notify(`Could not read that file: ${(err as Error).message}`, "warn");
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <circle cx="16" cy="7.5" r="4" fill="#7cf0c8" />
          <path d="M16 11.5 8.5 27M16 11.5 23.5 27M11 20h10" stroke="#ffb347" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </svg>
        <div>
          <b>AniStudio 2D</b>
          <span>drag · pose · IK · animate</span>
        </div>
      </div>

      <nav className="modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode ${mode === m.id ? "on" : ""}`}
            onClick={() => a.setMode(m.id)}
            title={`${m.blurb} — press ${m.key}`}
          >
            <span className="mi">{m.icon}</span>
            <span className="ml">{m.label}</span>
            <kbd>{m.key}</kbd>
          </button>
        ))}
      </nav>

      <div className="tb-group">
        <input
          className="scene-name"
          value={scene.name}
          onChange={(e) => a.renameScene(e.target.value)}
          title="Scene name (used for export file names)"
        />
      </div>

      <div className="tb-group toggles">
        <button className={`tg ${showBones ? "on" : ""}`} onClick={() => a.toggleFlag("showBones")} title="Show skeleton (B)">
          bones
        </button>
        <button className={`tg ${showHandles ? "on" : ""}`} onClick={() => a.toggleFlag("showHandles")} title="Show IK handles (H)">
          ik handles
        </button>
        <button className={`tg ${showNames ? "on" : ""}`} onClick={() => a.toggleFlag("showNames")} title="Show bone labels (N)">
          names
        </button>
        <button className={`tg ${showGrid ? "on" : ""}`} onClick={() => a.toggleFlag("showGrid")} title="Show grid (G)">
          grid
        </button>
        <button className={`tg ${showShadow ? "on" : ""}`} onClick={() => a.toggleFlag("showShadow")} title="Contact shadow">
          shadow
        </button>
        <button className={`tg ${mirrorX ? "on" : ""}`} onClick={() => a.toggleFlag("mirrorX")} title="Mirror posing across the rig centre (M)">
          ⇋ mirror
        </button>
        <label className="tg sel" title="Which camera frames the stage">
          🎥
          <select
            value={activeCamera ?? ""}
            onChange={(e) => a.setActiveCamera(e.target.value || null)}
            title="Look through a camera, or build with the free view"
          >
            <option value="">free view</option>
            {(cameras ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className={`tg ${cameraViewOn ? "on" : ""}`} onClick={() => a.toggleFlag("cameraView")} title="Look through the active camera (off = free view, camera still exports)">
          cam view
        </button>
        <button className={`tg ${showObjects ? "on" : ""}`} onClick={() => a.setSceneFlag("showObjects", !showObjects)} title="Show scenery">
          set
        </button>
        <button className={`tg ${showLights ? "on" : ""}`} onClick={() => a.setSceneFlag("showLights", !showLights)} title="Show light wash & glows">
          lights
        </button>
        <label className="tg sel" title="Onion skin frames">
          onion
          <select value={showOnion} onChange={(e) => a.setShowOnion(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tb-group">
        <button className="ib" disabled={!past} onClick={() => a.undo()} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="ib" disabled={!future} onClick={() => a.redo()} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button className="ib" onClick={() => fileRef.current?.click()} title="Load an .anistudio.json project">
          ⤓ load
        </button>
        <button
          className="ib"
          onClick={() => {
            const blob = new Blob(
              [JSON.stringify({ app: "AniStudio2D", version: 1, scene, poseLib: useStudio.getState().poseLib }, null, 2)],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${(scene.name || "scene").replace(/[^\w-]+/g, "-").toLowerCase()}.anistudio.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            a.notify("Project downloaded", "ok");
          }}
          title="Save the whole scene (rig, art, keys) as json"
        >
          ⤒ save
        </button>
        <button className="ib primary" onClick={() => setExporting(true)} title="Export GIF / PNG / sprite sheet / video">
          ⤒ export
        </button>
        <button className="ib" onClick={() => a.toggleFlag("showHelp")} title="How this works (?)">
          ?
        </button>
        <button className="ib" onClick={() => a.addCamera()} title="Add a camera framing what you see now (Set mode)">
          🎥+
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            void loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {exporting && (
        <div className="modal-bg" onClick={() => setExporting(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Export</h3>
              <button className="mini" onClick={() => setExporting(false)}>
                ✕
              </button>
            </div>
            <ExportPanel compact />
          </div>
        </div>
      )}
    </header>
  );
}
