import { useStudio } from "../state/store";

const STEPS: { icon: string; title: string; body: string }[] = [
  {
    icon: "✋",
    title: "1 · Drag to pose",
    body: "You are in Pose mode. Grab a coloured ring — that is an IK handle. Move a hand or a foot and the whole limb follows (elbows and knees obey their bend limits). Let go and the pose is keyed automatically.",
  },
  {
    icon: "▲",
    title: "2 · Drop parts on bones",
    body: "Open Parts on the left and drag a head, arm or sword onto the character. It welds itself to whichever bone you drop it on, then rides that bone forever. Draw your own shapes in Draw mode.",
  },
  {
    icon: "▶",
    title: "3 · Key poses, then scrub",
    body: "The dopesheet below has one row per bone. Drag keyframes sideways, press K to key the whole rig, use ease menus, and play with Space. Onion skin shows the frames before/after in pink/cyan.",
  },
  {
    icon: "⤒",
    title: "4 · Export",
    body: "GIF, PNG sequence, sprite sheet (with TexturePacker json), WebM or the project file itself. Everything you made is plain keyframes, so any tool can read it.",
  },
];

export function HelpModal() {
  const open = useStudio((s) => s.showHelp);
  const a = useStudio.getState();
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={() => a.toggleFlag("showHelp")}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>AniStudio 2D in four steps</h3>
          <button className="mini" onClick={() => a.toggleFlag("showHelp")}>
            ✕
          </button>
        </div>
        <div className="help-grid">
          {STEPS.map((s) => (
            <section key={s.title}>
              <span className="hi">{s.icon}</span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
        <div className="help-keys">
          <b>shortcuts</b>
          {[
            ["1 / 2 / 3 / 4", "Pose · Rig · Art · Draw"],
            ["Space", "play / pause"],
            ["← →", "step frame (shift = 5)"],
            ["K", "key the whole rig here"],
            ["A", "toggle auto-key"],
            ["M", "mirror posing"],
            ["O", "onion skin count"],
            ["F", "fit character to view"],
            ["B / H / N / G", "bones · handles · names · grid"],
            ["L", "loop"],
            ["Ctrl+Z / Ctrl+Shift+Z", "undo / redo"],
            ["Ctrl+C / Ctrl+V", "copy / paste pose"],
            ["Del", "delete selected keys or part"],
            ["?", "this panel"],
          ].map(([k, v]) => (
            <span key={k}>
              <kbd>{k}</kbd> {v}
            </span>
          ))}
        </div>
        <div className="help-more">
          <p>
            <b>How IK works here:</b> IK is an authoring aid, not a runtime constraint. When you drag a handle the
            studio solves the chain (two-bone analytic maths for arms/legs, FABRIK for tails, spines and three-bone
            arms), respects each joint&apos;s bend limits, then bakes the resulting rotations into keyframes on those
            bones. So scrubbing, exporting and re-posing all behave like ordinary keys — and a "solver" can never
            fight your animation.
          </p>
          <p>
            <b>Make your own character:</b> Scene tab → “Empty stage”. In Rig mode, drag out from any joint to grow a
            bone (it parents to the joint you grabbed). Shift-click a few bones in a row, then “make IK chain”. Drop
            library parts on the bones, or trace shapes in Draw mode. Auto-rig limbs turns every leftover limb chain
            into IK for you.
          </p>
        </div>
        <div className="row-btns">
          <button className="primary" onClick={() => a.toggleFlag("showHelp")}>
            let&apos;s animate
          </button>
          <button
            className="ghost"
            onClick={() => {
              a.loadRig("kid", true);
              a.toggleFlag("showHelp");
            }}
          >
            load the walk-cycle demo again
          </button>
        </div>
      </div>
    </div>
  );
}
