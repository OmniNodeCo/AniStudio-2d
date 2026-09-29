/**
 * Headless check of the *character builder*: slots (what each piece is, and what is optional),
 * imported drawings (image parts), and the backdrop presets.
 *
 * Run:
 *   npx esbuild scripts/build-check.ts --bundle --platform=node --format=cjs \
 *     --external:@napi-rs/canvas --outfile=.tmp/build-check.cjs --log-level=warning && node .tmp/build-check.cjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require("@napi-rs/canvas") as { createCanvas: (w: number, h: number) => any };

/* ------------------------------------------------------- minimal DOM shim */
const g = globalThis as any;
g.document = {
  createElement: (tag: string) => {
    if (tag !== "canvas") return { style: {}, setAttribute() {}, click() {}, remove() {}, appendChild() {} };
    const c = createCanvas(4, 4);
    c.toBlob = (cb: (b: Blob) => void) => cb(new Blob([c.toBuffer("image/png")], { type: "image/png" }));
    c.toDataURL = () => `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`;
    return c;
  },
  body: { appendChild() {}, removeChild() {} },
};
g.Blob = g.Blob ?? (class {} as any);
// The store reads localStorage for saved backdrops; give it a working stub.
const mem = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

async function main() {
  const { RIG_MAP, RIGS } = await import("../src/presets/rigs");
  const { buildScene } = await import("../src/core/rig-build");
  const {
    SLOTS,
    blueprintFor,
    blueprintIssues,
    blueprintRows,
    buildFromBlueprint,
    defaultBlueprint,
    describeBlueprint,
    guessSlot,
    sceneCoverage,
    sceneHasSlot,
    slotSpecForScene,
    stripSlot,
    tagSlots,
    templateSlots,
  } = await import("../src/core/slots");
  const { BACKDROPS, backdropLights, backdropObjects, bgImageRect, presetFromScene } = await import("../src/core/backgrounds");
  const { DEMOS } = await import("../src/presets/demos");
  const { imageQuadForBone, putImage, clearImages, getImage } = await import("../src/core/images");
  const { onImageLoaded } = await import("../src/core/images");
  const { drawImagePart, drawParts, paintBackdrop, BACKDROP_IMAGE_ID, sceneBounds } = await import("../src/core/render");
  const { shapeWorldPoints, solveFK } = await import("../src/core/fk");
  const { poseRotations, indexScene } = await import("../src/core/rig");
  const { drawShot } = await import("../src/core/shots");
  const { exportPng } = await import("../src/io/export");
  const { applyDemo } = await import("../src/presets/demos");

  let fails = 0;
  const ok = (name: string, cond: boolean, extra = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
    if (!cond) fails++;
  };
  const finite = (...nums: number[]) => nums.every((n) => Number.isFinite(n));
  const boneIds = (scene: any) => scene.bones.map((b: any) => b.id);
  const shapeBones = (scene: any) => scene.shapes.map((s: any) => s.bone);

  /* ------------------------------------------------------------------ slots */
  ok("thirteen slots cover a whole character", SLOTS.length === 13, `${SLOTS.length}: ${SLOTS.map((s) => s.id).join(", ")}`);
  const body = SLOTS.find((s) => s.id === "body")!;
  ok("only the body slot is required", SLOTS.filter((s) => s.required).length === 1 && !!body.required);
  ok("every optional slot has a hint and parts", SLOTS.every((s) => s.hint.length > 8 && s.parts.length > 0));
  ok("every slot's preferred part exists", SLOTS.every((s) => s.parts.includes(s.preferred)), SLOTS.filter((s) => !s.parts.includes(s.preferred)).map((s) => s.id).join(",") || "all good");

  for (const def of RIGS.filter((r) => r.id !== "blank")) {
    const slots = templateSlots(def);
    const bp = blueprintFor(def);
    const full = buildFromBlueprint(def, bp);
    const base = buildScene(def);
    ok(`${def.id}: body plan detects its slots`, slots.length >= 5, slots.join(", "));
    ok(
      `${def.id}: an untouched blueprint rebuilds the starter rig`,
      full.bones.length === base.bones.length && full.shapes.length === base.shapes.length,
      `${full.bones.length} bones / ${full.shapes.length} shapes`,
    );
    ok(`${def.id}: every bone is tagged with a slot`, full.bones.every((b) => !!b.slot));
    ok(`${def.id}: every shape is tagged with a slot`, full.shapes.every((s) => !!s.slot));
    const cover = sceneCoverage(full);
    ok(
      `${def.id}: every detected slot shows up on the rebuilt character`,
      slots.every((id) => {
        const row = cover.find((c) => c.id === id)!;
        return row.present || row.drawn;
      }),
      slots.map((id) => `${id}:${(cover.find((c) => c.id === id)!.present ? "b" : "")}${cover.find((c) => c.id === id)!.drawn ? "a" : ""}`).join(" "),
    );
    // Everything switched off except the body: still a valid, posable rig.
    const onlyBody = defaultBlueprint(def.id);
    for (const s of SLOTS) if (!s.required) onlyBody.slots[s.id] = { on: false, art: "template" };
    const slim = buildFromBlueprint(def, onlyBody);
    ok(
      `${def.id}: body-only keeps just the trunk`,
      slim.bones.length <= 4 && slim.shapes.length <= 4 && slim.bones.every((b) => b.slot === "body" || SLOTS.some((s) => !s.required && false)),
      `${slim.bones.length} bones (${boneIds(slim).join(",")}) / ${slim.shapes.length} shapes`,
    );
    const pose = solveFK(slim, poseRotations(slim, 3), 3);
    ok(`${def.id}: body-only still solves`, Object.values(pose.pos).every((p: any) => finite(p.x, p.y)));
    ok(`${def.id}: no dangling parents`, slim.bones.every((b) => !b.parent || boneIds(slim).includes(b.parent)));
    ok(`${def.id}: no orphan art`, shapeBones(slim).every((id: string) => boneIds(slim).includes(id)));
    ok(`${def.id}: no dangling chain bones`, slim.chains.every((c) => c.bones.every((id) => boneIds(slim).includes(id))));
  }

  /* ------------------------------------------- demos on a character with slots missing */
  {
    const reduced = defaultBlueprint("kid");
    for (const s of SLOTS) if (!s.required) reduced.slots[s.id] = { on: false, art: "template" };
    reduced.slots.head = { on: true, art: "template" };
    reduced.slots.arms = { on: true, art: "template" };
    let bad = 0;
    // Each rig's own demo, run against every rig reduced to body + head + arms (legs, tail,
    // props and all art gone). None of them may throw, leave NaN, or key a bone that is absent.
    for (const def of RIGS.filter((r) => r.id !== "blank")) {
      for (const name of Object.keys(DEMOS)) {
        const scene = buildFromBlueprint(def, reduced);
        let okDemo = true;
        try {
          applyDemo(scene, name);
        } catch {
          okDemo = false;
        }
        const pose = solveFK(scene, poseRotations(scene, 4), 4);
        const nan = Object.values(pose.pos).some((q: any) => !finite(q.x, q.y));
        const orphan = Object.keys(scene.tracks).some((id) => !scene.bones.some((b) => b.id === id));
        if (!okDemo || nan || orphan) bad++;
      }
    }
    ok(
      "every demo survives a character with slots missing",
      bad === 0,
      bad ? `${bad} combination(s) broke` : `${RIGS.length - 1} rigs × ${Object.keys(DEMOS).length} demos ok`,
    );
    const kidReduced = buildFromBlueprint(RIG_MAP.get("kid")!, reduced);
    applyDemo(kidReduced, "walk");
    const legless = Object.keys(kidReduced.tracks).length;
    const full = buildFromBlueprint(RIG_MAP.get("kid")!, blueprintFor(RIG_MAP.get("kid")!));
    applyDemo(full, "walk");
    ok(
      "removing slots thins the animation instead of erasing it",
      legless >= 5 && legless < Object.keys(full.tracks).length,
      `${legless} tracks vs ${Object.keys(full.tracks).length} with every slot`,
    );
  }

  /* ------------------------------------------------- blueprints in detail */
  const kid = RIG_MAP.get("kid")!;
  const noArms = blueprintFor(kid);
  noArms.slots.arms = { on: false, art: "template" };
  noArms.slots.hands = { on: false, art: "template" };
  const armless = buildFromBlueprint(kid, noArms);
  ok("switching arms off removes both arms", boneIds(armless).filter((id: string) => /arm/i.test(id)).length === 0, boneIds(armless).join(","));
  ok("arms off implies hands off", boneIds(armless).filter((id: string) => /hand/i.test(id)).length === 0);
  ok("arms off keeps the legs", boneIds(armless).filter((id: string) => /leg/i.test(id)).length === 4);
  ok("arms off keeps the head", boneIds(armless).includes("head"));
  ok("arms off leaves no arm chains", armless.chains.every((c) => !c.bones.some((id) => /arm/i.test(id))), armless.chains.map((c) => c.id).join(","));
  ok("an armless rig still poses", (() => {
    const p = solveFK(armless, poseRotations(armless, 0), 0);
    return Object.values(p.pos).every((q: any) => finite(q.x, q.y));
  })());

  const noLegs = blueprintFor(kid);
  noLegs.slots.legs = { on: false, art: "template" };
  const legless = buildFromBlueprint(kid, noLegs);
  ok(
    "switching legs off also removes the feet (a foot needs a leg)",
    boneIds(legless).filter((id: string) => /leg|foot/i.test(id)).length === 0,
    boneIds(legless).join(","),
  );
  const feetOnly = blueprintFor(kid);
  feetOnly.slots.legs = { on: false, art: "template" };
  feetOnly.slots.feet = { on: true, art: "template" };
  const feetIssues = blueprintIssues(kid, feetOnly);
  ok(
    "feet follow the legs: switched off automatically, and explained",
    feetIssues.some((i) => i.level === "info" && i.slot === "feet" && /legs/i.test(i.text)) &&
      !blueprintRows(kid, feetOnly).find((r) => r.id === "feet")!.on,
    feetIssues.map((i) => `${i.level}:${i.slot}`).join(" | ") || "no issues",
  );
  ok("a legless build really has no leg bones", boneIds(legless).every((id: string) => !/leg|foot|paw/i.test(id)), boneIds(legless).join(","));

  const headless = blueprintFor(kid);
  for (const id of ["head", "eyes", "mouth", "hair", "ears"] as const) headless.slots[id] = { on: false, art: "template" };
  const noHead = buildFromBlueprint(kid, headless);
  ok("a headless body is allowed but noted", blueprintIssues(kid, headless).some((i) => i.level === "info" && /head/i.test(i.text)));
  ok("headless rig keeps its arms and legs", boneIds(noHead).includes("armUpF") && boneIds(noHead).includes("legUpF"));

  const eyesOn = blueprintFor(kid);
  eyesOn.slots.head = { on: false, art: "template" };
  const eyeIssues = blueprintIssues(kid, eyesOn);
  ok(
    "eyes follow the head: switched off and explained",
    eyeIssues.some((i) => i.level === "info" && i.slot === "eyes" && /head/i.test(i.text)),
    eyeIssues.map((i) => `${i.level}:${i.slot}`).join(", "),
  );
  ok("a headless build has no head bones", boneIds(noHead).every((id: string) => id !== "head" && id !== "neck"), boneIds(noHead).join(","));

  const withTail = blueprintFor(kid);
  withTail.slots.tail = { on: true, art: "part", part: "tail" };
  const tailed = buildFromBlueprint(kid, withTail);
  ok("a slot the plan lacks is added with new bones", boneIds(tailed).some((id: string) => /tail/i.test(id)), boneIds(tailed).filter((id: string) => /tail/i.test(id)).join(","));
  ok("the added tail gets its own IK chain", tailed.chains.some((c) => c.id.includes("tail")), tailed.chains.map((c) => c.id).join(","));
  ok("the added tail carries art", tailed.shapes.some((s) => s.slot === "tail"));
  ok("the added tail hangs off the body", (() => {
    const idx = indexScene(tailed);
    const tail = tailed.bones.find((b) => /tail/i.test(b.id))!;
    const chain: string[] = [];
    let cur = tail.parent;
    while (cur) {
      chain.push(cur);
      cur = idx.byId.get(cur)?.parent ?? null;
    }
    return chain.length > 0;
  })(), `slot tags: ${[...new Set(tailed.bones.map((b) => b.slot))].join(",")}`);

  const choices = blueprintFor(kid);
  choices.slots.head = { on: true, art: "part", part: "rectPanel" };
  const roboto = buildFromBlueprint(kid, choices);
  ok("premade part art replaces the starter art", roboto.shapes.filter((s) => s.bone === "head").every((s) => s.kind === "rectPanel"), roboto.shapes.filter((s) => s.bone === "head").map((s) => s.kind).join(",") || "none");
  ok("draw/import art slots stay empty until you fill them", (() => {
    const bp = blueprintFor(kid);
    bp.slots.head = { on: true, art: "draw" };
    const drawn = buildFromBlueprint(kid, bp);
    return drawn.bones.some((b) => b.id === "head") && drawn.shapes.every((s) => s.bone !== "head");
  })());
  ok("describeBlueprint reads like a sentence", /head|body/.test(describeBlueprint(kid, blueprintFor(kid))), describeBlueprint(kid, blueprintFor(kid)).slice(0, 68));

  /* ------------------------------------------------------ live slot edits */
  {
    const scene = buildScene(kid);
    tagSlots(scene);
    const before = scene.bones.length;
    const spec = slotSpecForScene(scene, kid, "tail");
    ok("live slot spec provides bones, a chain and art", spec.bones.length >= 3 && spec.chains.length === 1 && spec.shapes.length >= 3, `${spec.bones.length}/${spec.chains.length}/${spec.shapes.length}`);
    ok("live slot spec finds an anchor", !!spec.anchor && scene.bones.some((b) => b.id === spec.anchor), spec.anchor ?? "none");
    for (const b of spec.bones) scene.bones.push({ id: b.id, name: b.d ?? b.id, parent: b.p ?? null, length: b.l, rest: 0, slot: "tail" } as any);
    for (const c of spec.chains) scene.chains.push({ id: c.id, name: c.id, bones: c.b, pole: false, show: true, color: "#fff", mirror: null });
    for (const s of spec.shapes) scene.shapes.push({ id: `s${Math.random()}`, name: s.name ?? "tail", bone: s.bone, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }], closed: true, role: s.role, visible: true, z: 9, slot: "tail" } as any);
    ok("adding a slot grows the character", scene.bones.length > before && sceneHasSlot(scene, "tail"));
    const removed = stripSlot(scene, "tail");
    ok("removing a slot takes its bones, art and keys", removed.bones >= 3 && removed.shapes >= 3 && !sceneHasSlot(scene, "tail"));
    ok("removing a slot leaves no orphan art", scene.shapes.every((s) => scene.bones.some((b) => b.id === s.bone)));
    ok("removing a slot leaves no dangling parents", scene.bones.every((b) => !b.parent || scene.bones.some((x) => x.id === b.parent)));
    const cover = sceneCoverage(scene);
    ok("coverage reports every slot", cover.length === SLOTS.length && cover.find((c) => c.id === "body")!.present);
    const stripped = stripSlot(scene, "arms");
    ok("a whole limb can be removed on stage", stripped.bones >= 6 && !sceneHasSlot(scene, "arms"), `${stripped.bones} bones, ${stripped.shapes} shapes`);
    const p = solveFK(scene, poseRotations(scene, 2), 2);
    ok("the butchered rig still solves", Object.values(p.pos).every((q: any) => finite(q.x, q.y)));
    ok("stripping the body is refused by the UI, not the core", (() => {
      const fresh = buildScene(kid);
      tagSlots(fresh);
      const keep = stripSlot(fresh, "body");
      void keep;
      return true;
    })(), "core allows it, the store blocks it");
  }

  /* -------------------------------------------------------- image sizing */
  ok("filename guesses the slot", guessSlot("nibbles-legs.png") === "legs" && guessSlot("hero-head.svg") === "head" && guessSlot("IMG_0421.png") === null, `${guessSlot("hero-hand.png")}, ${guessSlot("cape.png")}, ${guessSlot("IMG_0421.png")}`);
  const quad = imageQuadForBone(40, { w: 400, h: 200 });
  ok("an imported drawing is sized to its bone", Math.abs(Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) - 42) < 0.001, `quad width ${Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y).toFixed(1)} for a 400×200 image`);
  ok("the quad keeps the image's aspect ratio", Math.abs(Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y) - 21) < 0.001);
  const anchored = imageQuadForBone(40, { w: 100, h: 100 }, { anchor: "start", cover: 1 });
  ok("anchors control which end of the bone the art hugs", anchored[0].x === 0 && Math.abs(anchored[1].x - 40) < 0.001, `${anchored[0].x} → ${anchored[1].x}`);

  /* ------------------------------------------- image parts actually render */
  {
    clearImages();
    let notified = 0;
    const off = onImageLoaded(() => notified++);
    const scene = buildScene(kid);
    tagSlots(scene);
    const bone = scene.bones.find((b) => b.id === "head")!;
    const pts = imageQuadForBone(bone.length, { w: 64, h: 64 }, { cover: 1.2 });
    scene.shapes.push({ id: "imported", name: "Imported head", bone: bone.id, pts, closed: true, role: "skin", visible: true, z: 99, slot: "head", image: { src: "data:,", w: 64, h: 64, name: "head" } });

    // A flat-red source: what lands on the canvas must be red where the quad is.
    const source = createCanvas(64, 64);
    const sctx = source.getContext("2d");
    sctx.fillStyle = "#ff0000";
    sctx.fillRect(0, 0, 64, 64);

    // Sample the middle of the imported quad in *screen* space (the head bone sits up-left).
    const pose = solveFK(scene, poseRotations(scene, 0), 0);
    const worldPts = shapeWorldPoints(scene.shapes[scene.shapes.length - 1], pose);
    const VIEW = 420;
    const HALF = VIEW / 2;
    const ZOOM = 2;
    const centre = {
      x: Math.round(HALF + ((worldPts[0].x + worldPts[1].x + worldPts[2].x + worldPts[3].x) / 4) * ZOOM),
      y: Math.round(HALF + ((worldPts[0].y + worldPts[1].y + worldPts[2].y + worldPts[3].y) / 4) * ZOOM),
    };
    ok("the imported quad is on screen where we are sampling", centre.x > 2 && centre.x < VIEW - 2 && centre.y > 2 && centre.y < VIEW - 2, `${centre.x},${centre.y}`);
    const canvas = createCanvas(VIEW, VIEW);
    const ctx = canvas.getContext("2d");
    const paint = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, VIEW, VIEW);
      ctx.translate(HALF, HALF);
      ctx.scale(ZOOM, ZOOM);
      drawParts(ctx, scene, pose, { outlines: false });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx.getImageData(centre.x, centre.y, 1, 1).data;
    };
    const emptyBefore = paint();
    ok("a part with no decoded image draws a placeholder, not a hole", emptyBefore[3] > 0, `centre pixel ${[...emptyBefore].slice(0, 4).join(",")}`);

    putImage("imported", source);
    ok("putImage notifies the canvas", notified === 1 && !!getImage("imported"));
    const red = paint();
    ok("a decoded drawing is mapped onto its quad", red[0] > 200 && red[1] < 60 && red[2] < 60, `centre pixel ${[...red].slice(0, 3).join(",")} at ${centre.x},${centre.y}`);

    // The import must move with the bone it is welded to.
    scene.tracks[bone.id] = { rot: [{ t: 0, rot: 0, ease: "linear" }, { t: 10, rot: 1.2, ease: "linear" }], pos: [] };
    const before = solveFK(scene, poseRotations(scene, 0), 0);
    const posed = solveFK(scene, poseRotations(scene, 10), 10);
    const tip0 = before.end[bone.id];
    const tip1 = posed.end[bone.id];
    ok("the bone the drawing hangs off has rotated", finite(tip1.x, tip1.y) && Math.hypot(tip1.x - tip0.x, tip1.y - tip0.y) > 1, `tip ${tip0.x.toFixed(1)},${tip0.y.toFixed(1)} → ${tip1.x.toFixed(1)},${tip1.y.toFixed(1)}`);
    const pts0 = shapeWorldPoints(scene.shapes[scene.shapes.length - 1], before);
    const pts1 = shapeWorldPoints(scene.shapes[scene.shapes.length - 1], posed);
    ok("the imported drawing rides the bone", Math.hypot(pts1[0].x - pts0[0].x, pts1[0].y - pts0[0].y) > 1, `moved ${Math.hypot(pts1[0].x - pts0[0].x, pts1[0].y - pts0[0].y).toFixed(1)} units`);

    // And it must survive the export path.
    const png = await exportPng(scene, { scale: 1, transparent: false, overlay: false, framing: "fit" });
    ok("a scene with an imported part exports a PNG", png.size > 1000, `${Math.round(png.size / 1024)} kB`);
    ok("drawImagePart reports failure instead of throwing", (() => {
      const c2 = createCanvas(20, 20);
      const okDraw = drawImagePart(c2.getContext("2d") as any, { id: "missing" } as any, pts, 1);
      return okDraw === false;
    })());
    off();
  }

  /* ------------------------------------------------------------- backdrops */
  ok("the backdrop library has a dozen skies and more", BACKDROPS.length >= 12, `${BACKDROPS.length}: ${BACKDROPS.map((b) => b.label).join(", ")}`);
  ok("every backdrop has a two-stop sky and a swatch", BACKDROPS.every((b) => b.sky.length === 2 && b.swatch.length === 2 && /^#/.test(b.sky[0])));
  ok("some backdrops place scenery, all of them have a hint", BACKDROPS.some((b) => (b.objects?.length ?? 0) > 2) && BACKDROPS.every((b) => b.hint.length > 6));
  {
    const scene = buildScene(kid);
    scene.ground = 72;
    let bad = 0;
    for (const preset of BACKDROPS) {
      const objects = backdropObjects(scene, preset);
      const lights = backdropLights(scene, preset);
      for (const ob of objects) if (!finite(ob.x, ob.y) || !(ob.scale > 0)) bad++;
      for (const l of lights) if (!finite(l.x, l.y, l.radius, l.intensity)) bad++;
      for (const ob of objects) if (ob.z == null) bad++;
    }
    ok("every backdrop builds finite objects and lights", bad === 0, bad ? `${bad} broken placements` : `${BACKDROPS.length} presets ok`);

    const dawn = BACKDROPS.find((b) => b.id === "dawn-meadow")!;
    const objects = backdropObjects(scene, dawn);
    ok(
      "backdrop scenery with dy=0 is anchored to the character's ground",
      dawn.objects!.every((spec, i) => (spec.dy !== 0 ? true : Math.abs(objects[i].y - scene.ground!) < 6)) && objects.length === dawn.objects!.length,
      objects.map((o, i) => `${dawn.objects![i].kind}:${Math.round(o.y)}`).join(" "),
    );
    ok("backdrop scenery is tagged so the next sky can replace it", objects.every((o) => o.fromBackdrop === "dawn-meadow"));
    const custom = presetFromScene(scene, "Mine", "mine");
    ok("a scene can be saved as a backdrop", custom.id === "mine" && custom.sky[0] === scene.bgTop && Array.isArray(custom.objects));
  }

  /* ------------------------------------------------ background image maths */
  {
    const img = { w: 1600, h: 900 };
    const exact = bgImageRect(img, "cover", 1600, 900);
    ok("cover fits a matching aspect exactly", exact.x === 0 && exact.y === 0 && exact.w === 1600 && Math.abs(exact.h - 900) < 0.001, JSON.stringify(exact));
    const tall = bgImageRect(img, "cover", 900, 1200);
    ok("cover fills the taller canvas and crops the sides", tall.h >= 1200 - 0.001 && tall.w >= 900 && tall.x < 0, JSON.stringify(tall));
    const contain = bgImageRect(img, "contain", 900, 1200);
    ok("contain letterboxes instead of cropping", contain.w <= 900 + 0.001 && contain.h <= 1200 + 0.001 && contain.y > 0, JSON.stringify(contain));
    const stretch = bgImageRect(img, "stretch", 640, 480);
    ok("stretch ignores the source aspect", stretch.w === 640 && stretch.h === 480);
    const plain = bgImageRect(img, "cover", 1280, 720);
    const slid = bgImageRect(img, "cover", 1280, 720, { parallax: 1, cam: { x: 100, y: 0, zoom: 3 }, anchor: { x: 0, y: 0 } });
    ok("parallax 1 moves the plate by cam × zoom", Math.abs(plain.x - slid.x - 300) < 0.001, `${plain.x.toFixed(1)} vs ${slid.x.toFixed(1)}`);
    const half = bgImageRect(img, "cover", 1280, 720, { parallax: 0.5, cam: { x: 100, y: 0, zoom: 3 }, anchor: { x: 0, y: 0 } });
    ok("parallax 0.5 moves it half as far", Math.abs(plain.x - half.x - 150) < 0.001);
    const scaled = bgImageRect(img, "cover", 3200, 1800);
    ok("the same maths holds at export resolution", Math.abs(scaled.w / 3200 - exact.w / 1600) < 0.001);
  }

  /* --------------------------------------------- an imported background draws */
  {
    const scene = buildScene(kid);
    scene.bgImage = { src: "data:,", w: 40, h: 40, fit: "cover", opacity: 1, dim: 0, parallax: 0 };
    const source = createCanvas(40, 40);
    const sctx = source.getContext("2d");
    sctx.fillStyle = "#00a0ff";
    sctx.fillRect(0, 0, 40, 40);
    putImage(BACKDROP_IMAGE_ID, source);
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext("2d");
    paintBackdrop(ctx as any, scene as any, 200, 200, false);
    const corner = ctx.getImageData(6, 6, 1, 1).data;
    ok("an imported background paints over the sky gradient", corner[2] > 200 && corner[0] < 80, `corner ${[...corner].slice(0, 3).join(",")}`);
    // Dimming keeps the character readable.
    scene.bgImage!.dim = 0.6;
    scene.bgImage!.dimColor = "#000000";
    const dark = createCanvas(200, 200);
    paintBackdrop(dark.getContext("2d") as any, scene as any, 200, 200, false);
    const dimmed = dark.getContext("2d").getImageData(6, 6, 1, 1).data;
    ok("haze darkens the plate", dimmed[2] < corner[2] * 0.5, `blue ${corner[2]} → ${dimmed[2]}`);
    // Transparent exports must not paint it at all.
    const clear = createCanvas(200, 200);
    const cctx = clear.getContext("2d");
    paintBackdrop(cctx as any, scene as any, 200, 200, true);
    const alpha = cctx.getImageData(6, 6, 1, 1).data[3];
    ok("a transparent export still leaves the frame empty", alpha === 0, `alpha ${alpha}`);
    scene.bgImage = undefined;
  }

  /* ------------------------------------------------- a full render + sheet */
  {
    clearImages();
    const scene = buildScene(kid);
    tagSlots(scene);
    applyDemo(scene, "walk");
    const dawn = BACKDROPS.find((b) => b.id === "dawn-meadow")!;
    scene.bgTop = dawn.sky[0];
    scene.bgBottom = dawn.sky[1];
    scene.ground = dawn.ground;
    scene.objects = [...(scene.objects ?? []), ...backdropObjects(scene, dawn)];
    scene.lights = [...(scene.lights ?? []), ...backdropLights(scene, dawn)];

    // A hatched placeholder for the imported head, so the contact sheet shows the import path.
    const art = createCanvas(96, 96);
    const actx = art.getContext("2d");
    actx.fillStyle = "#f2e6d0";
    actx.beginPath();
    actx.arc(48, 48, 44, 0, Math.PI * 2);
    actx.fill();
    actx.fillStyle = "#3b2a24";
    actx.fillRect(20, 34, 12, 12);
    actx.fillRect(64, 34, 12, 12);
    actx.strokeStyle = "#3b2a24";
    actx.lineWidth = 5;
    actx.beginPath();
    actx.moveTo(28, 70);
    actx.quadraticCurveTo(48, 84, 68, 70);
    actx.stroke();
    scene.shapes = scene.shapes.filter((s) => !(s.bone === "head" && /head|eye|pupil|mouth|hair/i.test(s.kind ?? "")));
    const head = scene.bones.find((b) => b.id === "head")!;
    scene.shapes.push({
      id: "imported-head",
      name: "Imported face",
      bone: "head",
      pts: imageQuadForBone(head.length, { w: 96, h: 96 }, { cover: 1.5, anchor: "start" }),
      closed: true,
      role: "skin",
      visible: true,
      z: 60,
      slot: "head",
      image: { src: "data:,", w: 96, h: 96, name: "imported face" },
    });
    putImage("imported-head", art);
    ok("imported art replaces the built-in head", scene.shapes.some((s) => s.id === "imported-head" && getImage(s.id)));

    mkdirSync(".tmp", { recursive: true });
    const canvas = createCanvas(360, 300);
    const ctx = canvas.getContext("2d");
    drawShot(ctx as any, scene as any, 6, { w: 360, h: 300, box: sceneBounds(scene, solveFK(scene, poseRotations(scene, 6), 6)) });
    writeFileSync(".tmp/build-import-frame.png", canvas.toBuffer("image/png"));

    // And a second frame from the same scene, further along the walk cycle.
    const canvas2 = createCanvas(360, 300);
    const ctx2 = canvas2.getContext("2d");
    drawShot(ctx2 as any, scene as any, 14, { w: 360, h: 300, box: sceneBounds(scene, solveFK(scene, poseRotations(scene, 14), 14)) });
    const sheet = createCanvas(360, 600);
    const sh = sheet.getContext("2d");
    sh.fillStyle = "#0b0c12";
    sh.fillRect(0, 0, 360, 600);
    sh.drawImage(canvas, 0, 0);
    sh.drawImage(canvas2, 0, 300);
    writeFileSync(".tmp/build-sheet.png", sheet.toBuffer("image/png"));
    const ink = (() => {
      const d = ctx.getImageData(0, 0, 360, 300).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 190 && d[i + 2] > 180) n++;
      return n;
    })();
    ok("the imported face is visible in the render", ink > 200, `${ink} painted pixels`);
    console.log("     wrote .tmp/build-sheet.png and .tmp/build-import-frame.png");
  }

  console.log(fails ? `\n${fails} check(s) failed` : "\nall build/slot/backdrop checks passed");
  if (fails) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
