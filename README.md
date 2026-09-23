# AniStudio 2D

A 2D animation studio that you learn by dragging. No keyframe graphs to fight, no rigging
manual: drop vector parts onto a character, grab a hand or a foot, and the whole limb follows
with real inverse kinematics. Every pose you make is written straight into keyframes, so it
scrubs, loops and exports like an ordinary animation.

```bash
npm install     # deps are already installed in this sandbox
npm run dev     # → http://localhost:5173  (open it in the preview)
```

Other scripts: `npm run build` (typecheck + production bundle), `npm run typecheck`, and the
headless checks below.

## The four-mode idea

| Mode | What you do |
| --- | --- |
| **1 · Pose** | Drag IK handles (rings on hands, feet, snouts, tails), joints and the root. Elbows and knees obey their bend limits; feet snap to the ground line. Let go and the pose is keyed. |
| **2 · Rig** | Drag out from any joint to grow a bone. Shift-click bones in a row → *make IK chain*. *Auto-rig limbs* finds leftover limb chains and gives each one a handle. Set joint limits per bone. |
| **3 · Art** | ~40 library parts (heads, limbs, props, FX) plus anything you draw. Drag parts around, resize with the corner handles, alt-drag to rotate, re-layer, recolour per role or per part. Parts weld to bones, so art follows the pose. |
| **4 · Draw** | Freehand lasso on the canvas. The outline is simplified, closed and welded to the bone underneath — instant custom art. |

Below the stage is the **dopesheet**: one row per bone, diamonds = rotation keys, dots = root
position. Drag keys sideways, click a key to pick its **ease** (linear, ease in/out, in-out
back, bounce, …), press `K` to key the whole rig at the playhead, `+` on a row to key just that
bone. Onion skin draws the frames before (pink) and after (cyan) the current one.

Scene tab → *Empty stage* gives you a bare root bone to build a character from nothing.
Scene tab → *Demos* writes a procedural animation into the keyframes (kid walk cycle, robot
wave, dragon flight, blob bounce) so there is always something moving to play with.

## Export

`⤒ export` in the top bar renders from the same core code path the canvas uses:

- **GIF** — animated, optional transparency (1-bit), quantised per frame
- **PNG sequence** — a `.zip` of frames plus a `manifest.json`
- **Sprite sheet** — one PNG grid + TexturePacker-style `json` (with `frame`, `sourceSize`, `rotated: false`)
- **WebM** — `captureStream` + `MediaRecorder`
- **Still PNG** — current frame, optionally with the rig overlay for docs
- **Project `.json`** — the whole scene (bones, parts, keyframes, palette) — drag it back onto the window to reload

Everything is also autosaved into `localStorage`, so a refresh does not lose your work.

## How the IK works (and why playback needs no solver)

IK here is an **authoring aid, not a runtime constraint**:

1. You drag a handle. The studio solves the chain — closed-form two-bone maths for arms and legs
   (with a pole target to decide which way the knee goes), FABRIK with per-joint limit clamping
   for tails, spines and three-bone arms.
2. While dragging, the result lives in a *live buffer*: nothing is written to the scene, so a
   drag is cheap and fully undoable.
3. On mouse-up the solved rotations are **baked into keyframes at the current frame** (and the
   root's position into a position key). Playback, export and re-posing are then plain FK.

That is why a "solver" can never fight your animation afterwards, and why a keyframe you drag
later still wins. Two-bone solves pick the bend side that survives the joint limits, so swinging
a foot up never pops the knee backwards; FABRIK restarts from an aimed chain when the seeded bend
is trapped by limits.

## Layout

```
src/core/        the studio engine — no React, no DOM, all pure + testable
  math.ts          Vec/easing/bbox/polygon helpers (y-down, +angle = clockwise)
  types.ts         Bone, Track/Keyframe, ShapePart, IKChain, Scene, Project, palettes
  rig.ts           scene index (cached), pose interpolation, key read/write, mirroring
  fk.ts            forward kinematics → joint positions/angles, bone↔world space
  ik.ts            two-bone + FABRIK solvers, pole handles, reach clamping
  pose-edit.ts     "solve this chain to that point", limit-aware aiming, snapshots
  rig-build.ts     tiny JSON rig DSL + buildScene (what the presets and .json loads use)
  parts.ts         part library (procedural polygons), transforms
  hit.ts           canvas hit-testing: handles → joints → art → bones
  render.ts        camera, backdrop, parts, rig overlay, onion skin, shadows
  shots.ts         offscreen frame renderer + motion bounds, shared by the exporters
src/presets/     rigs.ts (kid / robot / dragon / blob / blank) · demos.ts (procedural keys)
src/state/       store.ts — one zustand store: scene + tool state, undo/redo, live buffer
src/components/  Topbar · Stage · Timeline · Docks (parts/rig/scene + inspectors) · ExportPanel · HelpModal
src/io/          export.ts (gif/png-zip/sheet/still/webm/project) · project.ts
scripts/         headless checks + contact-sheet renderer (no browser needed)
```

### Headless checks

The core has no browser dependency, so the risky parts are verified in Node with `@napi-rs/canvas`:

```bash
npx esbuild scripts/store-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/store-check.cjs --log-level=warning \
  && node .tmp/store-check.cjs      # every store action the UI calls: ~70 assertions

npx esbuild scripts/export-check.ts --bundle --platform=node --format=cjs --external:@napi-rs/canvas --outfile=.tmp/export-check.cjs --log-level=warning \
  && node .tmp/export-check.cjs     # real GIF/zip/sheet/still bytes + project round-trip, all four rigs

npx esbuild scripts/interact-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/interact-check.cjs --log-level=warning \
  && node .tmp/interact-check.cjs   # hit-testing, screen/world round trips, IK follow-through & limits

npx esbuild scripts/preview.ts --bundle --platform=node --format=esm --external:@napi-rs/canvas --outfile=.tmp/preview.mjs --log-level=warning \
  && node .tmp/preview.mjs kid,robot,dragon,blob 0,6,12 out.png 1 1 460 380   # contact sheet
```

## Keyboard

`1-4` modes · `Space` play/pause · `←/→` step (`Shift` = 5) · `Home/End` first/last frame ·
`K` key whole rig · `A` auto-key · `M` mirror · `O` onion count · `F` fit view · `L` loop ·
`B/H/N/G` bones/handles/names/grid · `Enter` finish a drawn shape · `Esc` cancel ·
`Del` delete selected keys or part · `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo · `Ctrl+C/V` copy/paste pose ·
`?` help.

While dragging: `Shift` snaps (15° rotations, ground-aligned root moves) · in Art mode `Alt`
rotates the part you grabbed and `Shift` scales it · in Rig mode dragging out from any joint grows
a child bone, `Alt`-dragging from a bone tip resizes it, and `Shift`-clicking bones in a row
selects them for *make IK chain* · wheel zooms at the cursor, `Shift`+wheel pans sideways,
middle-drag (or `Space`+drag) pans · double-click (or `Enter`) closes a drawn shape.

## Project file

`{ app: "AniStudio2D", version: 1, scene: { rigId, name, root, frames, fps, loop, bones[], tracks{}, shapes[], chains[], palettes… }, poses[] }`
— plain JSON, so you can also generate animations from a script and drop the file back in.
