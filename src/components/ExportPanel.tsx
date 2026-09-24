import { useMemo, useState } from "react";
import { useStudio } from "../state/store";
import JSZip from "jszip";
import { clamp } from "../core/math";
import { download, exportGif, exportPng, exportPngZip, exportSpriteSheet, exportWebm, projectBlob, type ExportOpts } from "../io/export";
import { canvasBlob, type Framing } from "../core/shots";
import { timelineAt } from "../core/timeline";

type Kind = "gif" | "png-seq" | "sheet" | "webm" | "still" | "project";

const LABELS: Record<Kind, string> = {
  gif: "Animated GIF",
  "png-seq": "PNG frames (.zip)",
  sheet: "Sprite sheet (png + json)",
  webm: "WebM video",
  still: "This frame (.png)",
  project: "Project (.json)",
};

export function ExportPanel({ compact = false }: { compact?: boolean }) {
  const scene = useStudio((s) => s.scene);
  const frame = useStudio((s) => s.frame);
  const poseLib = useStudio((s) => s.poseLib);
  const a = useStudio.getState();
  const [kind, setKind] = useState<Kind>("gif");
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(scene.frames - 1);
  const [cols, setCols] = useState(6);
  const [progress, setProgress] = useState<number | null>(null);
  const [framing, setFraming] = useState<Framing>("fit");
  const [aspect, setAspect] = useState(16 / 9);
  const cameras = scene.cameras ?? [];
  const camId = scene.activeCamera ?? null;
  const shot = useMemo(() => (camId ? timelineAt(scene, frame, camId) : null), [scene, frame, camId]);

  const run = async () => {
    const opts: ExportOpts = {
      scale,
      transparent,
      overlay,
      from: clamp(from, 0, scene.frames - 1),
      to: clamp(to, 0, scene.frames - 1),
      framing,
      camId,
      aspect,
    };
    const base = (scene.name || "animation").replace(/[^\w-]+/g, "-").toLowerCase();
    try {
      a.setBusy(null);
      if (kind === "project") {
        download(projectBlob(scene, poseLib), `${base}.anistudio.json`);
        a.notify("Project saved — drop it back in with Load", "ok");
        return;
      }
      if (kind === "still") {
        const blob = await exportPng(scene, { ...opts, from: frame, to: frame }, frame);
        download(blob, `${base}-frame-${frame}.png`);
        a.notify("Frame exported", "ok");
        return;
      }
      if (kind === "png-seq") {
        a.setBusy("Rendering PNG sequence…");
        const blob = await exportPngZip(scene, opts, (p) => setProgress(p));
        download(blob, `${base}-frames.zip`);
      } else if (kind === "gif") {
        a.setBusy("Encoding GIF…");
        const blob = await exportGif(scene, opts, (p) => setProgress(p));
        download(blob, `${base}.gif`);
      } else if (kind === "sheet") {
        a.setBusy("Packing sprite sheet…");
        const res = await exportSpriteSheet(scene, opts, cols);
        const z = new JSZip();
        z.file(`${base}-sheet.png`, res.png);
        z.file(`${base}-sheet.json`, res.json);
        download(await z.generateAsync({ type: "blob" }), `${base}-sheet.zip`);
        a.notify(`Sprite sheet ${res.cols}×${res.rows} of ${res.cw}×${res.ch}px (TexturePacker json)`, "ok");
      } else if (kind === "webm") {
        a.setBusy("Recording WebM in real time…");
        const blob = await exportWebm(scene, opts, (p) => setProgress(p));
        if (!blob) {
          a.notify("This browser cannot record WebM — use the PNG sequence or GIF", "warn");
        } else {
          download(blob, `${base}.webm`);
        }
      }
      a.notify("Export finished ✓", "ok");
    } catch (err) {
      console.error(err);
      a.notify(`Export failed: ${(err as Error).message}`, "warn");
    } finally {
      a.setBusy(null);
      setProgress(null);
    }
  };

  const copyJson = async () => {
    try {
      const res = await exportSpriteSheet(scene, { scale, transparent: false, overlay: false, from, to }, cols);
      await navigator.clipboard.writeText(res.json);
      a.notify("Sprite-sheet json copied", "ok");
    } catch {
      a.notify("Clipboard blocked by the browser", "warn");
    }
  };

  return (
    <div className={`export ${compact ? "compact" : ""}`}>
      <div className="export-kinds">
        {(Object.keys(LABELS) as Kind[]).map((k) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {LABELS[k]}
          </button>
        ))}
      </div>
      <div className="grid2">
        <label className="field">
          from
          <input type="number" min={0} max={scene.frames - 1} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
        </label>
        <label className="field">
          to
          <input type="number" min={0} max={scene.frames - 1} value={to} onChange={(e) => setTo(Number(e.target.value))} />
        </label>
        <label className="field">
          scale
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        {kind === "sheet" && (
          <label className="field">
            columns
            <input type="number" min={1} max={32} value={cols} onChange={(e) => setCols(Number(e.target.value))} />
          </label>
        )}
      </div>
      {cameras.length > 0 && kind !== "project" && (
        <>
          <label className="field">
            framing
            <select value={framing} onChange={(e) => setFraming(e.target.value as Framing)} title="How much of the set the export covers">
              <option value="fit">Tight on the character</option>
              <option value="camera">Through the camera (cinematic)</option>
              <option value="shot">Whole shot (steady)</option>
            </select>
          </label>
          {framing !== "fit" && (
            <label className="field">
              frame ratio
              <select value={aspect} onChange={(e) => setAspect(Number(e.target.value))}>
                <option value={16 / 9}>16:9</option>
                <option value={4 / 3}>4:3</option>
                <option value={1}>1:1</option>
                <option value={9 / 16}>9:16</option>
              </select>
            </label>
          )}
          <p className="tip">
            {framing === "fit" && "Cropped to the character — ideal for sprite sheets and quick GIFs."}
            {framing === "camera" && `Rendered through ${cameras.find((c) => c.id === camId)?.name ?? "the camera"} — pushes and pans are kept.`}
            {framing === "shot" && "The whole take stays in frame, so nothing pops out while the camera moves."}
          </p>
        </>
      )}
      {shot && kind !== "project" && (
        <div className="row-btns">
          <button
            className="ghost"
            onClick={() => {
              setFrom(shot.start);
              setTo(shot.end);
            }}
          >
            ↳ use shot {shot.start}–{shot.end}
          </button>
          <button className="ghost" onClick={() => { setFrom(0); setTo(scene.frames - 1); }}>
            full scene
          </button>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} disabled={kind === "webm" || kind === "project"} />
        transparent background
      </label>
      <label className="check">
        <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} disabled={kind === "sheet" || kind === "project"} />
        show the rig (bones &amp; handles) in the export
      </label>
      <div className="row-btns">
        <button className="primary" onClick={run}>
          export {LABELS[kind].toLowerCase()}
        </button>
        {kind === "sheet" && (
          <button className="ghost" onClick={copyJson}>
            copy json
          </button>
        )}
        {kind === "still" && (
          <button
            className="ghost"
            onClick={async () => {
              const el = document.querySelector("canvas") as HTMLCanvasElement | null;
              if (!el) return;
              const blob = await canvasBlob(el);
              download(blob, "anistudio-view.png");
            }}
          >
            copy canvas as-is
          </button>
        )}
      </div>
      {progress != null && (
        <div className="progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
          <span>{Math.round(progress * 100)}%</span>
        </div>
      )}
      <p className="tip">
        GIF &amp; PNG sequence render every frame offscreen at {Math.round((to - from + 1))} frames · {(scene.frames / scene.fps).toFixed(1)}s loop
        {kind === "webm" ? " · WebM records in real time, so keep this tab focused" : ""}
      </p>
    </div>
  );
}
