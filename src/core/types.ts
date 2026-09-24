import type { Ease, Vec } from "./math";

/** A bone: a joint at its start, `length` long, resting at `rest` relative to its parent. */
export interface Bone {
  id: string;
  name: string;
  parent: string | null;
  length: number;
  /** Rest angle in radians, relative to the parent bone's direction. */
  rest: number;
  /** Local rotation limits (radians, relative to rest). Prevents broken elbows. */
  min?: number;
  max?: number;
  /** Id of the mirrored twin bone (for X-symmetric posing). */
  mirror?: string | null;
  /** IK chain this bone belongs to, if any. */
  chain?: string | null;
  /** Visual thickness of the drawn bone. */
  w?: number;
  hide?: boolean;
}

export interface Keyframe {
  /** Frame index (integer). */
  t: number;
  /** Local rotation in radians, relative to rest. */
  rot: number;
  /** Easing applied to the segment that *starts* at this key. */
  ease: Ease;
}

export interface PosKey {
  t: number;
  x: number;
  y: number;
  ease: Ease;
}

export interface Track {
  rot: Keyframe[];
  pos: PosKey[];
}

export type RoleKey = "skin" | "cloth" | "cloth2" | "hair" | "accent" | "dark" | "white" | "shoe" | "eye";

export const ROLES: RoleKey[] = ["skin", "cloth", "cloth2", "hair", "accent", "dark", "white", "shoe", "eye"];

/** A vector shape glued to a bone, in that bone's local space. */
export interface ShapePart {
  id: string;
  name: string;
  bone: string;
  pts: Vec[];
  closed: boolean;
  /** Sharp corners (default is soft/rounded, which looks nicer for characters). */
  sharp?: boolean;
  /** Palette role — lets one click recolor the whole character. */
  role?: RoleKey;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  visible: boolean;
  z: number;
  /** Part factory id, so parts can be re-fit when a bone is resized. */
  kind?: string;
}

export interface IKChain {
  id: string;
  name: string;
  /** Ordered root → tip, each a direct child of the previous. */
  bones: string[];
  /** Show a pole (elbow / knee) handle. */
  pole: boolean;
  /** Chain drives a foot/hand that stays planted (adds a ground hint). */
  show: boolean;
  color: string;
  mirror?: string | null;
}

export interface Pose {
  name: string;
  rot: Record<string, number>;
  pos?: Record<string, Vec>;
}

/* ------------------------------------------------------------------ scenery */

export type SceneryKind =
  | "hill"
  | "mountain"
  | "pine"
  | "tree"
  | "bush"
  | "palm"
  | "cactus"
  | "rock"
  | "flower"
  | "grass"
  | "cloud"
  | "starfield"
  | "sun"
  | "moon"
  | "skyline"
  | "house"
  | "windmill"
  | "lighthouse"
  | "fence"
  | "sign"
  | "streetlamp"
  | "pond"
  | "campfire"
  | "barrel"
  | "flying-bird";

/** A prop, plant, building or backdrop element placed in the scene. */
export interface SceneObject {
  id: string;
  name: string;
  kind: SceneryKind;
  /** Anchor position in world space (the object's base, in units). */
  x: number;
  y: number;
  /** Uniform scale (1 = the catalog's default size). */
  scale: number;
  /** Rotation in radians about the anchor. */
  rot: number;
  /** Draw order: below 1 paints behind the character, 1 and above in front of it. */
  z: number;
  /** Palette role used for the object's main colour. */
  role?: RoleKey;
  /** Explicit override for the main colour. */
  color?: string;
  /** Secondary colour (roofs, trunks, snow, windows…). */
  color2?: string;
  /** Random seed so a forest does not look cloned. */
  seed?: number;
  /** Opacity multiplier. */
  opacity?: number;
  visible: boolean;
}

/* ------------------------------------------------------------------- lights */

export type LightKind = "sun" | "moon" | "warm" | "cool" | "spot" | "fire" | "glow";

/**
 * A scene light. All kinds are cheap 2D tricks: a vignette/gradient wash painted over the
 * backdrop plus an additive glow painted over the character — no shading pass, no noise.
 */
export interface Light {
  id: string;
  name: string;
  kind: LightKind;
  x: number;
  y: number;
  /** Light colour. */
  color: string;
  /** 0 … 2 — how much of the scene this light owns. */
  intensity: number;
  /** Glow radius in world units. */
  radius: number;
  /** Extra flicker (campfires, fireworks). */
  flicker?: number;
  /** For spots: the direction the cone points, radians. */
  angle?: number;
  /** For spots: half-width of the cone, radians. */
  spread?: number;
  /** Follow this object/bone: light tracks its anchor. */
  follow?: string | null;
  visible: boolean;
}

/* ----------------------------------------------------------------- cameras */

export interface CamKey {
  t: number;
  x: number;
  y: number;
  /** Larger = closer. Pixels of screen per world unit at the camera's own size. */
  zoom: number;
  ease: Ease;
}

/** One continuous take: frames `start` … `end` are rendered from this camera. */
export interface Shot {
  start: number;
  end: number;
}

export interface Camera {
  id: string;
  name: string;
  /** Centre of the framed area, world space. */
  x: number;
  y: number;
  zoom: number;
  /** Frames owned by this camera. Non-overlapping; gaps fall through to the last shot. */
  shots: Shot[];
  /** Animated camera (push in, pan, truck). Empty = locked-off. */
  keys: CamKey[];
  visible: boolean;
}

export interface Scene {
  name: string;
  fps: number;
  /** Total frames; frame indices are 0 … frames-1. */
  frames: number;
  loop: boolean;
  bones: Bone[];
  tracks: Record<string, Track>;
  shapes: ShapePart[];
  chains: IKChain[];
  palette: Record<RoleKey, string>;
  outline: string;
  bgTop: string;
  bgBottom: string;
  /** World-space y of the ground line, or null for no ground. */
  ground: number | null;
  rigId?: string;
  /** World-space position of the rig root (hips) at rest. */
  root: Vec;
  /** Rest rotation of the whole rig, radians (drag the character around the set). */
  rootRot?: number;
  /** Scenery: hills, trees, buildings, clouds … */
  objects?: SceneObject[];
  /** Lights: sun, moon, torches, spotlights … */
  lights?: Light[];
  /** Cameras. When one is active its shots drive framing *and* timeline sampling. */
  cameras?: Camera[];
  /** Id of the camera currently framing the stage (null = free view / no cut). */
  activeCamera?: string | null;
  /** Draw the light effects (tint + glows). */
  showLights?: boolean;
  /** Draw scenery objects. */
  showObjects?: boolean;
}

export const PALETTES: Record<string, Record<RoleKey, string>> = {
  cartoon: {
    skin: "#ffd9b0",
    cloth: "#4c7cf5",
    cloth2: "#2f4fc4",
    hair: "#3b2a24",
    accent: "#ff7a59",
    dark: "#2b2a3a",
    white: "#fdfdff",
    shoe: "#33323f",
    eye: "#22212e",
  },
  robot: {
    skin: "#cfd8e8",
    cloth: "#7f8ea8",
    cloth2: "#55637c",
    hair: "#8fa0bd",
    accent: "#ffcc4d",
    dark: "#2a3040",
    white: "#eef3fb",
    shoe: "#3c4557",
    eye: "#66e6ff",
  },
  dragon: {
    skin: "#5fc98a",
    cloth: "#3d9c68",
    cloth2: "#2b7a50",
    hair: "#f0b429",
    accent: "#ffd166",
    dark: "#20402f",
    white: "#f6fff8",
    shoe: "#2b7a50",
    eye: "#ffe066",
  },
  blob: {
    skin: "#8be0c8",
    cloth: "#63c9ad",
    cloth2: "#48a891",
    hair: "#2f7d68",
    accent: "#ffd6e0",
    dark: "#1f4b43",
    white: "#f4fffb",
    shoe: "#48a891",
    eye: "#123831",
  },
  cat: {
    skin: "#f0a45c",
    cloth: "#d98a3f",
    cloth2: "#b3702f",
    hair: "#4a3223",
    accent: "#ffe0b0",
    dark: "#2b2119",
    white: "#fff4e2",
    shoe: "#3a2d22",
    eye: "#2b2119",
  },
  bird: {
    skin: "#7fb6ff",
    cloth: "#4a7fd6",
    cloth2: "#2f5aa8",
    hair: "#ffd166",
    accent: "#ff8f6b",
    dark: "#1b2a44",
    white: "#f2f7ff",
    shoe: "#33456b",
    eye: "#101a2e",
  },
  wizard: {
    skin: "#f0c9a0",
    cloth: "#6b54c8",
    cloth2: "#463478",
    hair: "#e8e8f2",
    accent: "#ffd166",
    dark: "#241d3a",
    white: "#f7f6ff",
    shoe: "#2b2340",
    eye: "#6b54c8",
  },
  ninja: {
    skin: "#e6b58a",
    cloth: "#2f3646",
    cloth2: "#1f2430",
    hair: "#12151c",
    accent: "#ff5b5b",
    dark: "#0d1016",
    white: "#eef2ff",
    shoe: "#171b24",
    eye: "#eef2ff",
  },
  night: {
    skin: "#8ea2c9",
    cloth: "#4a5a86",
    cloth2: "#333e5e",
    hair: "#1b2136",
    accent: "#ffd166",
    dark: "#0e1220",
    white: "#e8eeff",
    shoe: "#20263a",
    eye: "#ffe066",
  },
};

export interface Project {
  app: "AniStudio2D";
  version: 1;
  scene: Scene;
  poseLib?: Pose[];
}
