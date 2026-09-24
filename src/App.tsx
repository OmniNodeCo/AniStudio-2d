import { useEffect, useRef, useState } from "react";
import { useStudio } from "./state/store";
import { Topbar } from "./components/Topbar";
import { Stage } from "./components/Stage";
import { LeftDock, RightDock } from "./components/Docks";
import { Timeline } from "./components/Timeline";
import { HelpModal } from "./components/HelpModal";
import { parseProject } from "./io/export";

const LS_KEY = "anistudio2d:session:v1";

/**
 * Playback is a single rAF ticker that only advances `frame`; the canvas and dopesheet react to
 * that. Frame timing comes from the scene's fps × speed, and an accumulator keeps the cadence even
 * when a frame takes longer than a step.
 */
function usePlayback() {
  const playing = useStudio((s) => s.playing);
  const fps = useStudio((s) => s.scene.fps);
  const speed = useStudio((s) => s.speed);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (t: number) => {
      const s = useStudio.getState();
      const per = 1000 / Math.max(1, s.scene.fps * s.speed);
      acc += Math.min(250, t - last);
      last = t;
      let guard = 0;
      while (acc >= per && guard++ < 8) {
        acc -= per;
        const cur = useStudio.getState();
        if (!cur.scene.loop && cur.frame >= cur.scene.frames - 1) {
          cur.setPlaying(false);
          break;
        }
        cur.setFrame(cur.frame + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, speed]);
}

export function App() {
  const toast = useStudio((s) => s.toast);
  const busy = useStudio((s) => s.busy);
  usePlayback();
  const playing = useStudio((s) => s.playing);
  const [toastGone, setToastGone] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const scene = useStudio((s) => s.scene);
  const loadedRef = useRef(false);

  // ------------------------------------------------------------ session restore
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.scene?.bones?.length) {
        const { scene: sc } = parseProject(JSON.stringify({ scene: data.scene, poseLib: data.poseLib }));
        const st = useStudio.getState();
        st.loadScene(sc, "restored session", false);
        st.setFrame(data.frame ?? 0);
        if (data.view) st.setView(data.view);
        st.notify("Restored your last session from this browser", "info");
      }
    } catch {
      /* ignore a broken autosave */
    }
  }, []);

  // ------------------------------------------------------------------ autosave
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const s = useStudio.getState();
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ scene: s.scene, frame: s.frame, view: s.view, poseLib: s.poseLib }));
      } catch {
        /* quota — fine, this is a convenience */
      }
    }, 900);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [scene, playing]);

  useEffect(() => {
    if (!toast) return;
    setToastGone(false);
    const id = window.setTimeout(() => setToastGone(true), 3600);
    return () => window.clearTimeout(id);
  }, [toast?.id]);

  // ----------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(input|textarea|select)$/i.test(el.tagName)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      const s = useStudio.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && k === "c") {
        e.preventDefault();
        s.copyPose();
        return;
      }
      if (mod && k === "v") {
        e.preventDefault();
        s.pastePose();
        return;
      }
      if (mod && k === "s") {
        e.preventDefault();
        s.notify("Autosaved in this browser — use ⤒ save for a file", "ok");
        return;
      }
      switch (k) {
        case " ":
          e.preventDefault();
          s.togglePlay();
          break;
        case "arrowleft":
          e.preventDefault();
          s.step(e.shiftKey ? -5 : -1);
          break;
        case "arrowright":
          e.preventDefault();
          s.step(e.shiftKey ? 5 : 1);
          break;
        case "home":
          s.setFrame(0);
          break;
        case "end":
          s.setFrame(s.scene.frames - 1);
          break;
        case "1":
          s.setMode("pose");
          break;
        case "2":
          s.setMode("rig");
          break;
        case "3":
          s.setMode("art");
          break;
        case "4":
          s.setMode("draw");
          break;
        case "5":
          s.setMode("camera");
          break;
        case "k":
          s.keyCurrentPose();
          break;
        case "a":
          s.setAutoKey(!s.autoKey);
          s.notify(`Auto-key ${s.autoKey ? "off" : "on"} — ${s.autoKey ? "every drag records a keyframe" : "poses are preview only"}`, "info");
          break;
        case "m":
          s.toggleFlag("mirrorX");
          break;
        case "b":
          s.toggleFlag("showBones");
          break;
        case "h":
          s.toggleFlag("showHandles");
          break;
        case "n":
          s.toggleFlag("showNames");
          break;
        case "g":
          s.toggleFlag("showGrid");
          break;
        case "o":
          s.setShowOnion((s.showOnion + 1) % 5);
          break;
        case "f":
          if (e.shiftKey && s.mode === "pose") s.fitAll();
          else if (e.shiftKey) s.fitAll();
          else s.fit();
          break;
        case "l":
          s.setLoop(!s.scene.loop);
          break;
        case "enter":
          if (s.mode === "draw" && s.drawPoints.length > 2) s.finishDraw();
          break;
        case "escape":
          s.clearLive();
          s.setDrawPoints([]);
          s.select("none", null);
          s.setKeySel(null);
          break;
        case "delete":
        case "backspace":
          e.preventDefault();
          if (s.keySel) s.deleteSelectedKeys();
          else if (s.selection.kind === "shape" && s.selection.id) s.deleteShape(s.selection.id);
          else if (s.selection.kind === "object" && s.selection.id) s.deleteObject(s.selection.id);
          else if (s.selection.kind === "light" && s.selection.id) s.deleteLight(s.selection.id);
          else if (s.selection.kind === "camera" && s.selection.id) s.deleteCamera(s.selection.id);
          else if (s.drawPoints.length) s.setDrawPoints(s.drawPoints.slice(0, -1));
          else s.notify("Select a keyframe or a part first", "info");
          break;
        case "?":
          s.toggleFlag("showHelp");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --------------------------------------------------- project file on the app
  useEffect(() => {
    const onDrop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f || !f.name.endsWith(".json")) return;
      e.preventDefault();
      const s = useStudio.getState();
      try {
        const { scene: sc } = parseProject(await f.text());
        s.loadScene(sc, `load ${f.name}`, true);
        s.notify(`Loaded ${f.name}`, "ok");
      } catch (err) {
        s.notify(`Could not open ${f.name}: ${(err as Error).message}`, "warn");
      }
    };
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", onDrop);
    return () => window.removeEventListener("drop", onDrop);
  }, []);

  return (
    <div className="app">
      <Topbar />
      <LeftDock />
      <main className="center">
        <Stage />
      </main>
      <RightDock />
      <Timeline />
      {toast && (
        <div className={`toast ${toast.tone} ${toastGone ? "gone" : ""}`} key={toast.id}>
          {toast.msg}
        </div>
      )}
      {busy && (
        <div className="busy">
          <div className="busy-card">
            <span className="spin" />
            {busy}
          </div>
        </div>
      )}
      <HelpModal />
      <FirstRunBanner />
    </div>
  );
}

function FirstRunBanner() {
  const showHelp = useStudio((s) => s.showHelp);
  const a = useStudio.getState();
  const [seen, setSeen] = useState(() => localStorage.getItem("anistudio2d:seen") === "1");
  useEffect(() => {
    if (!seen && !showHelp) {
      a.toggleFlag("showHelp");
      setSeen(true);
      localStorage.setItem("anistudio2d:seen", "1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
