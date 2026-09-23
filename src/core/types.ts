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
};

export interface Project {
  app: "AniStudio2D";
  version: 1;
  scene: Scene;
  poseLib?: Pose[];
}
