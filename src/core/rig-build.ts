/**
 * Rig builder: turns a compact declarative rig definition into a full Scene.
 * Angles in definitions are in degrees (much easier to author), lengths in scene units.
 */
import { D2R, wrapPi } from "./math";
import { buildPart, flipPtsX, rotatePts, translatePts } from "./parts";
import { emptyTrack } from "./rig";
import { PALETTES, type Bone, type IKChain, type RoleKey, type Scene, type ShapePart } from "./types";

export interface BoneDef {
  id: string;
  /** Display name (defaults to id). */
  d?: string;
  /** Parent bone id. */
  p?: string;
  /** Length in scene units. */
  l: number;
  /** Rest angle, degrees, relative to the parent bone direction. */
  a?: number;
  /** Rotation limits, degrees, relative to rest. */
  min?: number;
  max?: number;
  /** Mirrored twin bone id (front-view rigs only). */
  m?: string;
  /** Draw thickness. */
  w?: number;
}

export interface ChainDef {
  id: string;
  d?: string;
  /** root → tip, each a direct child of the previous. */
  b: string[];
  pole?: boolean;
  color?: string;
  m?: string;
}

export interface ShapeDef {
  kind: string;
  bone: string;
  z?: number;
  role?: RoleKey;
  fill?: string;
  name?: string;
  /** Nudge in bone space. */
  x?: number;
  y?: number;
  /** Non-uniform stretch in bone space — handy to make a torso span two bones. */
  sx?: number;
  sy?: number;
  /** Degrees, about the polygon centre. */
  rot?: number;
  scale?: number;
  flip?: boolean;
  sharp?: boolean;
  opacity?: number;
  pts?: { x: number; y: number }[];
}

export interface RigDef {
  id: string;
  label: string;
  hint?: string;
  bones: BoneDef[];
  chains?: ChainDef[];
  shapes?: ShapeDef[];
  root?: { x: number; y: number };
  ground?: number | null;
  palette?: keyof typeof PALETTES;
  outline?: string;
  bg?: [string, string];
  frames?: number;
  fps?: number;
  demo?: string | null;
}

export const DEF_PALETTE = PALETTES.cartoon;

export function buildScene(def: RigDef): Scene {
  const bones: Bone[] = def.bones.map((b) => ({
    id: b.id,
    name: b.d ?? b.id,
    parent: b.p ?? null,
    length: b.l,
    rest: wrapPi(((b.a ?? 0) * Math.PI) / 180),
    min: b.min == null ? undefined : (b.min * D2R),
    max: b.max == null ? undefined : (b.max * D2R),
    mirror: b.m ?? null,
    w: b.w,
  }));
  const byId = new Map(bones.map((b) => [b.id, b]));
  const chains: IKChain[] = (def.chains ?? []).map((c) => ({
    id: c.id,
    name: c.d ?? c.id,
    bones: c.b.filter((id) => byId.has(id)),
    pole: !!c.pole,
    show: true,
    color: c.color ?? "#7cf0c8",
    mirror: c.m ?? null,
  }));
  for (const c of chains) for (const id of c.bones) {
    const b = byId.get(id);
    if (b) b.chain = c.id;
  }
  const shapes: ShapePart[] = (def.shapes ?? []).map((s, i) => {
    const bone = byId.get(s.bone);
    // Root/ctrl bones have length 0 — fall back to a nominal size so art still fits them.
    const len = Math.max(16, bone?.length ?? 40);
    let pts = s.pts ? s.pts.map((p) => ({ ...p })) : buildPart(s.kind, len);
    if (s.flip) pts = flipPtsX(pts, 0);
    const sc = s.scale ?? 1;
    const sx = sc * (s.sx ?? 1);
    const sy = sc * (s.sy ?? 1);
    if (sx !== 1 || sy !== 1) pts = pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    if (s.rot) pts = rotatePts(pts, s.rot * D2R);
    if (s.x || s.y) pts = translatePts(pts, { x: s.x ?? 0, y: s.y ?? 0 });
    return {
      id: `${s.bone}-${s.kind}-${i}`,
      name: s.name ?? s.kind,
      bone: s.bone,
      pts,
      closed: true,
      sharp: s.sharp,
      role: s.role,
      fill: s.fill,
      opacity: s.opacity,
      visible: true,
      z: s.z ?? i,
      kind: s.pts ? undefined : s.kind,
    };
  });
  const tracks: Scene["tracks"] = {};
  for (const b of bones) tracks[b.id] = emptyTrack();
  for (const id of Object.keys(tracks)) if (!tracks[id].rot.length && !tracks[id].pos.length) delete tracks[id];
  return {
    name: def.label,
    fps: def.fps ?? 24,
    frames: def.frames ?? 24,
    loop: true,
    bones,
    tracks,
    shapes,
    chains,
    palette: { ...DEF_PALETTE, ...(PALETTES[def.palette ?? "cartoon"] ?? {}) },
    outline: def.outline ?? "#221f2e",
    bgTop: def.bg?.[0] ?? "#232746",
    bgBottom: def.bg?.[1] ?? "#12131f",
    ground: def.ground === undefined ? 120 : def.ground,
    rigId: def.id,
    root: { x: def.root?.x ?? 0, y: def.root?.y ?? 0 },
  };
}

export function ensureTracks(scene: Scene): void {
  for (const b of scene.bones) if (!scene.tracks[b.id]) scene.tracks[b.id] = emptyTrack();
}

export const roleColor = (scene: Scene, role?: RoleKey): string => (role ? scene.palette[role] : "#c9c4d8") ?? "#c9c4d8";
