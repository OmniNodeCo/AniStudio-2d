/**
 * Scene lighting — deliberately cheap, deliberately 2D.
 *
 * A light does two things:
 *   1. a **wash**: a soft gradient painted over the backdrop (tint + vignette), and
 *   2. a **glow**: additive light painted *over* the character, so a torch actually appears to
 *      light the person standing next to it.
 *
 * Colours are plain canvas gradients with `lighter` compositing — no per-pixel shading pass, so
 * it stays fast enough to run during playback and inside an export loop.
 */
import { TAU, clamp, type Vec } from "./math";
import { hashString, shade, toRgb } from "./scenery";
import type { RigPose } from "./fk";
import type { Light, Scene } from "./types";
import type { View } from "./render";

/** Where a light sits right now (it can follow an object or a bone). */
export function lightAnchor(light: Light, scene: Scene, pose?: RigPose | null): Vec {
  const follow = light.follow;
  if (follow) {
    const obj = scene.objects?.find((o) => o.id === follow);
    if (obj) return { x: obj.x, y: obj.y + (light.y || 0) };
    if (pose && pose.pos[follow]) {
      const p = pose.pos[follow];
      return { x: p.x + light.x, y: p.y + light.y };
    }
  }
  return { x: light.x, y: light.y };
}

const rgb = (hex: string) => {
  const [r, g, b] = toRgb(hex);
  return `${r},${g},${b}`;
};

/** Deterministic flicker multiplier (1 = steady). */
export function lightFlicker(light: Light, frame: number): number {
  const f = light.flicker ?? 0;
  if (f <= 0) return 1;
  const h = (hashString(light.id) % 1000) / 1000;
  return 1 + f * (Math.sin(frame * 0.7 + h * 12) * 0.6 + Math.sin(frame * 2.1 + h * 30) * 0.35 + Math.sin(frame * 3.7) * 0.05);
}

const liveLights = (scene: Scene): Light[] => (scene.showLights === false ? [] : (scene.lights ?? []).filter((l) => l.visible));

/** Tints the backdrop: one gradient per light, over the visible world rectangle. */
export function drawLightWash(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose | null, frame: number, view: View) {
  const lights = liveLights(scene);
  if (!lights.length) return;
  const tl = { x: (0 - view.w / 2) / view.cam.zoom + view.cam.x, y: (0 - view.h / 2) / view.cam.zoom + view.cam.y };
  const br = { x: (view.w - view.w / 2) / view.cam.zoom + view.cam.x, y: (view.h - view.h / 2) / view.cam.zoom + view.cam.y };
  const w = br.x - tl.x;
  const h = br.y - tl.y;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const light of lights) {
    const k = clamp(light.intensity, 0, 2) * lightFlicker(light, frame);
    if (k <= 0.001) continue;
    const c = rgb(light.color);

    // Big lights behave like a sky tint; small ones like a pool of light.
    if (light.radius >= 600) {
      const g = ctx.createLinearGradient(0, tl.y, 0, br.y);
      g.addColorStop(0, `rgba(${c},${0.16 * k})`);
      g.addColorStop(0.62, `rgba(${c},${0.05 * k})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(tl.x, tl.y, w, h);
    }

    const p = lightAnchor(light, scene, pose);
    const r = Math.max(24, light.radius * (0.75 + 0.25 * k));
    if (light.kind === "spot") {
      const ang = light.angle ?? -Math.PI / 2;
      const spread = light.spread ?? 0.35;
      const len = r * 1.6;
      const ax = p.x + Math.cos(ang) * len;
      const ay = p.y + Math.sin(ang) * len;
      const s1 = ang + spread;
      const s2 = ang - spread;
      const cone = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, len);
      cone.addColorStop(0, `rgba(${c},${0.34 * k})`);
      cone.addColorStop(0.55, `rgba(${c},${0.16 * k})`);
      cone.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(s1) * len, p.y + Math.sin(s1) * len);
      ctx.lineTo(ax + Math.cos(s1) * len * 0.16, ay + Math.sin(s1) * len * 0.16);
      ctx.lineTo(ax + Math.cos(s2) * len * 0.16, ay + Math.sin(s2) * len * 0.16);
      ctx.lineTo(p.x + Math.cos(s2) * len, p.y + Math.sin(s2) * len);
      ctx.closePath();
      ctx.fill();
    }
    const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g2.addColorStop(0, `rgba(${c},${0.3 * k})`);
    g2.addColorStop(0.45, `rgba(${c},${0.09 * k})`);
    g2.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Additive glow drawn after the character: the "light lands on the art" pass. */
export function drawLightGlow(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose | null, frame: number, view: View) {
  const lights = liveLights(scene);
  if (!lights.length) return;
  const k = 1 / view.cam.zoom;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const light of lights) {
    const fl = lightFlicker(light, frame);
    const intensity = clamp(light.intensity, 0, 2) * fl;
    if (intensity <= 0.001) continue;
    const p = lightAnchor(light, scene, pose);
    const c = rgb(light.color);
    const r = Math.max(10, light.radius * 0.42);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(${c},${clamp(0.5 * intensity, 0, 0.85)})`);
    g.addColorStop(0.35, `rgba(${c},${clamp(0.16 * intensity, 0, 0.4)})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();

    // The source itself: a small bright core, so lamps/fires read as objects.
    if (light.kind !== "sun" && light.kind !== "moon") {
      ctx.globalAlpha = clamp(0.55 * intensity + 0.2, 0, 1);
      ctx.fillStyle = shade(light.color, 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4 * k * (1 + (fl - 1) * 1.5), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Fire spits a few embers; glow pulses; spots throw a visible beam line.
    if (light.kind === "fire") {
      for (let i = 0; i < 5; i++) {
        const t = (frame * 0.14 + i * 0.37) % 1;
        const ex = p.x + Math.sin(frame * 0.2 + i * 2.4) * 18;
        const ey = p.y - t * light.radius * 0.7;
        ctx.globalAlpha = (1 - t) * 0.7 * intensity;
        ctx.fillStyle = shade(light.color, 0.35);
        ctx.beginPath();
        ctx.arc(ex, ey, 2.2 * k * (1 - t * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (light.kind === "glow" || light.kind === "cool") {
      const pulse = 1 + 0.12 * Math.sin(frame * 0.5);
      ctx.strokeStyle = `rgba(${c},${0.18 * intensity})`;
      ctx.lineWidth = 1.2 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, light.radius * 0.5 * pulse, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Marker drawn in the overlay so lights can be found, selected and dragged. */
export function drawLightHandles(ctx: CanvasRenderingContext2D, scene: Scene, pose: RigPose | null, view: View, selected: string | null) {
  const lights = scene.lights ?? [];
  if (!lights.length) return;
  const k = 1 / view.cam.zoom;
  ctx.save();
  for (const light of lights) {
    const p = lightAnchor(light, scene, pose);
    const sel = selected === light.id;
    ctx.globalAlpha = light.visible ? 1 : 0.35;
    ctx.setLineDash([5 * k, 6 * k]);
    ctx.strokeStyle = sel ? shade(light.color, 0.35) : `rgba(${rgb(light.color)},0.5)`;
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(16, light.radius * 0.45), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = light.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.5 * k, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = sel ? "#ffffff" : "rgba(12,14,20,0.85)";
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    if (light.kind === "spot") {
      const ang = light.angle ?? -Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(ang) * 34 * k, p.y + Math.sin(ang) * 34 * k);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Screen-position → light, for hit-testing in the camera tool. */
export function pickLight(scene: Scene, pose: RigPose | null, world: Vec, zoom: number): Light | null {
  let best: { light: Light; d: number } | null = null;
  for (const light of scene.lights ?? []) {
    const p = lightAnchor(light, scene, pose);
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d < 16 / zoom && (!best || d < best.d)) best = { light, d };
  }
  return best?.light ?? null;
}
