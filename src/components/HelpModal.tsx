import { useStudio } from "../state/store";

const STEPS: { icon: string; title: string; body: string }[] = [
  {
    icon: "✋",
    title: "1 · Drag to pose",
    body: "You are in Pose mode. Grab a coloured ring — that is an IK handle. Move a hand or a foot and the whole limb follows (elbows and knees obey their bend limits). Let go and the pose is keyed automatically.",
  },
  {
    icon: "⚒",
    title: "2 · Build the character",
    body: "The Build tab is the character sheet. Pick a body plan, then switch slots on or off: body, head, eyes, mouth, hair, ears, arms, hands, legs, feet, tail, wings, prop. Only the body is required — a legless slime is one click. Each slot can take the starter art, a premade part, your own sketch or an imported drawing.",
  },
  {
    icon: "⭳",
    title: "3 · Import your own art",
    body: "Drag a PNG, JPG or SVG anywhere onto the stage (or paste a screenshot with Ctrl/V) and it welds to the bone you dropped it on — it poses, exports and saves with the project. Filenames label the slot: hero-legs.png lands on the legs. The Import tab lists everything with fit, anchor and parent controls.",
  },
  {
    icon: "🏞",
    title: "4 · Backdrops",
    body: "The Backdrop tab has ready-made skies — dawn meadow, night city, snowy peaks, lava cave — that can bring their own scenery and lighting. Or import your own background image and tune fit, haze, parallax and mirroring. Save whatever you build as your own preset for the next scene.",
  },
  {
    icon: "▶",
    title: "5 · Key poses, then scrub",
    body: "The dopesheet below has one row per bone. Drag keyframes sideways, press K to key the whole rig, use ease menus, and play with Space. Onion skin shows the frames before/after in pink/cyan.",
  },
  {
    icon: "🎥",
    title: "6 · Build the set",
    body: "Set mode places cameras, lights and scenery. Drop hills, trees and buildings on the ground, add a warm light or a torch that follows a hand, then snap a camera to your view. Cameras own shots — the timeline loops inside the shot you are standing in, and exports can render through the lens.",
  },
  {
    icon: "⤒",
    title: "7 · Export",
    body: "GIF, PNG sequence, sprite sheet (with TexturePacker json), WebM or the project file itself. Pick the framing — tight on the character, cinematic through the camera, or steady for the whole shot. Everything you made is plain keyframes, so any tool can read it.",
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
          <h3>AniStudio 2D in seven steps</h3>
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
            ["1 / 2 / 3 / 4 / 5", "Pose · Rig · Art · Draw · Set"],
            ["Ctrl/⌘ + V", "paste a drawing onto the character"],
            ["Space", "play / pause"],
            ["← →", "step frame (shift = 5)"],
            ["K", "key the whole rig here"],
            ["A", "toggle auto-key"],
            ["M", "mirror posing"],
            ["Alt+drag hips", "turn the whole character (keys the root)"],
            ["O", "onion skin count"],
            ["F / Shift+F", "fit character · fit the whole set"],
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
            <b>Cameras, lights &amp; scenery:</b> a camera is a take. It frames the stage, owns one or more shots
            (frame ranges) and can be keyed to push, truck or crane. The active camera&apos;s shot also decides where
            the timeline loops, so each take is its own little animation. Lights are cheap 2D tricks that still land
            on your character: a gradient wash tints the backdrop, then an additive glow is painted over the art —
            and a light can follow an object or a bone, which is how you build a torch. Scenery objects paint either
            behind (depth &lt; 1) or in front of the character, and every one of them is re-coloured by the palette.
          </p>
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
