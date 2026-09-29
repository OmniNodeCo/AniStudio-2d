/**
 * Backdrops: ready-made skies, and the maths for a custom background image.
 *
 * A preset is deliberately cheap — two gradient colours, a ground line, and an optional recipe
 * of scenery objects and lights placed relative to the character. Choosing one is a single
 * click; the scenery recipe is applied separately so you can take the sky without the trees.
 */
import { makeLight, makeObject } from "./scenery";
import type { Light, LightKind, Scene, SceneObject, SceneryKind } from "./types";

export interface BackdropObject {
  kind: SceneryKind;
  /** World-unit offset from the character's root. */
  dx: number;
  /** Height above the ground line (negative = floating, for clouds and birds). */
  dy: number;
  scale?: number;
  z?: number;
  seed?: number;
}

export interface BackdropLight {
  kind: LightKind;
  dx: number;
  dy: number;
  color?: string;
  intensity?: number;
  radius?: number;
  flicker?: number;
}

export interface BackdropPreset {
  id: string;
  label: string;
  hint: string;
  /** Sky gradient, top → bottom. */
  sky: [string, string];
  /** Ground line in world units, or null for a floating/space scene. */
  ground: number | null;
  /** Sky and ground colours for the picker's swatch. */
  swatch: [string, string];
  objects?: BackdropObject[];
  lights?: BackdropLight[];
}

export const BACKDROPS: BackdropPreset[] = [
  {
    id: "studio",
    label: "Studio grey",
    hint: "Neutral backdrop · soft floor light",
    sky: ["#3a3d4a", "#191b23"],
    ground: 78,
    swatch: ["#3a3d4a", "#191b23"],
    lights: [{ kind: "spot", dx: -40, dy: -220, color: "#fff4e0", intensity: 0.5, radius: 520 }],
  },
  {
    id: "dawn-meadow",
    label: "Dawn meadow",
    hint: "Warm horizon · hills and grass",
    sky: ["#ffb27a", "#3d2a55"],
    ground: 76,
    swatch: ["#ffb27a", "#3d2a55"],
    objects: [
      { kind: "hill", dx: -320, dy: 0, scale: 1.5, z: 0, seed: 3 },
      { kind: "hill", dx: 260, dy: 0, scale: 1.9, z: 0, seed: 7 },
      { kind: "sun", dx: -120, dy: -300, scale: 1.2, z: 0 },
      { kind: "grass", dx: -60, dy: 0, scale: 1.2, z: 1, seed: 11 },
      { kind: "flower", dx: 90, dy: 0, scale: 1.1, z: 1, seed: 5 },
    ],
    lights: [{ kind: "warm", dx: -140, dy: -280, color: "#ffd9a0", intensity: 0.55, radius: 700 }],
  },
  {
    id: "bright-day",
    label: "Bright day",
    hint: "Blue sky · clouds · full sun",
    sky: ["#7fc4ff", "#dff0ff"],
    ground: 80,
    swatch: ["#7fc4ff", "#dff0ff"],
    objects: [
      { kind: "cloud", dx: -240, dy: -250, scale: 1.3, z: 0, seed: 2 },
      { kind: "cloud", dx: 170, dy: -190, scale: 1, z: 0, seed: 9 },
      { kind: "flying-bird", dx: 60, dy: -230, scale: 1, z: 0, seed: 4 },
      { kind: "tree", dx: -230, dy: 0, scale: 1.2, z: 1, seed: 6 },
      { kind: "grass", dx: 40, dy: 0, scale: 1.3, z: 1, seed: 13 },
    ],
    lights: [{ kind: "sun", dx: 240, dy: -320, color: "#fff3cf", intensity: 0.7, radius: 760 }],
  },
  {
    id: "sunset-beach",
    label: "Sunset beach",
    hint: "Orange sky · sea and palms",
    sky: ["#ff8f5e", "#2b2a55"],
    ground: 84,
    swatch: ["#ff8f5e", "#2b2a55"],
    objects: [
      { kind: "sun", dx: 210, dy: -150, scale: 1.5, z: 0 },
      { kind: "pond", dx: -280, dy: 6, scale: 1.7, z: 1, seed: 8 },
      { kind: "palm", dx: 190, dy: 0, scale: 1.2, z: 1, seed: 3 },
      { kind: "rock", dx: -60, dy: 0, scale: 1.1, z: 1, seed: 5 },
    ],
    lights: [{ kind: "warm", dx: 180, dy: -160, color: "#ffb066", intensity: 0.6, radius: 720 }],
  },
  {
    id: "night-city",
    label: "Night city",
    hint: "Skyline · streetlamp · cool moon",
    sky: ["#1b2140", "#080a16"],
    ground: 78,
    swatch: ["#1b2140", "#080a16"],
    objects: [
      { kind: "starfield", dx: 0, dy: -280, scale: 2.4, z: 0, seed: 12 },
      { kind: "moon", dx: -230, dy: -270, scale: 1, z: 0 },
      { kind: "skyline", dx: -120, dy: 0, scale: 1.7, z: 0, seed: 15 },
      { kind: "streetlamp", dx: 130, dy: 0, scale: 1.2, z: 1 },
      { kind: "fence", dx: -200, dy: 0, scale: 1.1, z: 1 },
    ],
    lights: [
      { kind: "moon", dx: -220, dy: -260, color: "#bcd4ff", intensity: 0.42, radius: 760 },
      { kind: "warm", dx: 128, dy: -170, color: "#ffcc7a", intensity: 0.5, radius: 240, flicker: 0.1 },
    ],
  },
  {
    id: "deep-space",
    label: "Deep space",
    hint: "Stars, no floor · drifting glow",
    sky: ["#241a4a", "#05040f"],
    ground: null,
    swatch: ["#241a4a", "#05040f"],
    objects: [
      { kind: "starfield", dx: 0, dy: -120, scale: 3, z: 0, seed: 21 },
      { kind: "mountain", dx: -240, dy: 240, scale: 1.4, z: 0, seed: 2 },
    ],
    lights: [{ kind: "glow", dx: 0, dy: -60, color: "#9a7bff", intensity: 0.5, radius: 620 }],
  },
  {
    id: "snowy-peaks",
    label: "Snowy peaks",
    hint: "Cold light · mountains and pines",
    sky: ["#bcd8ff", "#eef6ff"],
    ground: 82,
    swatch: ["#bcd8ff", "#eef6ff"],
    objects: [
      { kind: "mountain", dx: -220, dy: 0, scale: 2.1, z: 0, seed: 4 },
      { kind: "mountain", dx: 180, dy: 0, scale: 1.6, z: 0, seed: 9 },
      { kind: "pine", dx: -120, dy: 0, scale: 1.1, z: 1, seed: 6 },
      { kind: "pine", dx: 120, dy: 0, scale: 1.3, z: 1, seed: 14 },
    ],
    lights: [{ kind: "cool", dx: -60, dy: -300, color: "#dbeaff", intensity: 0.5, radius: 780 }],
  },
  {
    id: "forest",
    label: "Deep forest",
    hint: "Green canopy · dappled light",
    sky: ["#2f5a3a", "#0e1b13"],
    ground: 80,
    swatch: ["#2f5a3a", "#0e1b13"],
    objects: [
      { kind: "tree", dx: -260, dy: 0, scale: 1.8, z: 0, seed: 3 },
      { kind: "tree", dx: 250, dy: 0, scale: 2, z: 0, seed: 8 },
      { kind: "bush", dx: -80, dy: 0, scale: 1.3, z: 1, seed: 5 },
      { kind: "bush", dx: 110, dy: 0, scale: 1.1, z: 1, seed: 17 },
      { kind: "grass", dx: 0, dy: 0, scale: 1.4, z: 1, seed: 2 },
    ],
    lights: [{ kind: "warm", dx: -40, dy: -260, color: "#cdf5a0", intensity: 0.4, radius: 560 }],
  },
  {
    id: "desert",
    label: "Desert mesa",
    hint: "Hot sky · cacti and rock",
    sky: ["#ffd79a", "#e08a4a"],
    ground: 84,
    swatch: ["#ffd79a", "#e08a4a"],
    objects: [
      { kind: "hill", dx: -260, dy: 0, scale: 1.6, z: 0, seed: 4 },
      { kind: "mountain", dx: 220, dy: 0, scale: 1.3, z: 0, seed: 8 },
      { kind: "cactus", dx: -90, dy: 0, scale: 1.2, z: 1, seed: 3 },
      { kind: "rock", dx: 140, dy: 0, scale: 1.2, z: 1, seed: 9 },
      { kind: "barrel", dx: 210, dy: 0, scale: 1, z: 1, seed: 5 },
    ],
    lights: [{ kind: "sun", dx: -160, dy: -320, color: "#fff0c0", intensity: 0.66, radius: 820 }],
  },
  {
    id: "underwater",
    label: "Underwater",
    hint: "Blue-green haze · drifting plants",
    sky: ["#2f9fc0", "#0a3550"],
    ground: 88,
    swatch: ["#2f9fc0", "#0a3550"],
    objects: [
      { kind: "bush", dx: -160, dy: 0, scale: 1.4, z: 1, seed: 4 },
      { kind: "bush", dx: 150, dy: 0, scale: 1.2, z: 1, seed: 12 },
      { kind: "rock", dx: 0, dy: 0, scale: 1.4, z: 1, seed: 6 },
      { kind: "flying-bird", dx: -80, dy: -220, scale: 1.2, z: 0, seed: 3 },
    ],
    lights: [{ kind: "cool", dx: 0, dy: -320, color: "#a6f2ff", intensity: 0.55, radius: 700 }],
  },
  {
    id: "village",
    label: "Village evening",
    hint: "Houses, windmill, warm windows",
    sky: ["#6d7fd0", "#2a2a52"],
    ground: 80,
    swatch: ["#6d7fd0", "#2a2a52"],
    objects: [
      { kind: "hill", dx: -300, dy: 0, scale: 1.4, z: 0, seed: 2 },
      { kind: "house", dx: -140, dy: 0, scale: 1.2, z: 1, seed: 4 },
      { kind: "house", dx: 40, dy: 0, scale: 1.4, z: 1, seed: 8 },
      { kind: "windmill", dx: 240, dy: 0, scale: 1.3, z: 1, seed: 3 },
      { kind: "fence", dx: -230, dy: 0, scale: 1.1, z: 1 },
      { kind: "campfire", dx: 150, dy: 0, scale: 1, z: 1, seed: 5 },
    ],
    lights: [
      { kind: "warm", dx: 0, dy: -300, color: "#ffc98a", intensity: 0.4, radius: 720 },
      { kind: "fire", dx: 150, dy: -14, color: "#ff9a3c", intensity: 0.7, radius: 200, flicker: 0.45 },
    ],
  },
  {
    id: "cave",
    label: "Lava cave",
    hint: "Dark rock · glowing pool",
    sky: ["#3a1b2a", "#120812"],
    ground: 84,
    swatch: ["#3a1b2a", "#120812"],
    objects: [
      { kind: "rock", dx: -220, dy: 0, scale: 1.6, z: 0, seed: 5 },
      { kind: "rock", dx: 230, dy: 0, scale: 1.4, z: 0, seed: 11 },
      { kind: "pond", dx: 0, dy: 8, scale: 1.3, z: 1, seed: 7 },
    ],
    lights: [
      { kind: "fire", dx: 0, dy: -12, color: "#ff6a2a", intensity: 0.7, radius: 460, flicker: 0.5 },
      { kind: "glow", dx: 0, dy: -220, color: "#7a2d5c", intensity: 0.3, radius: 600 },
    ],
  },
  {
    id: "paper",
    label: "Paper white",
    hint: "Clean sheet for sharing · no floor tint",
    sky: ["#fdfdff", "#e6e8f5"],
    ground: 84,
    swatch: ["#fdfdff", "#e6e8f5"],
    lights: [],
  },
  {
    id: "neon",
    label: "Neon arcade",
    hint: "Magenta haze · glowing grid",
    sky: ["#43126e", "#0b0620"],
    ground: 82,
    swatch: ["#43126e", "#0b0620"],
    objects: [
      { kind: "skyline", dx: -80, dy: 0, scale: 1.5, z: 0, seed: 19 },
      { kind: "sign", dx: 170, dy: 0, scale: 1.2, z: 1, seed: 6 },
      { kind: "streetlamp", dx: -200, dy: 0, scale: 1.2, z: 1 },
    ],
    lights: [
      { kind: "glow", dx: -120, dy: -220, color: "#ff4fd8", intensity: 0.6, radius: 620 },
      { kind: "glow", dx: 160, dy: -180, color: "#4ff0ff", intensity: 0.55, radius: 560 },
    ],
  },
];

export const BACKDROP_MAP = new Map(BACKDROPS.map((b) => [b.id, b]));

export const backdropDef = (id?: string | null): BackdropPreset | undefined => (id ? BACKDROP_MAP.get(id) : undefined);

/** Where a preset's scenery should be placed for the current character. */
export function backdropAnchor(scene: Scene): { x: number; y: number } {
  return { x: scene.root.x, y: scene.ground ?? scene.root.y + 80 };
}

/** Objects a preset places — build them now so the panel can preview counts/labels. */
export function backdropObjects(scene: Scene, preset: BackdropPreset): SceneObject[] {
  const at = backdropAnchor(scene);
  return (preset.objects ?? []).map((o, i) =>
    ({
      ...makeObject(o.kind, at.x + o.dx, at.y + o.dy, o.seed ?? i + 1),
      scale: o.scale ?? 1,
      z: o.z ?? 1,
      fromBackdrop: preset.id,
    }) as SceneObject,
  );
}

export function backdropLights(scene: Scene, preset: BackdropPreset): Light[] {
  const at = backdropAnchor(scene);
  return (preset.lights ?? []).map((l) => {
    const light = makeLight(l.kind, at.x + l.dx, at.y + l.dy);
    if (l.color) light.color = l.color;
    if (l.intensity != null) light.intensity = l.intensity;
    if (l.radius != null) light.radius = l.radius;
    if (l.flicker) light.flicker = l.flicker;
    light.fromBackdrop = preset.id;
    return light;
  });
}

/* ------------------------------------------------------------ background image */

export type BgFit = "cover" | "contain" | "stretch";

export interface BackdropImage {
  src: string;
  /** Natural size of the imported file, used for cover/contain maths. */
  w: number;
  h: number;
  fit: BgFit;
  /** 0 … 1, multiplied into the backdrop. */
  opacity?: number;
  /** 0 … 1 darkening/haze over the image so the character keeps contrast. */
  dim?: number;
  /** Tint painted over the image (usually the sky colour). */
  dimColor?: string;
  /** 0 = locked to the screen (a painted backdrop), 1 = locked to the world (a matte). */
  parallax?: number;
  /** Flip horizontally — handy for left/right versions of the same art. */
  flip?: boolean;
  /** Vertical nudge as a fraction of the canvas height. */
  offsetY?: number;
}

/**
 * Screen rectangle for a background image. `w`/`h` are the canvas size; the maths is the same
 * for the editor view and a 4K export, so a backdrop looks identical everywhere.
 */
export function bgImageRect(
  img: { w: number; h: number },
  fit: BgFit,
  w: number,
  h: number,
  o: { parallax?: number; cam?: { x: number; y: number; zoom: number }; anchor?: { x: number; y: number }; scale?: number } = {},
) {
  const iw = Math.max(1, img.w);
  const ih = Math.max(1, img.h);
  const k = fit === "stretch" ? 1 : fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = fit === "stretch" ? w : iw * k;
  const dh = fit === "stretch" ? h : ih * k;
  const parallax = o.parallax ?? 0;
  let dx = (w - dw) / 2;
  let dy = (h - dh) / 2;
  if (parallax > 0 && o.cam) {
    const anchor = o.anchor ?? { x: 0, y: 0 };
    // The view is centred on `cam` at `zoom`; move the plate against that motion.
    dx -= (o.cam.x - anchor.x) * o.cam.zoom * parallax;
    dy -= (o.cam.y - anchor.y) * o.cam.zoom * parallax;
  }
  return { x: dx, y: dy, w: dw, h: dh };
}

/** Paint a background image into a canvas of `w`×`h`. Returns false when it cannot be drawn. */
export function paintBackdropImage(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  w: number,
  h: number,
  source: CanvasImageSource | null,
  view?: { cam: { x: number; y: number; zoom: number } },
): boolean {
  const bg = scene.bgImage;
  if (!bg || !source) return false;
  const rect = bgImageRect(bg, bg.fit ?? "cover", w, h, {
    parallax: bg.parallax ?? 0,
    cam: view?.cam,
    anchor: scene.root,
  });
  ctx.save();
  ctx.globalAlpha = bg.opacity ?? 1;
  if (bg.flip) {
    // Mirror around the plate's own centre so the framing does not jump.
    ctx.translate(rect.x + rect.w, rect.y + (bg.offsetY ?? 0) * h);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, rect.w, rect.h);
  } else {
    ctx.drawImage(source, rect.x, rect.y + (bg.offsetY ?? 0) * h, rect.w, rect.h);
  }
  if (bg.dim) {
    ctx.globalAlpha = bg.dim;
    ctx.fillStyle = bg.dimColor ?? scene.bgTop;
    ctx.fillRect(rect.x, rect.y + (bg.offsetY ?? 0) * h, rect.w, rect.h);
  }
  ctx.restore();
  return true;
}

/** Sky/floor colours of a preset, ready to drop into a scene. */
export const backdropColors = (preset: BackdropPreset) => ({ bgTop: preset.sky[0], bgBottom: preset.sky[1] });

/** A user preset made from whatever the scene looks like right now. */
export function presetFromScene(scene: Scene, label: string, id: string, hint = "saved from your scene"): BackdropPreset {
  return {
    id,
    label,
    hint,
    sky: [scene.bgTop, scene.bgBottom],
    ground: scene.ground,
    swatch: [scene.bgTop, scene.bgBottom],
    lights: (scene.lights ?? []).map((l) => ({
      kind: l.kind,
      dx: Math.round(l.x - scene.root.x),
      dy: Math.round(l.y - (scene.ground ?? scene.root.y)),
      color: l.color,
      intensity: l.intensity,
      radius: l.radius,
      flicker: l.flicker,
    })),
    objects: (scene.objects ?? []).map((o) => ({
      kind: o.kind,
      dx: Math.round(o.x - scene.root.x),
      dy: Math.round(o.y - (scene.ground ?? scene.root.y)),
      scale: o.scale,
      z: o.z,
      seed: o.seed,
    })),
  };
}
