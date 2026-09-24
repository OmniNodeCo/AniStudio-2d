/**
 * Regenerate the app icon: desktop-assets/icon.png (512×512).
 *
 *   node scripts/make-icon.mjs
 *
 * electron-builder converts this one PNG into .icns (mac), .ico (win) and the linux desktop icon,
 * so it is the only icon file the repo carries. Keep it square and legible at 32px.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const S = 512;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext("2d");

const roundRect = (x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// background
const bg = ctx.createLinearGradient(0, 0, 0, S);
bg.addColorStop(0, "#1a1f30");
bg.addColorStop(1, "#0a0b11");
roundRect(0, 0, S, S, S * 0.22);
ctx.fillStyle = bg;
ctx.fill();
ctx.lineWidth = 10;
ctx.strokeStyle = "rgba(124,240,200,0.30)";
ctx.stroke();

// the walking figure: mint skull, orange limbs — the same glyph as the favicon, drawn bold
const cx = S * 0.5;
ctx.lineCap = "round";
ctx.lineJoin = "round";

ctx.strokeStyle = "#ffb347";
ctx.lineWidth = 34;
ctx.beginPath();
ctx.moveTo(cx, S * 0.44);
ctx.lineTo(cx - S * 0.16, S * 0.74);
ctx.moveTo(cx, S * 0.44);
ctx.lineTo(cx + S * 0.17, S * 0.7);
ctx.moveTo(cx - S * 0.13, S * 0.55);
ctx.lineTo(cx + S * 0.12, S * 0.6);
ctx.stroke();

ctx.beginPath();
ctx.arc(cx, S * 0.31, S * 0.13, 0, Math.PI * 2);
ctx.fillStyle = "#7cf0c8";
ctx.fill();

// an onion-skin ghost of the next pose, and a strip of keyframes: this is an animation tool
ctx.globalAlpha = 0.28;
ctx.strokeStyle = "#5ec8ff";
ctx.lineWidth = 26;
ctx.beginPath();
ctx.moveTo(cx + 26, S * 0.46);
ctx.lineTo(cx + 26 + S * 0.13, S * 0.72);
ctx.moveTo(cx + 26, S * 0.46);
ctx.lineTo(cx + 26 - S * 0.1, S * 0.74);
ctx.stroke();
ctx.beginPath();
ctx.arc(cx + 26, S * 0.33, S * 0.11, 0, Math.PI * 2);
ctx.fillStyle = "#5ec8ff";
ctx.fill();
ctx.globalAlpha = 1;

const y = S * 0.86;
ctx.fillStyle = "rgba(255,255,255,0.16)";
roundRect(S * 0.12, y - 4, S * 0.76, 8, 4);
ctx.fill();
for (const [i, t] of [0.16, 0.34, 0.5, 0.68, 0.84].entries()) {
  ctx.save();
  ctx.translate(S * t, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = i === 2 ? "#7cf0c8" : "#ffb347";
  ctx.fillRect(-13, -13, 26, 26);
  ctx.restore();
}

mkdirSync(resolve("desktop-assets"), { recursive: true });
writeFileSync(resolve("desktop-assets/icon.png"), canvas.toBuffer("image/png"));
console.log("wrote desktop-assets/icon.png", `${S}x${S}`);
