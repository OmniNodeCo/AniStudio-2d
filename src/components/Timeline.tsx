import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { clamp, deg, rad, EASES, type Ease } from "../core/math";
import { indexScene } from "../core/rig";
import { PALETTES } from "../core/types";

/** Transport + dopesheet: the whole animation as one row of keys per bone. */
export function Timeline() {
  const scene = useStudio((s) => s.scene);
  const frame = useStudio((s) => s.frame);
  const playing = useStudio((s) => s.playing);
  const autoKey = useStudio((s) => s.autoKey);
  const mirrorX = useStudio((s) => s.mirrorX);
  const speed = useStudio((s) => s.speed);
  const keySel = useStudio((s) => s.keySel);
  const selection = useStudio((s) => s.selection);
  const a = useStudio.getState();
  const [ppf, setPpf] = useState(16); // pixels per frame
  const [rowH, setRowH] = useState(20);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef<null | { start: number }>(null);
  const keyDragRef = useRef<null | { bone: string; frames: number[]; startX: number; delta: number }>(null);
  const [keyDelta, setKeyDelta] = useState(0);

  const rows = useMemo(() => indexScene(scene).order, [scene]);
  const total = scene.frames;
  const width = total * ppf;

  // keep the playhead in view while playing
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = frame * ppf;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }
  }, [frame, playing, ppf]);

  const frameAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return clamp(Math.round((clientX - r.left + el.scrollLeft - LABEL_W) / ppf), 0, total - 1);
    },
    [ppf, total],
  );

  const onScrubDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubRef.current = { start: 0 };
    a.setPlaying(false);
    a.setFrame(frameAt(e.clientX));
  };
  const onScrubMove = (e: React.PointerEvent) => {
    if (!scrubRef.current) return;
    a.setFrame(frameAt(e.clientX));
  };
  const onScrubUp = () => {
    scrubRef.current = null;
  };

  const beginKeyDrag = (e: React.PointerEvent, bone: string, t: number, additive: boolean) => {
    e.stopPropagation();
    const frames = additive && keySel?.bone === bone ? Array.from(new Set([...keySel.frames, t])) : [t];
    a.setKeySel(bone, frames);
    keyDragRef.current = { bone, frames, startX: e.clientX, delta: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveKeyDrag = (e: React.PointerEvent) => {
    const d = keyDragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.startX) / ppf);
    if (delta !== d.delta) {
      d.delta = delta;
      setKeyDelta(delta);
    }
  };

  const endKeyDrag = (e: React.PointerEvent) => {
    const d = keyDragRef.current;
    keyDragRef.current = null;
    setKeyDelta(0);
    if (!d) return;
    if (e.type === "pointerup" && d.delta !== 0) a.moveSelectedKeys(d.delta);
  };

  const selectedEase: Ease | null = keySel ? (scene.tracks[keySel.bone]?.rot.find((k) => k.t === keySel.frames[0])?.ease ?? null) : null;

  return (
    <section className="timeline">
      <header className="tl-bar">
        <div className="transport">
          <button className="ib" title="Go to start (Home)" onClick={() => a.setFrame(0)}>
            ⏮
          </button>
          <button className="ib" title="Previous frame (←)" onClick={() => a.step(-1)}>
            ◀
          </button>
          <button
            className={`ib play ${playing ? "on" : ""}`}
            title="Play / Pause (Space)"
            onClick={() => a.togglePlay()}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="ib" title="Next frame (→)" onClick={() => a.step(1)}>
            ▶
          </button>
          <button className="ib" title="Go to end (End)" onClick={() => a.setFrame(total - 1)}>
            ⏭
          </button>
          <div className="frame-readout">
            <input
              type="number"
              min={1}
              max={total}
              value={frame + 1}
              onChange={(e) => a.setFrame(Number(e.target.value) - 1)}
            />
            <span>/ {total}</span>
          </div>
          <select
            className="ib"
            title="Playback speed (the export always renders at 1×)"
            value={speed}
            onChange={(e) => a.setSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 1, 2].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
          <label className={`keybtn ${autoKey ? "armed" : ""}`} title="Auto-key: every drag writes a keyframe (A)">
            <input type="checkbox" checked={autoKey} onChange={(e) => a.setAutoKey(e.target.checked)} />
            <span>● auto-key</span>
          </label>
          <button className="ib wide" title="Key the whole rig at this frame (K)" onClick={() => a.keyCurrentPose()}>
            key pose
          </button>
          <button
            className={`ib wide ${mirrorX ? "on" : ""}`}
            title="Mirror posing across the rig centre (M)"
            onClick={() => a.toggleFlag("mirrorX")}
          >
            ⇋ mirror
          </button>
        </div>

        <div className="tl-right">
          {keySel && (
            <div className="ease-picker">
              <span>ease</span>
              <select
                value={selectedEase ?? "linear"}
                onChange={(e) => a.setEaseOnSelected(e.target.value as Ease)}
                title="Blending between this key and the next"
              >
                {EASES.map((e) => (
                  <option key={e.id} value={e.id} title={e.hint}>
                    {e.label}
                  </option>
                ))}
              </select>
              <button className="mini danger" title="Delete selected keys" onClick={() => a.deleteSelectedKeys()}>
                ⌫
              </button>
            </div>
          )}
          <label className="field">
            fps
            <input type="number" min={1} max={60} value={scene.fps} onChange={(e) => a.setFps(Number(e.target.value))} />
          </label>
          <label className="field">
            len
            <input type="number" min={2} max={400} value={scene.frames} onChange={(e) => a.setFrames(Number(e.target.value))} />
          </label>
          <button className={`ib ${scene.loop ? "on" : ""}`} title="Loop playback" onClick={() => a.setLoop(!scene.loop)}>
            ⟳
          </button>
          <div className="zoomers">
            <button className="mini" onClick={() => setPpf((p) => clamp(p * 0.8, 4, 60))}>
              −
            </button>
            <button className="mini" onClick={() => setPpf((p) => clamp(p * 1.25, 4, 60))}>
              +
            </button>
            <button className="mini" onClick={() => setRowH((h) => clamp(h - 2, 14, 30))}>
              ⍗
            </button>
          </div>
        </div>
      </header>

      <div className="tl-body" ref={scrollRef}>
        <div className="tl-inner" style={{ width: width + LABEL_W }}>
          {/* ruler + playhead */}
          <div className="ruler" style={{ height: 22 }} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`tick ${i % 5 === 0 ? "maj" : ""}`} style={{ left: LABEL_W + i * ppf }}>
                {i % 5 === 0 ? <b>{i}</b> : null}
              </span>
            ))}
            <span className="playhead" style={{ left: LABEL_W + frame * ppf + ppf / 2 - 0.5 }} />
          </div>

          {rows.map((b) => {
            const tr = scene.tracks[b.id];
            const keys = tr?.rot ?? [];
            const posKeys = tr?.pos ?? [];
            const depth = depthOf(b.id, scene);
            const selected = selection.kind === "bone" && selection.id === b.id;
            const chain = b.chain ? scene.chains.find((c) => c.id === b.chain) : null;
            return (
              <div key={b.id} className={`row ${selected ? "sel" : ""}`} style={{ height: rowH }}>
                <button
                  className="row-label"
                  style={{ paddingLeft: 6 + depth * 9 }}
                  onClick={() => a.select("bone", b.id)}
                  title={`${b.name} — click to select`}
                >
                  {chain && <i className="dot" style={{ background: chain.color }} />}
                  {b.name}
                </button>
                <div
                  className="cells"
                  onPointerDown={(e) => {
                    const f = frameAt(e.clientX);
                    if (e.shiftKey) a.deleteKeysAt(f, b.id);
                    else a.select("bone", b.id);
                  }}
                >
                  <span className="cur-line" style={{ left: LABEL_W + frame * ppf + ppf / 2 - 0.5, width: 1 }} />
                  {keys.map((k) => {
                    const isSel = keySel?.bone === b.id && keySel.frames.includes(k.t);
                    const moving = keyDragRef.current?.bone === b.id && keyDragRef.current.frames.includes(k.t) ? keyDelta : 0;
                    const x = (k.t + moving) * ppf + ppf / 2;
                    return (
                      <button
                        key={`r${k.t}`}
                        className={`key ${isSel ? "sel" : ""}`}
                        style={{ left: x, transform: `translate(-50%,-50%) rotate(45deg) scale(${isSel ? 1.15 : 1})` }}
                        title={`frame ${k.t} · ${deg(k.rot).toFixed(1)}° · ease ${k.ease}\nClick to select · drag to move · shift-drag to multi-select · right-click to delete`}
                        onPointerDown={(e) => beginKeyDrag(e, b.id, k.t, e.shiftKey)}
                        onPointerMove={moveKeyDrag}
                        onPointerUp={endKeyDrag}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          a.setKeySel(b.id, [k.t]);
                          a.deleteSelectedKeys();
                        }}
                      />
                    );
                  })}
                  {posKeys.map((k) => {
                    const x = k.t * ppf + ppf / 2;
                    return (
                      <span
                        key={`p${k.t}`}
                        className="key pos"
                        style={{ left: x }}
                        title={`root position at frame ${k.t}`}
                        onPointerDown={(e) => beginKeyDrag(e as unknown as React.PointerEvent, b.id, k.t, e.shiftKey)}
                        onPointerMove={moveKeyDrag}
                        onPointerUp={endKeyDrag}
                      />
                    );
                  })}
                  <button
                    className={`add-key ${scene.tracks[b.id]?.rot.some((k) => k.t === frame) ? "has" : ""}`}
                    style={{ left: clamp(frame * ppf + ppf / 2, 0, width) }}
                    title="Key this bone at the current frame"
                    onClick={(e) => {
                      e.stopPropagation();
                      a.select("bone", b.id);
                      a.keySelectedBone();
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="tl-foot">
        <span className="muted">
          {countKeys(scene)} keys · {rows.length} bones · shift-drag keys to select · right-click a key to delete
        </span>
        <span className="muted">
          palettes:{" "}
          {Object.keys(PALETTES).map((p) => (
            <button key={p} className="pal-chip" onClick={() => a.setPalette(p)} title={`Recolour with the ${p} palette`}>
              {p}
            </button>
          ))}
        </span>
      </footer>
    </section>
  );
}

const LABEL_W = 150;

function depthOf(id: string, scene: Parameters<typeof indexScene>[0]): number {
  const idx = indexScene(scene);
  let n = 0;
  let b = idx.byId.get(id);
  while (b?.parent) {
    n++;
    b = idx.byId.get(b.parent);
  }
  return n;
}

function countKeys(scene: Parameters<typeof indexScene>[0]): number {
  let n = 0;
  for (const t of Object.values(scene.tracks)) n += t.rot.length + t.pos.length;
  return n;
}

/** Degrees helpers used by the inspector. */
export const d2r = rad;
export const r2d = deg;
