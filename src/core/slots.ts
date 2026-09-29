/**
 * Character blueprint: which parts a character has, and what each one *is*.
 *
 * A rig template (see `src/presets/rigs.ts`) is a body plan: bones plus the art welded to them.
 * This module classifies every bone and shape in such a plan into a **slot** — body, head, eyes,
 * arms, legs … — so the studio can say what each piece is. That classification is what makes
 * pieces optional: only `body` is required, so you can build a legless slime, an armless ghost or
 * a headless golem, and the studio will warn you about the nonsensical cases instead of refusing.
 *
 * Two ways the classification is used:
 *  1. Before creating: `filterRig(def, blueprint)` strips the slots you switched off, so one
 *     starter rig becomes dozens of characters.
 *  2. After creating: every bone and shape is *tagged* with its slot, so the Build panel can show
 *     coverage, and add/remove a slot on a live character without touching the animation.
 */
import { PART_MAP, buildPart, type PartDef } from "./parts";
import { buildScene, type BoneDef, type ChainDef, type RigDef, type ShapeDef } from "./rig-build";
import { boneById, indexScene } from "./rig";
import type { Bone, RoleKey, Scene, ShapePart } from "./types";

/* --------------------------------------------------------------- slot model */

export type SlotId =
  | "body"
  | "head"
  | "eyes"
  | "mouth"
  | "hair"
  | "ears"
  | "arms"
  | "hands"
  | "legs"
  | "feet"
  | "tail"
  | "wings"
  | "prop";

export interface SlotDef {
  id: SlotId;
  label: string;
  /** Every character needs a body; everything else can be switched off. */
  required?: boolean;
  /** One line explaining what the slot gives you. */
  hint: string;
  /** Slots this one needs to exist (eyes live on a head). */
  needs?: SlotId;
  /** Part ids offered as one-click art for this slot. */
  parts: string[];
  /** The part used when you press “use a premade part” without choosing one. */
  preferred: string;
  /** Where a fresh bone for this slot attaches if the template has none. */
  attachTo: SlotId[];
}

export const SLOTS: SlotDef[] = [
  {
    id: "body",
    label: "Body",
    required: true,
    hint: "Trunk, hips and spine — the only required slot",
    parts: ["torso", "belly", "chest", "belt", "hipbox", "shell", "neck", "rectPanel"],
    preferred: "torso",
    attachTo: [],
  },
  {
    id: "head",
    label: "Head",
    hint: "Neck and head — face art hangs off this",
    parts: ["head", "snout", "jaw", "rectPanel", "shell"],
    preferred: "head",
    attachTo: ["body"],
  },
  {
    id: "eyes",
    label: "Eyes",
    hint: "Eyes and pupils (drawn on the head bone)",
    needs: "head",
    parts: ["eye", "pupil", "spark", "ball"],
    preferred: "eye",
    attachTo: ["head"],
  },
  { id: "mouth", label: "Mouth", hint: "A mouth or beak", needs: "head", parts: ["mouth", "jaw", "snout"], preferred: "mouth", attachTo: ["head"] },
  { id: "hair", label: "Hair", hint: "Hair, antennae, horns — anything sprouting", needs: "head", parts: ["hairSpike", "tailTuft", "horn", "tail", "wing"], preferred: "hairSpike", attachTo: ["head"] },
  { id: "ears", label: "Ears", hint: "Ears, fins or horns on the sides of the head", needs: "head", parts: ["ear", "horn", "wing"], preferred: "ear", attachTo: ["head"] },
  { id: "arms", label: "Arms", hint: "Upper arm + forearm with IK", parts: ["upperArm", "foreArm", "sleeve", "wing", "tail", "neck"], preferred: "upperArm", attachTo: ["body"] },
  { id: "hands", label: "Hands", hint: "Hands, mitts or paws at the end of an arm", needs: "arms", parts: ["hand", "mitten", "paw", "hoof", "ball", "spark"], preferred: "hand", attachTo: ["arms"] },
  { id: "legs", label: "Legs", hint: "Thigh + shin with IK", parts: ["thigh", "shin", "tail", "neck"], preferred: "thigh", attachTo: ["body"] },
  { id: "feet", label: "Feet", hint: "Shoes, paws or claws", needs: "legs", parts: ["foot", "paw", "hoof", "mitten"], preferred: "foot", attachTo: ["legs"] },
  { id: "tail", label: "Tail", hint: "A tail chain with follow-through", parts: ["tail", "tailTuft", "wing", "cape"], preferred: "tail", attachTo: ["body"] },
  { id: "wings", label: "Wings", hint: "Wings that flap with the demo presets", parts: ["wing", "cape", "tailTuft"], preferred: "wing", attachTo: ["body"] },
  { id: "prop", label: "Prop", hint: "Sword, hat, cape — an extra bone you can parent anywhere", parts: ["sword", "shield", "hat", "cape", "ball", "spark", "dust", "rectPanel"], preferred: "hat", attachTo: ["hands", "arms", "body"] },
];

export const SLOT_MAP = new Map(SLOTS.map((s) => [s.id, s]));
export const slotDef = (id: SlotId): SlotDef => SLOT_MAP.get(id) ?? SLOTS[0];
export const REQUIRED_SLOTS: SlotId[] = SLOTS.filter((s) => s.required).map((s) => s.id);

/* ------------------------------------------------------ classifying a rig */

const NAME_RULES: [RegExp, SlotId][] = [
  [/^(hand|mitt|palm|fist)/i, "hands"],
  [/(hand|mitt|palm)/i, "hands"],
  [/(wing|feather)/i, "wings"],
  [/(tail)/i, "tail"],
  [/(eye|pupil|brow|lash)/i, "eyes"],
  [/(jaw|mouth|beak|lip|chin|snout|tongue)/i, "mouth"],
  // `ear`, `ears`, `earA` … but never the "ear" inside "forearm".
  [/(horn|antler|ear(s)?[A-Za-z0-9]*$|fin|tusk)/i, "ears"],
  // Antennae, crests, manes, headbands and tufts all sprout from the head.
  [/(hair|mane|tuft|antenna|crest|plume|band|beard|brow)|^ant\d*$/i, "hair"],
  [/(foot|feet|^ft|paw|claw|toe|hoof|ankle|shoe)/i, "feet"],
  // Quadrupeds name their limbs front/back (a cat has front + back legs, not arms).
  [/(shin|thigh|leg|knee|limb|front|back|hind)|^th[A-Za-z0-9]?$/i, "legs"],
  [/(arm|shoulder|sh[LR]?\d*$|fore|elbow|sleeve)/i, "arms"],
  [/(head|neck|skull|visor|helm)/i, "head"],
  [/(prop|item|weapon|sword|shield|hat|cape|staff|wand)/i, "prop"],
];

/** Which slot a bone belongs to, guessed from its name. */
export function inferSlot(boneId: string): SlotId {
  for (const [re, slot] of NAME_RULES) if (re.test(boneId)) return slot;
  return "body";
}

export const boneSlot = (bone: Bone): SlotId => bone.slot ?? inferSlot(bone.id);

export const boneInSlot = (bone: Bone, slot: SlotId): boolean => {
  const s = boneSlot(bone);
  if (s === slot) return true;
  // Legs imply their feet, arms their hands: "remove the legs" should take the shoes with it,
  // while "remove the feet" on its own must leave the legs standing.
  if (slot === "legs" && s === "feet") return true;
  if (slot === "arms" && s === "hands") return true;
  if (slot === "head" && (s === "eyes" || s === "mouth" || s === "hair" || s === "ears")) return true;
  return false;
};

/**
 * Which slot a shape fills. The bone usually decides, but art welded to the *body* or *head*
 * bone says more: an eye on the head bone is the eyes slot, a hat on the spine is a prop.
 */
export const shapeSlotOf = (scene: Scene, shape: ShapePart): SlotId => {
  if (shape.slot) return shape.slot;
  const bone = boneById(scene, shape.bone);
  const own = bone ? boneSlot(bone) : "body";
  return artSlot(own, shape.kind);
};

/**
 * Same rule, for a shape definition that has no scene yet. Art on the body/head bone belongs to
 * whatever it depicts (an eye is the eyes slot); art on a limb bone belongs to that limb, unless
 * it depicts the limb's own end (a hand welded to the forearm is still a hand).
 */
export function artSlot(boneSlot: SlotId, kind?: string): SlotId {
  const hint = kind ? KIND_SLOTS[kind] : undefined;
  if (!hint) return boneSlot;
  if (boneSlot === "body" || boneSlot === "head") return hint;
  const needs = SLOT_MAP.get(hint)?.needs;
  if (needs && needs === boneSlot) return hint;
  // A paw or hand welded to the end of a leg bone is a foot (that is where birds keep them).
  if (hint === "hands" && boneSlot === "legs") return "feet";
  return boneSlot;
}

/* -------------------------------------------------------------- blueprints */

/**
 * How a slot gets its art.
 *  · `template` — the starter rig's own art (the default)
 *  · `part`     — a premade part from the library, welded to the slot's bone
 *  · `draw`     — you draw it yourself (the slot is left empty until you do)
 *  · `import`   — you import a PNG/JPG/SVG for it
 *  · `none`     — bones but no art (invisible limb, handy for hiding)
 */
export type ArtSource = "template" | "part" | "draw" | "import" | "none";

export interface SlotChoice {
  on: boolean;
  art: ArtSource;
  /** Part id when `art === "part"`. */
  part?: string;
}

export interface Blueprint {
  /** Starter rig id this body plan came from. */
  base: string;
  slots: Record<SlotId, SlotChoice>;
}

export const defaultChoice = (): SlotChoice => ({ on: true, art: "template" });

export function defaultBlueprint(base: string): Blueprint {
  const slots = {} as Record<SlotId, SlotChoice>;
  for (const s of SLOTS) slots[s.id] = { ...defaultChoice(), on: !!s.required };
  return { base, slots };
}

export function blueprintFor(def: RigDef, on = true): Blueprint {
  const bp = defaultBlueprint(def.id);
  for (const s of SLOTS) bp.slots[s.id].on = on && slotPresent(def, s.id);
  bp.slots.body.on = true;
  return bp;
}

/**
 * What a part *is*, when the bone it sits on does not already say. An `eye` welded to the head
 * bone means the character has an eyes slot; a `hat` on the spine is a prop. Only consulted
 * when the bone's own slot is body or head, so a `paw` on a foot bone still counts as a foot.
 */
export const KIND_SLOTS: Record<string, SlotId> = {
  eye: "eyes",
  pupil: "eyes",
  mouth: "mouth",
  hairSpike: "hair",
  tailTuft: "hair",
  ear: "ears",
  horn: "ears",
  hand: "hands",
  mitten: "hands",
  paw: "hands",
  foot: "feet",
  hoof: "feet",
  wing: "wings",
  tail: "tail",
  sword: "prop",
  shield: "prop",
  hat: "prop",
  cape: "prop",
  ball: "prop",
  spark: "prop",
  rectPanel: "body",
};

/** Slots the template can actually build (has bones or art for). */
export function templateSlots(def: RigDef): SlotId[] {
  const out = new Set<SlotId>();
  for (const b of def.bones) out.add(inferSlot(b.id));
  // Art says as much as bones do: a hand welded to a forearm means this character has hands.
  for (const sh of def.shapes ?? []) out.add(artSlot(inferSlot(sh.bone), sh.kind));
  return SLOTS.filter((s) => out.has(s.id)).map((s) => s.id);
}

export const slotPresent = (def: RigDef, slot: SlotId): boolean => templateSlots(def).includes(slot);

/** Bones and chains in the template that belong to a slot. */
export function templateBones(def: RigDef, slot: SlotId): BoneDef[] {
  return def.bones.filter((b) => boneInSlot({ id: b.id } as Bone, slot));
}

export function templateChains(def: RigDef, slot: SlotId): ChainDef[] {
  const ids = new Set(templateBones(def, slot).map((b) => b.id));
  return (def.chains ?? []).filter((c) => c.b.some((id) => ids.has(id)));
}

/** Shapes the template welds to a slot. */
export function templateShapes(def: RigDef, slot: SlotId): ShapeDef[] {
  const ids = new Set(templateBones(def, slot).map((b) => b.id));
  return (def.shapes ?? []).filter((s) => ids.has(s.bone));
}

/* ---------------------------------------------------------- filtering a rig */

export interface BlueprintRow {
  id: SlotId;
  def: SlotDef;
  /** The template has bones/art for this slot. When false it is grown from scratch on build. */
  available: boolean;
  on: boolean;
  art: ArtSource;
  part?: string;
  /** Enabled but missing art because you chose to draw/import it. */
  pending: boolean;
  /** Set when the row is switched off because a slot it depends on is off (hands follow arms). */
  follows?: SlotId;
}

export function blueprintRows(def: RigDef, bp: Blueprint): BlueprintRow[] {
  // SLOTS is ordered body → head → limbs, so a single pass resolves dependencies.
  const resolved = new Map<SlotId, boolean>();
  return SLOTS.map((s) => {
    const c = bp.slots[s.id] ?? defaultChoice();
    const available = slotPresent(def, s.id);
    let on = s.required ? true : !!c.on;
    // Hands have nothing to sit on without arms, feet nothing without legs: they follow.
    const follows = on && s.needs && resolved.get(s.needs) === false ? s.needs : undefined;
    if (follows) on = false;
    resolved.set(s.id, on);
    return {
      id: s.id,
      def: s,
      available,
      on,
      art: c.art,
      part: c.part,
      pending: on && (c.art === "draw" || c.art === "import"),
      follows,
    };
  });
}

export interface BlueprintIssue {
  slot: SlotId;
  level: "error" | "warn" | "info";
  text: string;
}

/**
 * What is missing or odd about a blueprint. Only one thing is fatal — there is no character
 * without a body — everything else is advice (arms on a fish are allowed, just unusual).
 */
export function blueprintIssues(def: RigDef, bp: Blueprint): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const rows = blueprintRows(def, bp);
  const on = new Set(rows.filter((r) => r.on).map((r) => r.id));
  if (!on.has("body")) out.push({ slot: "body", level: "error", text: "Every character needs a body — it is the one required slot." });
  for (const row of rows) {
    if (row.follows) {
      out.push({
        slot: row.id,
        level: "info",
        text: `${row.def.label} follow the ${slotDef(row.follows).label.toLowerCase()} — switch those back on to bring them back.`,
      });
      continue;
    }
    if (!row.on) continue;
    if (!row.available) {
      out.push({ slot: row.id, level: "info", text: `${row.def.label} is not part of this body plan — it will be grown with new bones.` });
      continue;
    }
    if (row.def.needs && !on.has(row.def.needs)) {
      out.push({ slot: row.id, level: "warn", text: `${row.def.label} needs ${slotDef(row.def.needs).label.toLowerCase()} — switch that back on, or drop this too.` });
    }
  }
  if (on.size === 1) out.push({ slot: "body", level: "info", text: "Just a body — a true slime. Add slots whenever you like; nothing is permanent." });
  if (!on.has("head")) out.push({ slot: "head", level: "info", text: "No head: fine for a slime or a robot core, surprising for a person." });
  if (!on.has("legs") && on.has("feet")) out.push({ slot: "feet", level: "warn", text: "Feet without legs have nothing to hang from — the rig needs legs for feet." });
  const pending = rows.filter((r) => r.pending);
  if (pending.length) out.push({ slot: pending[0].id, level: "info", text: `You will draw or import art for ${pending.map((p) => p.def.label.toLowerCase()).join(", ")} after creating.` });
  return out;
}

/**
 * Strip a starter rig down to the slots you switched on, swapping in premade parts where asked.
 * Parents of kept bones are always kept, so results never reference a missing bone.
 */
export function filterRig(def: RigDef, bp: Blueprint): RigDef {
  const rows = blueprintRows(def, bp);
  const slotOn = new Map(rows.map((r) => [r.id, r.on]));
  const slotChoice = new Map(rows.map((r) => [r.id, r]));
  const keepBone = new Set<string>();
  const byId = new Map(def.bones.map((b) => [b.id, b]));

  const wanted = (id: string): boolean => {
    if (id === "hips" || keyBone(def, id)) return true;
    const slot = inferSlot(id);
    if (slotOn.get(slot)) return true;
    // A foot bone disappears with its legs, but a leg bone never disappears with its feet.
    for (const [parentSlot, on] of slotOn) {
      if (slot === "feet" && parentSlot === "legs" && on) return true;
      if (slot === "hands" && parentSlot === "arms" && on) return true;
    }
    return false;
  };

  for (const b of def.bones) {
    if (!wanted(b.id)) continue;
    // Keep every ancestor of a kept bone (a hand needs its forearm, which needs the chest).
    let cur: BoneDef | undefined = b;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      keepBone.add(cur.id);
      cur = cur.p ? byId.get(cur.p) : undefined;
    }
  }

  const bones = def.bones.filter((b) => keepBone.has(b.id)).map((b) => ({ ...b, slot: b.slot ?? inferSlot(b.id) }));
  const keptIds = new Set(bones.map((b) => b.id));
  const chains = (def.chains ?? [])
    .map((c) => ({ ...c, b: c.b.filter((id) => keptIds.has(id)) }))
    .filter((c) => c.b.length >= 2 && slotOn.get(inferSlot(c.b[0])));
  const shapes: ShapeDef[] = [];
  const wantsArt = (slot: SlotId): ArtSource => slotChoice.get(slot)?.art ?? "template";
  for (const b of bones) {
    const slot = inferSlot(b.id);
    const art = wantsArt(slot);
    if (art === "draw" || art === "import" || art === "none") continue;
    if (art === "part") {
      const kind = slotChoice.get(slot)?.part ?? slotDef(slot).preferred;
      // One premade part per bone in the slot — the arms slot gives both arms the same art.
      shapes.push({ kind, bone: b.id, role: partRole(kind), name: `${slotDef(slot).label} · ${b.d ?? b.id}`, z: inferZ(b.id) });
      continue;
    }
    // The bone's own art, plus anything welded to it that belongs to a slot of its own
    // (eyes, mouth and hair live on the head bone but have their own slots). A slot that has
    // been given different art (a part, a sketch, an import) does not re-add its template art.
    for (const sh of def.shapes ?? []) {
      if (sh.bone !== b.id) continue;
      if (wantsArt(artSlot(slot, sh.kind)) !== "template") continue;
      shapes.push({ ...sh });
    }
  }
  // Premade parts for slots whose art sits on someone else's bone (eyes, mouth, hair, props
  // hung off the body). They are placed along the host bone so they land somewhere sensible.
  for (const row of rows) {
    if (!row.on || !row.available || row.art !== "part") continue;
    if (bones.some((b) => inferSlot(b.id) === row.id)) continue;
    const hostId = row.def.needs ? bones.find((b) => inferSlot(b.id) === row.def.needs)?.id : bones[0]?.id;
    const host = bones.find((b) => b.id === hostId);
    if (!host) continue;
    const place = HEAD_PLACEMENT[row.id] ?? {};
    const kind = row.part ?? row.def.preferred;
    shapes.push({
      kind,
      bone: host.id,
      role: partRole(kind),
      name: `${row.def.label} · ${host.d ?? host.id}`,
      z: (place.z ?? 20),
      x: place.x != null ? host.l * place.x : undefined,
      y: place.y != null ? host.l * place.y : undefined,
      scale: place.scale,
    });
  }
  // Slots added on top of the plan (a tail on a humanoid) get a bone and a bit of art.
  const extras: { bones: BoneDef[]; chains: ChainDef[]; shapes: ShapeDef[] } = { bones: [], chains: [], shapes: [] };
  for (const row of rows) {
    if (!row.on || row.available) continue;
    const spec = extraSlotSpec(def, row, keptIds);
    extras.bones.push(...spec.bones);
    extras.chains.push(...spec.chains);
    extras.shapes.push(...spec.shapes);
    for (const b of spec.bones) keptIds.add(b.id);
  }

  return {
    ...def,
    id: bp.base,
    label: def.label,
    bones: [...bones, ...extras.bones],
    chains: [...chains, ...extras.chains],
    shapes: [...shapes, ...extras.shapes],
  };
}

/**
 * Where art lands when its slot has no bone of its own: fractions of the host bone's length,
 * so an eye sits near the front of the head whatever size that head is.
 */
export const HEAD_PLACEMENT: Partial<Record<SlotId, { x?: number; y?: number; scale?: number; z?: number }>> = {
  eyes: { x: 0.5, y: -0.16, scale: 0.5, z: 12 },
  mouth: { x: 0.46, y: 0.24, scale: 0.46, z: 13 },
  hair: { x: -0.1, y: -0.42, scale: 0.8, z: 11 },
  ears: { x: -0.12, y: -0.4, scale: 0.9, z: 11 },
  prop: { x: 0.3, y: -0.35, scale: 0.9, z: 20 },
};

/** Bones that anchor a body plan and are never optional (the root of the skeleton). */
function keyBone(def: RigDef, id: string): boolean {
  const b = def.bones.find((x) => x.id === id);
  return !!b && !b.p;
}

const partRole = (kind: string): RoleKey => PART_MAP.get(kind)?.role ?? "skin";
const inferZ = (boneId: string): number => (/(far|back|B$|R$|B\b)/.test(boneId) ? 0 : 5);

/**
 * Bones for a slot the template does not have, e.g. a tail on the walk kid. The spec is
 * authored against generic anchors (`body`, `head`, `arms`) and remapped onto real bones.
 */
export function extraSlotSpec(def: RigDef, row: BlueprintRow, taken: Set<string>): { bones: BoneDef[]; chains: ChainDef[]; shapes: ShapeDef[] } {
  const anchor = findAnchor(def, row.def.attachTo, taken);
  if (!anchor) return { bones: [], chains: [], shapes: [] };
  const role = row.art === "part" && row.part ? partRole(row.part) : slotDef(row.id).preferred ? partRole(slotDef(row.id).preferred) : "skin";
  const kind = row.art === "part" && row.part ? row.part : slotDef(row.id).preferred;
  const uid = (base: string) => {
    let id = base;
    let n = 2;
    while (taken.has(id) || def.bones.some((b) => b.id === id)) id = `${base}${n++}`;
    return id;
  };
  const bones: BoneDef[] = [];
  const chains: ChainDef[] = [];
  const shapes: ShapeDef[] = [];
  const add = (spec: BoneDef, shape: ShapeDef) => {
    bones.push(spec);
    shapes.push(shape);
  };
  switch (row.id) {
    case "head": {
      const neck = uid("neck");
      const head = uid("head");
      add({ id: neck, d: "Neck", p: anchor, l: 9, a: -4, min: -26, max: 28 }, { kind: "neck", bone: neck, role: "skin", name: "Neck", sx: 1.4, sy: 1.5, z: 6 });
      add({ id: head, d: "Head", p: neck, l: 22, a: 84, min: -36, max: 36 }, { kind, bone: head, role, scale: 1.18, x: -3, y: -1, z: 10, name: "Head" });
      break;
    }
    case "arms": {
      const up = uid("armUp");
      const lo = uid("armLo");
      const hand = uid("hand");
      add({ id: up, d: "Upper arm", p: anchor, l: 26, a: 168, min: -26, max: 80 }, { kind: "upperArm", bone: up, role: "skin", name: "Upper arm" });
      add({ id: lo, d: "Forearm", p: up, l: 24, a: 8, min: -124, max: 12 }, { kind: "foreArm", bone: lo, role: "skin", name: "Forearm" });
      add({ id: hand, d: "Hand", p: lo, l: 9, a: 0 }, { kind: "hand", bone: hand, role: "skin", scale: 1.3, name: "Hand" });
      bones.unshift({ id: uid("sh"), d: "Shoulder", p: anchor, l: 6, a: 174 } as BoneDef);
      chains.push({ id: uid("arm"), d: "Arm IK", b: [up, lo], pole: true, color: "#7cf0c8" });
      break;
    }
    case "hands": {
      const hand = uid("hand");
      add({ id: hand, d: "Hand", p: anchor, l: 9, a: 0 }, { kind, bone: hand, role, scale: 1.3, name: "Hand" });
      break;
    }
    case "legs": {
      const up = uid("legUp");
      const lo = uid("legLo");
      const foot = uid("foot");
      add({ id: up, d: "Thigh", p: anchor, l: 34, a: 90, min: -75, max: 70 }, { kind: "thigh", bone: up, role: "cloth2", name: "Thigh" });
      add({ id: lo, d: "Shin", p: up, l: 32, a: -4, min: -6, max: 140 }, { kind: "shin", bone: lo, role: "cloth2", name: "Shin" });
      add({ id: foot, d: "Foot", p: lo, l: 13, a: -80 }, { kind: "paw", bone: foot, role: "shoe", name: "Foot" });
      chains.push({ id: uid("leg"), d: "Leg IK", b: [up, lo], pole: true, color: "#ffb347" });
      break;
    }
    case "feet": {
      const foot = uid("foot");
      add({ id: foot, d: "Foot", p: anchor, l: 13, a: -80 }, { kind, bone: foot, role, name: "Foot" });
      break;
    }
    case "tail": {
      const a = uid("tail1");
      const b = uid("tail2");
      const c = uid("tail3");
      add({ id: a, d: "Tail 1", p: anchor, l: 22, a: 176, min: -50, max: 50 }, { kind: "tail", bone: a, role, name: "Tail 1", sy: 1.2 });
      add({ id: b, d: "Tail 2", p: a, l: 20, a: 8, min: -44, max: 44 }, { kind: "tail", bone: b, role, name: "Tail 2", scale: 0.9 });
      add({ id: c, d: "Tail tip", p: b, l: 18, a: 8, min: -42, max: 42 }, { kind: "tailTuft", bone: c, role: "hair", name: "Tuft", scale: 1.1 });
      chains.push({ id: uid("tailChain"), d: "Tail IK", b: [a, b, c], pole: false, color: "#ffd166" });
      break;
    }
    case "wings": {
      const up = uid("wingUp");
      const lo = uid("wingLo");
      add({ id: up, d: "Wing arm", p: anchor, l: 26, a: -108, min: -85, max: 60 }, { kind: "wing", bone: up, role: role ?? "cloth2", name: "Wing", sx: 1.8, sy: 1.6 });
      add({ id: lo, d: "Wing fore", p: up, l: 32, a: 22, min: -75, max: 75 }, { kind: "wing", bone: lo, role: "cloth2", name: "Wing tip", sx: 1.5, sy: 1.3, x: -6 });
      break;
    }
    case "ears": {
      const ear = uid("ear");
      add({ id: ear, d: "Ear", p: anchor, l: 11, a: -120 }, { kind, bone: ear, role, scale: 1.1, name: "Ear" });
      break;
    }
    case "prop": {
      const prop = uid("prop");
      add({ id: prop, d: "Prop", p: anchor, l: 22, a: 0 }, { kind, bone: prop, role, scale: 1, x: 6, name: "Prop" });
      break;
    }
    case "eyes": {
      add({ id: uid("eye"), d: "Eye", p: anchor, l: 6, a: 0 }, { kind, bone: "", role, name: "Eye", x: 12, y: -5, scale: 1.2 });
      const eyeBone = bones[bones.length - 1].id;
      shapes[shapes.length - 1].bone = eyeBone;
      add({ id: uid("pupil"), d: "Pupil", p: eyeBone, l: 4, a: 0 }, { kind: "pupil", bone: "", role: "eye", name: "Pupil", x: 4, scale: 1.1 });
      shapes[shapes.length - 1].bone = bones[bones.length - 1].id;
      break;
    }
    case "mouth": {
      const mouth = uid("mouth");
      add({ id: mouth, d: "Mouth", p: anchor, l: 8, a: 0 }, { kind, bone: mouth, role: "dark", name: "Mouth", x: 12, y: 6, scale: 1.2 });
      break;
    }
    case "hair": {
      const hair = uid("hair");
      add({ id: hair, d: "Hair", p: anchor, l: 12, a: -110 }, { kind, bone: hair, role: "hair", name: "Hair", x: -6, y: -8, scale: 0.9 });
      break;
    }
    default:
      return { bones: [], chains: [], shapes: [] };
  }
  return { bones, chains, shapes };
}

/** First existing bone matching the preferred anchors, walking outward. */
function findAnchor(def: RigDef, wanted: SlotId[], taken: Set<string>): string | null {
  const ids = new Set([...taken, ...def.bones.map((b) => b.id)]);
  const order: SlotId[] = [...wanted, "body", "head", "arms", "legs"];
  for (const slot of order) {
    const candidates = def.bones.filter((b) => ids.has(b.id) && boneInSlot({ id: b.id } as Bone, slot));
    const near = candidates.find((b) => !/far|back|B$|R$/i.test(b.id)) ?? candidates[0];
    if (near) return near.id;
  }
  return def.bones[0]?.id ?? null;
}

/** Full scene for a blueprint — a starter rig filtered down to the slots you kept. */
export function buildFromBlueprint(def: RigDef, bp: Blueprint): Scene {
  const scene = buildScene(filterRig(def, bp));
  tagSlots(scene);
  return scene;
}

/** Tag every bone and shape with the slot it belongs to, so later edits know what is what. */
export function tagSlots(scene: Scene): void {
  for (const b of scene.bones) b.slot = boneSlot(b);
  for (const s of scene.shapes) if (!s.slot) s.slot = shapeSlotOf(scene, s);
}

/* ------------------------------------------------------ live character edits */

export interface SlotCoverage {
  id: SlotId;
  def: SlotDef;
  bones: string[];
  shapes: string[];
  /** Has bones in this rig. */
  present: boolean;
  /** Has at least one visible piece of art. */
  drawn: boolean;
  missingRequired: boolean;
  /** A slot that is switched off but still partly there (a half-removed limb). */
  partial: boolean;
}

/** What the character on screen actually has, slot by slot. */
export function sceneCoverage(scene: Scene): SlotCoverage[] {
  const described = new Map<SlotId, { bones: string[]; shapes: string[] }>();
  for (const s of SLOTS) described.set(s.id, { bones: [], shapes: [] });
  for (const b of scene.bones) {
    const slot = boneSlot(b);
    described.get(slot)?.bones.push(b.id);
    if (slot === "arms" || slot === "legs") described.get(slot === "arms" ? "hands" : "feet");
  }
  for (const s of scene.shapes) {
    const slot = shapeSlotOf(scene, s);
    const row = described.get(slot);
    if (row) row.shapes.push(s.id);
    else described.get("body")?.shapes.push(s.id);
  }
  return SLOTS.map((def) => {
    const row = described.get(def.id)!;
    const present = row.bones.length > 0;
    const anySlot = SLOTS.some((s) => s.id !== def.id && boneInSlot({ id: row.bones[0] ?? "" } as Bone, def.id));
    return {
      id: def.id,
      def,
      bones: row.bones,
      shapes: row.shapes,
      present,
      drawn: row.shapes.length > 0,
      missingRequired: !!def.required && !present,
      partial: !present && anySlot,
    };
  });
}

export function sceneHasSlot(scene: Scene, slot: SlotId): boolean {
  return scene.bones.some((b) => boneInSlot(b, slot));
}

/** Remap `def`'s bones for a slot onto this scene, renaming anything that would collide. */
export function slotSpecForScene(
  scene: Scene,
  def: RigDef,
  slot: SlotId,
): { bones: BoneDef[]; chains: ChainDef[]; shapes: ShapeDef[]; anchor: string | null } {
  const taken = new Set(scene.bones.map((b) => b.id));
  const anchor = findAnchor(def, slotDef(slot).attachTo, taken);
  if (!anchor) return { bones: [], chains: [], shapes: [], anchor: null };
  const row: BlueprintRow = { id: slot, def: slotDef(slot), available: false, on: true, art: "part", part: slotDef(slot).preferred, pending: false };
  const spec = extraSlotSpec(def, row, taken);
  const remap = new Map<string, string>();
  const bones = spec.bones.map((b) => {
    if (scene.bones.some((x) => x.id === b.id)) {
      let id = `${slot}_${b.id}`;
      let n = 2;
      while (taken.has(id) || scene.bones.some((x) => x.id === id)) id = `${slot}_${b.id}${n++}`;
      remap.set(b.id, id);
      taken.add(id);
      return { ...b, id };
    }
    taken.add(b.id);
    return { ...b };
  });
  const fix = (id?: string) => (id ? remap.get(id) ?? id : id);
  const chains = spec.chains.map((c) => ({ ...c, b: c.b.map((x) => fix(x) ?? x) }));
  const shapes = spec.shapes.map((s) => ({ ...s, bone: fix(s.bone) ?? s.bone }));
  return { bones, chains, shapes, anchor: remap.get(anchor) ?? anchor };
}

/** Bones that would be removed with a slot, deepest first (so parents survive until last). */
export function slotRemoval(scene: Scene, slot: SlotId): { bones: Bone[]; shapes: ShapePart[] } {
  const bones = scene.bones.filter((b) => boneInSlot(b, slot) && b.parent);
  const ids = new Set(bones.map((b) => b.id));
  const shapes = scene.shapes.filter((s) => ids.has(s.bone) || (s.slot ? boneInSlot({ id: "", slot: s.slot } as Bone, slot) : false));
  return { bones, shapes };
}

/** Delete a slot's bones, re-parenting any children onto the slot's own parent. */
export function stripSlot(scene: Scene, slot: SlotId): { bones: number; shapes: number } {
  const idx = indexScene(scene);
  const doomed = new Set(slotRemoval(scene, slot).bones.map((b) => b.id));
  if (!doomed.size) {
    const shapes = scene.shapes.filter((s) => shapeSlotOf(scene, s) === slot);
    scene.shapes = scene.shapes.filter((s) => shapeSlotOf(scene, s) !== slot);
    return { bones: 0, shapes: shapes.length };
  }
  // Children of a removed bone move up to the nearest surviving ancestor.
  const survivor = (id: string): string | null => {
    let cur = idx.byId.get(id)?.parent ?? null;
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      if (!doomed.has(cur)) return cur;
      cur = idx.byId.get(cur)?.parent ?? null;
    }
    return null;
  };
  for (const b of scene.bones) {
    if (doomed.has(b.id) || !b.parent || !doomed.has(b.parent)) continue;
    b.parent = survivor(b.parent);
  }
  const shapes = scene.shapes.filter((s) => doomed.has(s.bone) || shapeSlotOf(scene, s) === slot);
  scene.bones = scene.bones.filter((b) => !doomed.has(b.id));
  scene.shapes = scene.shapes.filter((s) => !doomed.has(s.bone) && shapeSlotOf(scene, s) !== slot);
  for (const id of doomed) delete scene.tracks[id];
  scene.chains = scene.chains
    .map((c) => ({ ...c, bones: c.bones.filter((x) => !doomed.has(x)) }))
    .filter((c) => c.bones.length >= 2);
  return { bones: doomed.size, shapes: shapes.length };
}

/**
 * Slot the studio would pick for an imported file, from its name. `nibbles-legs.png` lands in
 * the legs slot; an opaque name lands in whatever slot you pick in the panel.
 */
export function guessSlot(fileName: string): SlotId | null {
  const name = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  let best: { slot: SlotId; len: number } | null = null;
  for (const [re, slot] of NAME_RULES) {
    const m = re.exec(name);
    if (!m) continue;
    if (!best || m[0].length > best.len) best = { slot, len: m[0].length };
  }
  if (best) return best.slot;
  const words: [string, SlotId][] = [
    ["eye", "eyes"],
    ["head", "head"],
    ["face", "head"],
    ["arm", "arms"],
    ["hand", "hands"],
    ["leg", "legs"],
    ["foot", "feet"],
    ["shoe", "feet"],
    ["tail", "tail"],
    ["wing", "wings"],
    ["body", "body"],
    ["torso", "body"],
    ["tummy", "body"],
    ["hair", "hair"],
    ["mouth", "mouth"],
    ["ear", "ears"],
    ["hat", "prop"],
    ["sword", "prop"],
    ["cape", "prop"],
  ];
  for (const [word, slot] of words) if (name.includes(word)) return slot;
  return null;
}

/** One-line summary used by the toast and the panel footer. */
export function describeBlueprint(def: RigDef, bp: Blueprint): string {
  const rows = blueprintRows(def, bp).filter((r) => r.on);
  const off = blueprintRows(def, bp).filter((r) => !r.on && r.available).map((r) => r.def.label.toLowerCase());
  const extra = rows.filter((r) => !r.available).map((r) => r.def.label.toLowerCase());
  const parts = [rows.length ? rows.map((r) => r.def.label.toLowerCase()).join(", ") : "nothing"];
  if (extra.length) parts.push(`growing ${extra.join(", ")}`);
  if (off.length) parts.push(`no ${off.join(", ")}`);
  return parts.join(" · ");
}

/** Every premade part that suits a slot, for the art picker. */
export function partsForSlot(slot: SlotId): PartDef[] {
  return slotDef(slot)
    .parts.map((id) => PART_MAP.get(id))
    .filter((p): p is PartDef => !!p);
}

/** A premade part welded to a bone, used when adding art to a slot on a live character. */
export function premadeShape(kind: string, bone: Bone, scene: Scene, opts: { name?: string; z?: number } = {}): ShapePart {
  const len = Math.max(16, bone.length || 40);
  return {
    id: `p${Math.random().toString(36).slice(2, 7)}`,
    name: opts.name ?? PART_MAP.get(kind)?.label ?? kind,
    bone: bone.id,
    pts: buildPart(kind, len),
    closed: true,
    role: partRole(kind),
    visible: true,
    z: opts.z ?? scene.shapes.length + 1,
    kind,
  };
}
