# AniStudio 2D

A 2D animation studio that you learn by dragging. No keyframe graphs to fight, no rigging
manual: pick one of **eight rigged characters**, drop vector parts onto it, grab a hand or a
foot and the whole limb follows with real inverse kinematics. Then build the set around them —
**cameras with shots, lights and scenery** — and render through the lens. Every pose you make is
written straight into keyframes, so it scrubs, loops and exports like an ordinary animation.

```bash
npm ci          # install the locked dependencies
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
| **5 · Set** | Place **cameras**, **lights** and **scenery**, and turn the character on the spot. Cameras frame the stage and own *shots*; lights tint the backdrop and glow over the art; scenery paints behind or in front of the character. |

## Characters

Eight ready-to-animate rigs (Scene tab), each with its own palette, IK chains and a procedural
demo you can overwrite:

| Rig | What it shows off |
| --- | --- |
| **Walk Kid** | classic biped · IK hands + feet · walk cycle |
| **Nibbles the Cat** | quadruped · IK paws, spine and a follow-through tail · prowl |
| **Kage the Ninja** | biped with a sword bone · two-beat slash |
| **Bolt the Robot** | 3-bone FABRIK arms · mirrored limb pairs · wave |
| **Ember the Dragon** | 4-bone tail IK · wings · flight |
| **Pip the Falcon** | flying bird · wing IK · tail fan · flap |
| **Meryl the Wizard** | staff that carries a live glow light · spell cast |
| **Gloop the Blob** | squash &amp; stretch body IK · antenna · bounce |

Every character can be **moved, scaled by its parts and turned**: `anchor x/y` in the inspector
move its root, the **facing** slider sets a rest rotation for the whole rig, and `Alt`-dragging
the hips (or the ↺/↻ buttons) writes a root-rotation *key* — so turns animate like any other
channel.

Below the stage is the **dopesheet**: one row per bone, diamonds = rotation keys, dots = root
position. Drag keys sideways, click a key to pick its **ease** (linear, ease in/out, in-out
back, bounce, …), press `K` to key the whole rig at the playhead, `+` on a row to key just that
bone. Onion skin draws the frames before (pink) and after (cyan) the current one.

**The set (5 · Set).** Add scenery from the catalog — horizon, foliage, buildings, props, water —
and it lands on the ground line, re-coloured by the palette. Add lights (daylight, moonlight, warm
lamp, cool fill, spotlight, fire, glow); a light can follow an object or a bone, so a torch rides a
hand. Then add a camera: it frames the stage, and `✂ shot` starts a new take. The active camera's
shot is what the timeline loops inside, so you can block a wide, then cut to a close-up that pushes
in — with a dopesheet row for the camera, exactly like a bone.

Scene tab → *Empty stage* gives you a bare root bone to build a character from nothing.
Scene tab → *Demos* writes a procedural animation into the keyframes (kid walk cycle, robot
wave, dragon flight, blob bounce) so there is always something moving to play with.

## Export

`⤒ export` in the top bar renders from the same core code path the canvas uses:

Exports can be framed three ways: **tight on the character** (sprite sheets, quick GIFs),
**through the camera** (cinematic — pushes and pans are kept) or **steady for the whole shot**
(nothing pops out of frame while the camera moves), with 16:9 / 4:3 / 1:1 / 9:16 options.

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
  timeline.ts      shots ↔ sampling window ("a camera owns a take"), key lookup
  cameras.ts       camera sampling, framing boxes, resolution-independent zoom, picking
  scenery.ts       scenery catalog (procedural, palette-aware polygons) + lights catalog
  lights.ts        light wash + additive glow passes, follow targets, flicker
  pose-edit.ts     "solve this chain to that point", limit-aware aiming, snapshots
  rig-build.ts     tiny JSON rig DSL + buildScene (what the presets and .json loads use)
  parts.ts         part library (procedural polygons), transforms
  hit.ts           canvas hit-testing: handles → joints → art → bones
  render.ts        camera, backdrop, parts, rig overlay, onion skin, shadows
  shots.ts         offscreen frame renderer + motion bounds, shared by the exporters
src/presets/     rigs.ts (kid / cat / ninja / robot / dragon / bird / wizard / blob / blank)
                 demos.ts (procedural keys + ready-made set & camera rigs)
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
  && node .tmp/interact-check.cjs   # hit-testing, screen/world round trips, IK follow-through & limits,
                                    # camera framing maths and shot-window sampling

npx esbuild scripts/scene-check.ts --bundle --platform=node --format=cjs --external:@napi-rs/canvas --outfile=.tmp/scene-check.cjs --log-level=warning \
  && node .tmp/scene-check.cjs      # scenery + lights + cameras on every rig: renders .tmp/set-sheet.png
                                    # and .tmp/set-camera-frame.png, and exports through the lens

npx esbuild scripts/preview.ts --bundle --platform=node --format=esm --external:@napi-rs/canvas --outfile=.tmp/preview.mjs --log-level=warning \
  && node .tmp/preview.mjs kid,robot,dragon,blob 0,6,12 out.png 1 1 460 380   # contact sheet
```

## CI & releases

- **`.github/workflows/build.yml`** — on every push to `main` and every PR: typecheck, the four
  headless suites (store, exports, interaction, set/camera), `vite build`, then a smoke test that serves `dist/` with `vite preview` and
  asserts `index.html` and every hashed asset come back. A second job runs the same suites on
  macOS and Windows (that is where the `@napi-rs/canvas` platform binary gets exercised). Uploads
  the site bundle and a contact-sheet preview as artifacts. After those checks pass, a desktop
  matrix builds **Windows, Linux and macOS executables** (including on PRs and manual runs).
  The Linux job also launches the packaged app headlessly and checks that its canvas renders.
  Find installers under **Actions → Build → a successful run → Artifacts**:

  | Artifact | Contents |
  | --- | --- |
  | `anistudio-2d-desktop-windows` | x64 NSIS setup `.exe` and portable `.exe` |
  | `anistudio-2d-desktop-linux` | x64 `.AppImage`, `.deb` and `.rpm` |
  | `anistudio-2d-desktop-macos` | Apple silicon (arm64) and Intel (x64) `.dmg` + portable `.zip` |

  Each job asserts the installers it promised actually exist (`*.rpm`, `*-setup.exe`, …), not just
  that packaging exited 0. These builds are not publisher-signed (macOS uses ad-hoc signing) and are
  retained for 14 days.
  Windows SmartScreen and macOS Gatekeeper
  may warn or block launch; Developer ID signing/notarization is not configured. For AppImage, first run
  `chmod +x AniStudio-2D-*.AppImage`; some Linux distributions require FUSE/user-namespace setup.
  The app keeps Chromium's sandbox enabled; it is disabled only for the headless CI smoke test.
- **`.github/workflows/release.yml`** — push a tag (`git tag -a v0.2.0 -m "..." && git push origin v0.2.0`)
  and it re-runs the checks (a release never ships on an unverified commit), then **builds the same
  installers on Windows, macOS and Linux runners and publishes them with the web build** on one
  GitHub Release: Windows setup + portable `.exe`, macOS `.dmg` and portable `.zip` for arm64/x64,
  Linux `.AppImage` + `.deb` + `.rpm`, plus `AniStudio-2D-<version>-web.zip`, `preview.png`,
  `SHA256SUMS.txt` and generated release notes with a download table. The release is created as a
  draft, filled with assets, then published — so no download link ever 404s; a platform that fails
  to package is flagged in the run instead of blocking the others. Each packaging job stamps the
  tag's version into `package.json`/`package-lock.json` *on the runner only* (nothing is committed),
  so a `v1.0.0` tag yields `AniStudio-2D-1.0.0-*` installers even when the checked-in version lags.
  Re-running for a tag that already has a release replaces its assets and refreshes its notes.
  You can also dispatch it manually
  with a tag name — it will create the tag on the commit you ran it from, and tags with a hyphen
  after the version (`v0.3.0-beta.1`) are published as pre-releases.
  Set the repository variable `PUBLISH_PAGES=true` (and point Pages at the `gh-pages` branch) to
  also push each release's site to Pages.

### Build desktop apps locally

Use Node 22.12+ and run on the target OS (macOS packaging requires a Mac):

```bash
npm ci
npm run desktop        # build the web renderer, then launch it in Electron
npm run dist:win       # Windows: NSIS setup .exe + portable .exe
npm run dist:linux     # Linux: AppImage + .deb + .rpm (needs the `rpm` package for rpmbuild)
npm run dist:mac       # macOS: .dmg + portable .zip, arm64 + x64
npm run desktop:check # shell unit checks using a stubbed Electron API
```

Output goes to the ignored `release/` directory. `electron-builder.yml` configures packaging;
`electron/main.mjs` loads the bundled studio without a dev server, with Node integration off,
context isolation and sandboxing on. Existing project imports and export downloads work through
Chromium; exports get a native save dialog. Regenerate the icon with `node scripts/make-icon.mjs`.
Packaging scripts use `--publish never`, so **nothing is pushed from a build**: `build.yml` keeps
the installers as Actions artifacts for every push and PR, and `release.yml` attaches them to the
GitHub Release when you tag. `npm run desktop:check` also asserts that this wiring stays in place —
electron-builder targets, the `dist:*` scripts and both workflows' upload globs all have to mention
the setup/portable/dmg/zip/AppImage/deb/rpm files.

Node 22 is what CI uses (`vite 7` needs Node ≥ 20.19).

## Keyboard

`1-4` modes · `Space` play/pause · `←/→` step (`Shift` = 5) · `Home/End` first/last frame ·
`K` key whole rig (or the camera you selected) · `A` auto-key · `M` mirror · `O` onion count ·
`F` fit character · `Shift+F` fit the whole set · `5` Set mode · `L` loop ·
`B/H/N/G` bones/handles/names/grid · `Enter` finish a drawn shape · `Esc` cancel ·
`Del` delete selected keys or part · `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo · `Ctrl+C/V` copy/paste pose ·
`?` help.

While dragging: `Shift` snaps (15° rotations, ground-aligned root moves) · in Art mode `Alt`
rotates the part you grabbed and `Shift` scales it · in Rig mode dragging out from any joint grows
a child bone, `Alt`-dragging from a bone tip resizes it, and `Shift`-clicking bones in a row
selects them for *make IK chain* · wheel zooms at the cursor, `Shift`+wheel pans sideways,
middle-drag (or `Space`+drag) pans · double-click (or `Enter`) closes a drawn shape.

## Project file

`{ app: "AniStudio2D", version: 1, scene: { rigId, name, root, rootRot, frames, fps, loop, bones[], tracks{}, shapes[], chains[], objects[], lights[], cameras[], activeCamera, palettes… }, poses[] }`
— plain JSON, so you can also generate animations from a script and drop the file back in.
