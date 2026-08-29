import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, rm, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = process.env.FFMPEG_BIN || "/private/tmp/rova-video-tools/node_modules/ffmpeg-static/ffmpeg";
const output = resolve(process.argv[2] || resolve(projectRoot, "assets/rova-animated-ad.mp4"));
const poster = resolve(process.argv[3] || resolve(projectRoot, "assets/rova-animated-ad-poster.jpg"));
const silentOutput = `${output}.silent.mp4`;
const audioOutput = `${output}.bed.wav`;

const width = 1280;
const height = 720;
const fps = 30;
// The artwork was originally choreographed on a compact 24-second timeline.
// Stretching that timeline gives each action enough time to read while keeping
// the existing easing, overlaps, and scene-to-scene transitions intact.
const sourceDuration = 24;
const duration = 45;
const playbackScale = sourceDuration / duration;
const totalFrames = fps * duration;

GlobalFonts.registerFromPath("/System/Library/Fonts/Avenir Next.ttc", "Avenir Next");
GlobalFonts.registerFromPath("/System/Library/Fonts/SFNS.ttf", "SF Pro");

const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
const mark = await loadImage(resolve(projectRoot, "assets/rova-mark.svg"));
const product = await loadImage(resolve(projectRoot, "assets/rova-app-preview.jpg"));
const floral = await loadImage(resolve(projectRoot, "assets/floral-jet-hero.png"));

const palette = {
  ink: "#071225",
  navy: "#0b1630",
  navy2: "#111f3d",
  blue: "#315ee7",
  sky: "#7d9bff",
  cyan: "#36d7e6",
  mint: "#70e0b4",
  white: "#f8fbff",
  slate: "#aebbd0",
  line: "rgba(173, 199, 235, 0.18)",
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function easeOut(value) {
  const x = clamp(value);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOut(value) {
  const x = clamp(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function spring(value) {
  const x = clamp(value);
  return 1 - Math.exp(-7 * x) * Math.cos(10 * x);
}

function progress(time, start, end) {
  return clamp((time - start) / (end - start));
}

function sceneAlpha(time, start, end, fade = 0.35) {
  return Math.min(progress(time, start, start + fade), 1 - progress(time, end - fade, end));
}

function roundRect(context, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function fillRoundRect(context, x, y, w, h, radius, fill, stroke = null, lineWidth = 1) {
  roundRect(context, x, y, w, h, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.stroke();
  }
}

function background(context, time, light = false) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  if (light) {
    gradient.addColorStop(0, "#f7fbff");
    gradient.addColorStop(0.54, "#eaf2ff");
    gradient.addColorStop(1, "#dffbf2");
  } else {
    gradient.addColorStop(0, "#061024");
    gradient.addColorStop(0.55, "#0b1730");
    gradient.addColorStop(1, "#111d39");
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(180 + Math.sin(time * 0.6) * 50, 80, 0, 180, 80, 520);
  glow.addColorStop(0, light ? "rgba(49,94,231,0.16)" : "rgba(49,94,231,0.32)");
  glow.addColorStop(1, "rgba(49,94,231,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const glow2 = context.createRadialGradient(1140, 650, 0, 1140, 650, 420);
  glow2.addColorStop(0, light ? "rgba(112,224,180,0.2)" : "rgba(54,215,230,0.15)");
  glow2.addColorStop(1, "rgba(54,215,230,0)");
  context.fillStyle = glow2;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = light ? 0.35 : 0.22;
  context.strokeStyle = light ? "#c4d2e8" : "#27405f";
  context.lineWidth = 1;
  for (let x = -height; x < width + height; x += 92) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
  context.restore();
}

function brandBug(context, light = false) {
  context.save();
  context.globalAlpha = 0.72;
  context.drawImage(mark, 54, 40, 38, 38);
  context.font = "700 18px 'Avenir Next'";
  context.fillStyle = light ? palette.ink : palette.white;
  context.fillText("RIVO", 104, 67);
  context.font = "700 11px 'Avenir Next'";
  context.fillStyle = light ? "#617089" : "#7990af";
  context.fillText("DELIVERY OPERATIONS", 168, 66);
  context.restore();
}

function text(context, value, x, y, size, color = palette.white, weight = 700, align = "left") {
  context.save();
  context.font = `${weight} ${size}px 'Avenir Next'`;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(value, x, y);
  context.restore();
}

function multiline(context, lines, x, y, size, lineHeight, color = palette.white, weight = 700, align = "left") {
  lines.forEach((line, index) => text(context, line, x, y + index * lineHeight, size, color, weight, align));
}

function drawCheck(context, x, y, radius, amount = 1) {
  context.save();
  context.fillStyle = palette.mint;
  context.beginPath();
  context.arc(x, y, radius * spring(amount), 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.ink;
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  const p = clamp(amount * 1.5);
  context.moveTo(x - radius * 0.42, y);
  context.lineTo(x - radius * 0.08 * p, y + radius * 0.34 * p);
  context.lineTo(x + radius * 0.5 * p, y - radius * 0.38 * p);
  context.stroke();
  context.restore();
}

function drawRoute(context, points, amount, widthValue = 8, glow = true) {
  const clamped = clamp(amount);
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const length = Math.hypot(dx, dy);
    segments.push({ start: points[i - 1], end: points[i], length });
    total += length;
  }
  let remaining = total * clamped;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (glow) {
    context.shadowColor = palette.cyan;
    context.shadowBlur = 20;
  }
  const gradient = context.createLinearGradient(points[0][0], points[0][1], points.at(-1)[0], points.at(-1)[1]);
  gradient.addColorStop(0, palette.mint);
  gradient.addColorStop(0.55, palette.cyan);
  gradient.addColorStop(1, palette.sky);
  context.strokeStyle = gradient;
  context.lineWidth = widthValue;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const segment of segments) {
    if (remaining <= 0) break;
    const part = clamp(remaining / segment.length);
    context.lineTo(mix(segment.start[0], segment.end[0], part), mix(segment.start[1], segment.end[1], part));
    remaining -= segment.length;
  }
  context.stroke();
  context.restore();
}

function drawPin(context, x, y, label, amount, color = palette.blue) {
  const scale = spring(amount);
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.fillStyle = color;
  context.beginPath();
  context.arc(0, 0, 16, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = palette.white;
  context.lineWidth = 4;
  context.stroke();
  text(context, label, 0, 6, 15, palette.white, 800, "center");
  context.restore();
}

function drawChaosScene(context, time) {
  const alpha = sceneAlpha(time, 0, 3.3, 0.45);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  const imageScale = 1.02 + progress(time, 0, 3.3) * 0.045;
  const imageWidth = width * imageScale;
  const imageHeight = height * imageScale;
  context.drawImage(floral, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
  const shade = context.createLinearGradient(0, 0, width, height);
  shade.addColorStop(0, "rgba(5,12,28,0.92)");
  shade.addColorStop(0.55, "rgba(5,12,28,0.58)");
  shade.addColorStop(1, "rgba(5,12,28,0.72)");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
  brandBug(context);

  const items = [
    ["NEW ORDER", 74, 155, -230, -20, palette.blue],
    ["WHERE'S MY DELIVERY?", 880, 118, 1380, -60, "#233354"],
    ["ADDRESS CHANGE", 862, 505, 1390, 780, "#233354"],
    ["DRIVER ETA?", 92, 516, -280, 790, "#233354"],
    ["PHOTO PROOF", 984, 325, 1450, 350, "#173c49"],
    ["14 TEXTS", 298, 90, 255, -130, "#173c49"],
    ["STOP #12", 242, 576, 420, 840, palette.blue],
  ];
  items.forEach((item, index) => {
    const local = spring(progress(time, 0.12 + index * 0.08, 0.95 + index * 0.08));
    const x = mix(item[3], item[1], local) + Math.sin(time * 18 + index) * 2.5;
    const y = mix(item[4], item[2], local) + Math.cos(time * 16 + index) * 2;
    const w = 150 + item[0].length * 5.4;
    context.save();
    context.translate(x, y);
    context.rotate(Math.sin(index * 1.7) * 0.045);
    fillRoundRect(context, 0, 0, w, 54, 14, item[5], "rgba(255,255,255,0.16)", 1);
    text(context, item[0], 18, 35, 15, palette.white, 800);
    context.restore();
  });

  const titleIn = spring(progress(time, 1.15, 1.85));
  context.save();
  context.translate(width / 2, height / 2 + 16);
  context.scale(0.9 + titleIn * 0.1, 0.9 + titleIn * 0.1);
  context.globalAlpha *= titleIn;
  fillRoundRect(context, -478, -118, 956, 236, 34, "rgba(4,12,29,0.88)", "rgba(125,155,255,0.22)", 2);
  multiline(context, ["Delivery day shouldn't", "feel this messy."], 0, -18, 70, 80, palette.white, 800, "center");
  text(context, "Orders, texts, routes and status calls—everywhere.", 0, 82, 25, palette.slate, 500, "center");
  context.restore();
  context.restore();
}

function drawMeetScene(context, time) {
  const alpha = sceneAlpha(time, 3.0, 6.35, 0.5);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  brandBug(context);

  const sweep = easeInOut(progress(time, 3.05, 4.18));
  const route = [[-120, 560], [160, 482], [370, 536], [600, 350], [865, 406], [1120, 190], [1400, 220]];
  drawRoute(context, route, sweep, 14, true);

  const reveal = spring(progress(time, 3.72, 4.62));
  context.save();
  context.translate(640, 250);
  context.scale(reveal, reveal);
  context.shadowColor = palette.blue;
  context.shadowBlur = 38;
  context.drawImage(mark, -66, -66, 132, 132);
  context.restore();

  const copyIn = easeOut(progress(time, 4.12, 5.08));
  context.save();
  context.globalAlpha *= copyIn;
  context.translate(0, 28 * (1 - copyIn));
  text(context, "Meet Rivo.", 640, 446, 82, palette.white, 800, "center");
  text(context, "Delivery operations, organized.", 640, 500, 30, palette.slate, 600, "center");
  context.restore();
  context.restore();
}

function orderCard(context, x, y, name, address, amount, selected = false) {
  context.save();
  context.globalAlpha *= clamp(amount);
  context.translate(x + 34 * (1 - easeOut(amount)), y);
  fillRoundRect(context, 0, 0, 590, 88, 18, "rgba(248,251,255,0.98)", "rgba(149,173,208,0.35)", 1.5);
  fillRoundRect(context, 20, 26, 36, 36, 10, selected ? palette.mint : "#edf2fa", selected ? null : "#c4d0e3", 1);
  if (selected) drawCheck(context, 38, 44, 18, amount);
  text(context, name, 76, 38, 19, palette.ink, 800);
  text(context, address, 76, 65, 15, "#71819a", 500);
  fillRoundRect(context, 480, 26, 88, 34, 17, selected ? "#e1f9ee" : "#edf3ff");
  text(context, selected ? "SELECTED" : "READY", 524, 48, 12, selected ? "#07855d" : palette.blue, 800, "center");
  context.restore();
}

function drawBatchScene(context, time) {
  const alpha = sceneAlpha(time, 6.0, 10.25, 0.45);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time, true);
  brandBug(context, true);
  text(context, "Select. Assign. Dispatch.", 72, 132, 58, palette.ink, 800);
  text(context, "Multiple orders. One action.", 74, 174, 24, "#64738b", 600);

  const rows = [
    ["Mina Patel", "170 Bloor St W"],
    ["Riley Chen", "42 Queen St W"],
    ["Lena Brooks", "89 King St E"],
  ];
  rows.forEach((row, index) => {
    const enter = spring(progress(time, 6.25 + index * 0.16, 7.05 + index * 0.16));
    const selected = time > 7.35 + index * 0.18;
    orderCard(context, 72, 222 + index * 104, row[0], row[1], enter, selected);
  });

  const panelIn = spring(progress(time, 7.0, 7.9));
  context.save();
  context.globalAlpha *= panelIn;
  context.translate(mix(1290, 830, panelIn), 246);
  fillRoundRect(context, 0, 0, 368, 284, 26, palette.navy, "rgba(49,94,231,0.28)", 2);
  text(context, "ASSIGN TO", 28, 46, 14, palette.sky, 800);
  context.fillStyle = palette.blue;
  context.beginPath();
  context.arc(66, 116, 34, 0, Math.PI * 2);
  context.fill();
  text(context, "AM", 66, 124, 18, palette.white, 800, "center");
  text(context, "Ava Morgan", 116, 108, 22, palette.white, 800);
  text(context, "3 stops · route ready", 116, 138, 15, palette.slate, 600);
  const buttonAmount = spring(progress(time, 8.42, 9.05));
  fillRoundRect(context, 28, 190, 312, 64, 18, palette.blue);
  text(context, buttonAmount > 0.72 ? "DISPATCHED ✓" : "DISPATCH 3 ORDERS", 184, 230, 16, palette.white, 800, "center");
  context.restore();

  const connect = easeInOut(progress(time, 8.0, 8.72));
  context.save();
  context.strokeStyle = palette.blue;
  context.lineWidth = 3;
  context.setLineDash([8, 10]);
  context.lineDashOffset = -time * 70;
  [266, 370, 474].forEach((y) => {
    context.beginPath();
    context.moveTo(662, y);
    context.bezierCurveTo(740, y, 760, 356, mix(760, 830, connect), 356);
    context.stroke();
  });
  context.restore();
  context.restore();
}

function drawMapScene(context, time) {
  const alpha = sceneAlpha(time, 9.9, 14.35, 0.45);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  brandBug(context);
  text(context, "Build the route.", 72, 138, 58, palette.white, 800);
  text(context, "See every stop.", 72, 196, 58, palette.sky, 800);
  text(context, "Drag the order. The route redraws.", 74, 240, 24, palette.slate, 600);

  const mapIn = spring(progress(time, 10.2, 10.95));
  context.save();
  context.globalAlpha *= mapIn;
  context.translate(mix(1320, 512, mapIn), 96);
  fillRoundRect(context, 0, 0, 690, 540, 30, "#eef4f6", "rgba(125,155,255,0.3)", 2);
  context.save();
  roundRect(context, 0, 0, 690, 540, 30);
  context.clip();
  context.strokeStyle = "#c5d3dd";
  context.lineWidth = 2;
  for (let x = -300; x < 1000; x += 82) {
    context.beginPath();
    context.moveTo(x, -40);
    context.lineTo(x + 330, 600);
    context.stroke();
  }
  for (let y = -160; y < 700; y += 78) {
    context.beginPath();
    context.moveTo(-80, y);
    context.lineTo(760, y + 210);
    context.stroke();
  }
  const oldPoints = [[86, 430], [224, 328], [414, 364], [568, 184], [610, 92]];
  const newPoints = [[86, 430], [414, 364], [224, 328], [568, 184], [610, 92]];
  const redraw = progress(time, 12.78, 13.68);
  const points = oldPoints.map((point, index) => [mix(point[0], newPoints[index][0], easeInOut(redraw)), mix(point[1], newPoints[index][1], easeInOut(redraw))]);
  drawRoute(context, points, easeInOut(progress(time, 10.7, 12.05)), 9, false);
  points.forEach((point, index) => drawPin(context, point[0], point[1], String(index + 1), progress(time, 11.1 + index * 0.14, 11.75 + index * 0.14), index === 0 ? "#0b9a6c" : palette.blue));
  const mover = clamp(progress(time, 11.45, 13.95));
  const routeIndex = Math.min(points.length - 2, Math.floor(mover * (points.length - 1)));
  const local = (mover * (points.length - 1)) - routeIndex;
  const mx = mix(points[routeIndex][0], points[routeIndex + 1][0], local);
  const my = mix(points[routeIndex][1], points[routeIndex + 1][1], local);
  context.fillStyle = palette.ink;
  context.beginPath();
  context.arc(mx, my, 11, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.white;
  context.lineWidth = 3;
  context.stroke();
  context.restore();
  context.restore();
  context.restore();
}

function drawBrowserFrame(context, x, y, w, h, image, crop = null) {
  context.save();
  context.shadowColor = "rgba(0,0,0,0.42)";
  context.shadowBlur = 45;
  context.shadowOffsetY = 24;
  fillRoundRect(context, x, y, w, h, 24, "#050b18", "rgba(255,255,255,0.14)", 2);
  context.shadowBlur = 0;
  fillRoundRect(context, x, y, w, 44, 24, "#0c1830");
  [0, 1, 2].forEach((index) => {
    context.fillStyle = ["#ff7f6f", "#f8d26b", palette.mint][index];
    context.beginPath();
    context.arc(x + 22 + index * 20, y + 22, 5, 0, Math.PI * 2);
    context.fill();
  });
  context.save();
  roundRect(context, x, y + 43, w, h - 43, 18);
  context.clip();
  if (crop) context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, x, y + 43, w, h - 43);
  else context.drawImage(image, x, y + 43, w, h - 43);
  context.restore();
  context.restore();
}

function drawProductScene(context, time) {
  const alpha = sceneAlpha(time, 14.0, 18.25, 0.45);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time, true);
  brandBug(context, true);
  text(context, "One live operations view.", 640, 112, 52, palette.ink, 800, "center");
  text(context, "Orders, routes and drivers—together.", 640, 154, 24, "#607089", 600, "center");

  const frameIn = spring(progress(time, 14.25, 15.15));
  context.save();
  context.translate(640, 428);
  context.rotate(mix(-0.055, 0, easeInOut(progress(time, 14.3, 15.45))));
  context.scale(0.88 + frameIn * 0.12, 0.88 + frameIn * 0.12);
  context.translate(-640, -428);
  drawBrowserFrame(context, 150, 182, 980, 500, product);
  context.restore();

  const pulse = 0.5 + 0.5 * Math.sin((time - 15) * Math.PI * 2);
  context.save();
  context.globalAlpha *= 0.5 + pulse * 0.45;
  context.strokeStyle = palette.cyan;
  context.shadowColor = palette.cyan;
  context.shadowBlur = 20;
  context.lineWidth = 5;
  roundRect(context, 735, 356, 342, 233, 16);
  context.stroke();
  context.restore();
  fillRoundRect(context, 790, 194, 230, 42, 21, palette.ink);
  text(context, "LIVE ROUTES · 3 DRIVERS", 905, 221, 13, palette.mint, 800, "center");
  context.restore();
}

function drawBulkScene(context, time) {
  const alpha = sceneAlpha(time, 17.95, 21.35, 0.45);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  brandBug(context);
  text(context, "Update multiple", 72, 148, 58, palette.white, 800);
  text(context, "orders at once.", 72, 208, 58, palette.sky, 800);
  text(context, "Assign, change status or close the batch.", 74, 252, 23, palette.slate, 600);

  const frameIn = spring(progress(time, 18.2, 18.95));
  context.save();
  context.globalAlpha *= frameIn;
  context.translate(mix(1330, 584, frameIn), 110);
  drawBrowserFrame(context, 0, 0, 620, 500, product, { sx: 0, sy: 95, sw: 680, sh: 540 });
  context.restore();

  const barIn = spring(progress(time, 18.85, 19.55));
  context.save();
  context.globalAlpha *= barIn;
  context.translate(mix(1300, 525, barIn), 538);
  fillRoundRect(context, 0, 0, 670, 92, 24, "rgba(248,251,255,0.98)", "rgba(125,155,255,0.3)", 2);
  text(context, "5 SELECTED", 28, 55, 16, palette.blue, 800);
  fillRoundRect(context, 176, 20, 138, 52, 15, palette.blue);
  fillRoundRect(context, 326, 20, 138, 52, 15, "#e9f0ff");
  fillRoundRect(context, 476, 20, 166, 52, 15, "#e1f9ee");
  text(context, "ASSIGN", 245, 53, 14, palette.white, 800, "center");
  text(context, "ON ROUTE", 395, 53, 14, palette.blue, 800, "center");
  text(context, "DELIVERED ✓", 559, 53, 14, "#07855d", 800, "center");
  context.restore();

  [0, 1, 2, 3, 4].forEach((index) => drawCheck(context, 618, 246 + index * 48, 12, progress(time, 19.05 + index * 0.12, 19.55 + index * 0.12)));
  context.restore();
}

function drawFinalScene(context, time) {
  const alpha = sceneAlpha(time, 21.05, 24.2, 0.42);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  const route = [[-80, 590], [205, 520], [350, 606], [570, 505], [770, 585], [980, 450], [1360, 500]];
  drawRoute(context, route, easeInOut(progress(time, 21.1, 22.2)), 10, true);

  const logoIn = spring(progress(time, 21.25, 22.05));
  context.save();
  context.translate(640, 220);
  context.scale(logoIn, logoIn);
  context.drawImage(mark, -58, -58, 116, 116);
  context.restore();
  const copyIn = easeOut(progress(time, 21.75, 22.45));
  context.globalAlpha *= copyIn;
  text(context, "Rivo", 640, 340, 76, palette.white, 800, "center");
  text(context, "A calmer delivery day starts here.", 640, 402, 34, palette.slate, 600, "center");
  fillRoundRect(context, 430, 454, 420, 78, 23, palette.blue);
  text(context, "SEE RIVO IN ACTION", 640, 493, 17, palette.white, 800, "center");
  text(context, "floraljet.llc", 640, 570, 26, palette.mint, 800, "center");
  context.restore();
}

function drawWorkflowRail(context, activeIndex, light = false) {
  const stages = ["ORDERS", "FULFIL", "ROUTE", "PROOF"];
  const startX = 706;
  const y = 56;
  stages.forEach((stage, index) => {
    const active = index <= activeIndex;
    if (index > 0) {
      context.strokeStyle = active ? (light ? "rgba(49,94,231,0.55)" : "rgba(112,224,180,0.56)") : (light ? "rgba(26,43,72,0.14)" : "rgba(255,255,255,0.12)");
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(startX + index * 128 - 76, y);
      context.lineTo(startX + index * 128 - 18, y);
      context.stroke();
    }
    context.fillStyle = active ? (light ? palette.blue : palette.mint) : (light ? "#d8e1ef" : "#2a3853");
    context.beginPath();
    context.arc(startX + index * 128 - 90, y, active ? 7 : 5, 0, Math.PI * 2);
    context.fill();
    text(context, stage, startX + index * 128 - 72, y + 5, 11, active ? (light ? palette.ink : palette.white) : (light ? "#8a98ac" : "#71809a"), 800);
  });
}

function drawCursor(context, x, y, amount = 1, pressed = false) {
  const scale = 0.82 + spring(amount) * 0.18;
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.shadowColor = "rgba(6,18,37,0.28)";
  context.shadowBlur = 12;
  context.fillStyle = palette.white;
  context.strokeStyle = palette.ink;
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(4, 31);
  context.lineTo(12, 23);
  context.lineTo(20, 39);
  context.lineTo(27, 35);
  context.lineTo(19, 20);
  context.lineTo(32, 18);
  context.closePath();
  context.fill();
  context.stroke();
  if (pressed) {
    context.strokeStyle = palette.cyan;
    context.lineWidth = 3;
    context.globalAlpha = 0.8;
    context.beginPath();
    context.arc(10, 12, 22, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawV2HookScene(context, time) {
  const alpha = sceneAlpha(time, 0, 3.25, 0.35);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  const zoom = 1.03 + progress(time, 0, 3.25) * 0.04;
  const imageWidth = width * zoom;
  const imageHeight = height * zoom;
  context.drawImage(floral, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
  const overlay = context.createLinearGradient(0, 0, width, 0);
  overlay.addColorStop(0, "rgba(4,12,28,0.96)");
  overlay.addColorStop(0.58, "rgba(4,12,28,0.79)");
  overlay.addColorStop(1, "rgba(4,12,28,0.58)");
  context.fillStyle = overlay;
  context.fillRect(0, 0, width, height);
  brandBug(context);

  const headlineIn = easeOut(progress(time, 0.18, 1.0));
  context.save();
  context.translate(0, 32 * (1 - headlineIn));
  context.globalAlpha *= headlineIn;
  fillRoundRect(context, 64, 132, 218, 36, 18, "rgba(112,224,180,0.14)", "rgba(112,224,180,0.38)");
  text(context, "LOCAL DELIVERY, CONTROLLED", 173, 156, 12, palette.mint, 800, "center");
  multiline(context, ["Every order.", "One clear plan."], 64, 252, 76, 84, palette.white, 800);
  text(context, "Own drivers, courier partners, or both.", 66, 448, 27, "#d6e1f3", 600);
  context.restore();

  const orders = [
    { source: "SHOPIFY", name: "King Street Flowers", status: "READY", color: "#7f5af0" },
    { source: "WIX", name: "Harbour Pharmacy", status: "PRIORITY", color: palette.blue },
    { source: "PHONE", name: "Rosewood Events", status: "TIMED", color: "#df7d43" },
  ];
  orders.forEach((order, index) => {
    const enter = spring(progress(time, 0.6 + index * 0.2, 1.45 + index * 0.2));
    const x = mix(1320, 786, enter);
    const y = 164 + index * 126;
    context.save();
    context.globalAlpha *= enter;
    context.translate(x, y);
    fillRoundRect(context, 0, 0, 424, 102, 22, "rgba(248,251,255,0.96)", "rgba(255,255,255,0.28)", 1.5);
    fillRoundRect(context, 20, 20, 74, 28, 14, `${order.color}22`);
    text(context, order.source, 57, 39, 11, order.color, 800, "center");
    text(context, order.name, 20, 75, 19, palette.ink, 800);
    fillRoundRect(context, 310, 34, 92, 34, 17, order.status === "READY" ? "#dff7ed" : "#eef2ff");
    text(context, order.status, 356, 56, 11, order.status === "READY" ? "#087c59" : palette.blue, 800, "center");
    context.restore();
  });

  const lineIn = easeInOut(progress(time, 1.6, 2.45));
  const gradient = context.createLinearGradient(66, 0, 1198, 0);
  gradient.addColorStop(0, palette.mint);
  gradient.addColorStop(0.55, palette.cyan);
  gradient.addColorStop(1, palette.sky);
  context.strokeStyle = gradient;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(66, 600);
  context.lineTo(mix(66, 1198, lineIn), 600);
  context.stroke();
  text(context, "FROM ORDER INTAKE TO COMPLETION RECORD", 66, 641, 13, "#9fb0c8", 800);
  context.restore();
}

function drawSourceTile(context, x, y, label, accent, amount) {
  context.save();
  context.globalAlpha *= clamp(amount);
  context.translate(x - 32 * (1 - easeOut(amount)), y);
  fillRoundRect(context, 0, 0, 176, 74, 18, "rgba(248,251,255,0.98)", "rgba(138,160,194,0.26)", 1.5);
  fillRoundRect(context, 16, 17, 40, 40, 12, `${accent}20`);
  text(context, label.slice(0, 1), 36, 45, 18, accent, 800, "center");
  text(context, label, 70, 44, 15, palette.ink, 800);
  context.restore();
}

function drawV2IntakeScene(context, time) {
  const alpha = sceneAlpha(time, 2.9, 6.35, 0.42);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time, true);
  brandBug(context, true);
  drawWorkflowRail(context, 0, true);
  text(context, "Orders arrive.", 64, 145, 58, palette.ink, 800);
  text(context, "Rivo organizes.", 64, 204, 58, palette.blue, 800);
  text(context, "Bring delivery work into one clean queue.", 66, 250, 23, "#63728a", 600);

  const sources = [
    ["Shopify", "#6aab3f"],
    ["WooCommerce", "#8a5dd7"],
    ["Wix", "#315ee7"],
    ["API", "#0c9871"],
  ];
  sources.forEach((source, index) => drawSourceTile(context, 66 + (index % 2) * 194, 316 + Math.floor(index / 2) * 96, source[0], source[1], progress(time, 3.1 + index * 0.1, 3.72 + index * 0.1)));

  const queueIn = spring(progress(time, 3.45, 4.25));
  context.save();
  context.globalAlpha *= queueIn;
  context.translate(mix(1320, 548, queueIn), 126);
  fillRoundRect(context, 0, 0, 650, 500, 30, palette.navy, "rgba(49,94,231,0.24)", 2);
  text(context, "ORDER QUEUE", 32, 48, 13, palette.sky, 800);
  text(context, "8 ready to dispatch", 32, 88, 30, palette.white, 800);
  fillRoundRect(context, 518, 32, 98, 36, 18, "rgba(112,224,180,0.14)", "rgba(112,224,180,0.28)");
  text(context, "LIVE", 567, 56, 12, palette.mint, 800, "center");
  const rows = [
    ["Mina Patel", "170 Bloor St W", "10–12"],
    ["Riley Chen", "42 Queen St W", "Before 2"],
    ["Lena Brooks", "89 King St E", "Same-day"],
    ["Noah Wilson", "18 Yorkville Ave", "Ready"],
  ];
  rows.forEach((row, index) => {
    const rowIn = spring(progress(time, 3.82 + index * 0.14, 4.48 + index * 0.14));
    context.save();
    context.globalAlpha *= rowIn;
    context.translate(24 + 28 * (1 - rowIn), 122 + index * 86);
    fillRoundRect(context, 0, 0, 602, 70, 16, "rgba(255,255,255,0.065)", "rgba(255,255,255,0.09)");
    context.fillStyle = index === 1 ? "#df7d43" : palette.blue;
    context.beginPath();
    context.arc(24, 35, 6, 0, Math.PI * 2);
    context.fill();
    text(context, row[0], 44, 31, 17, palette.white, 800);
    text(context, row[1], 44, 53, 13, palette.slate, 500);
    fillRoundRect(context, 474, 19, 108, 32, 16, index === 1 ? "rgba(223,125,67,0.16)" : "rgba(125,155,255,0.13)");
    text(context, row[2].toUpperCase(), 528, 40, 10, index === 1 ? "#ffb283" : palette.sky, 800, "center");
    context.restore();
  });
  context.restore();

  const pulse = progress(time, 4.3, 5.25);
  context.save();
  context.strokeStyle = `rgba(49,94,231,${0.2 + pulse * 0.5})`;
  context.lineWidth = 4;
  context.setLineDash([8, 10]);
  context.lineDashOffset = -time * 80;
  [[418, 353], [418, 449]].forEach(([x, y]) => {
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(470, y, 490, 360, 548, 360);
    context.stroke();
  });
  context.restore();
  context.restore();
}

function drawCompactOrder(context, x, y, name, address, index, time, start) {
  const enter = spring(progress(time, start, start + 0.65));
  const selected = progress(time, start + 0.72, start + 1.1);
  context.save();
  context.globalAlpha *= enter;
  context.translate(x + 30 * (1 - enter), y);
  fillRoundRect(context, 0, 0, 560, 76, 17, "rgba(248,251,255,0.98)", selected > 0.3 ? "rgba(49,94,231,0.58)" : "rgba(142,161,191,0.27)", selected > 0.3 ? 2 : 1.2);
  fillRoundRect(context, 18, 20, 36, 36, 10, selected > 0.3 ? palette.blue : "#edf2fa", selected > 0.3 ? null : "#bdcadc");
  if (selected > 0.3) {
    context.strokeStyle = palette.white;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(27, 38);
    context.lineTo(34, 45);
    context.lineTo(47, 30);
    context.stroke();
  }
  text(context, name, 72, 32, 17, palette.ink, 800);
  text(context, address, 72, 55, 13, "#6b7a92", 500);
  fillRoundRect(context, 458, 22, 82, 32, 16, "#eef2ff");
  text(context, `STOP ${index}`, 499, 43, 10, palette.blue, 800, "center");
  context.restore();
}

function drawFulfilmentCard(context, x, y, title, subtitle, detail, selected, amount, accent) {
  context.save();
  context.globalAlpha *= clamp(amount);
  context.translate(x, y + 18 * (1 - easeOut(amount)));
  fillRoundRect(context, 0, 0, 454, 112, 22, selected ? "rgba(49,94,231,0.11)" : "rgba(248,251,255,0.97)", selected ? palette.blue : "rgba(139,160,193,0.32)", selected ? 3 : 1.5);
  fillRoundRect(context, 18, 20, 56, 56, 18, `${accent}22`);
  text(context, title.slice(0, 1), 46, 57, 23, accent, 800, "center");
  text(context, title, 92, 38, 18, palette.ink, 800);
  text(context, subtitle, 92, 63, 14, "#687891", 600);
  text(context, detail, 92, 88, 12, selected ? palette.blue : "#8794a8", 700);
  context.beginPath();
  context.arc(420, 30, 10, 0, Math.PI * 2);
  context.fillStyle = selected ? palette.blue : "#e1e8f1";
  context.fill();
  if (selected) {
    context.fillStyle = palette.white;
    context.beginPath();
    context.arc(420, 30, 4, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawV2ChoiceScene(context, time) {
  const alpha = sceneAlpha(time, 6.0, 10.45, 0.42);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time, true);
  brandBug(context, true);
  drawWorkflowRail(context, 1, true);
  text(context, "Select the batch.", 64, 132, 54, palette.ink, 800);
  text(context, "Choose the delivery.", 64, 190, 54, palette.blue, 800);
  text(context, "Driver team or courier coverage.", 66, 232, 22, "#67768c", 600);

  const orders = [
    ["Mina Patel", "170 Bloor St W"],
    ["Riley Chen", "42 Queen St W"],
    ["Lena Brooks", "89 King St E"],
    ["Noah Wilson", "18 Yorkville Ave"],
  ];
  orders.forEach((order, index) => drawCompactOrder(context, 64, 282 + index * 86, order[0], order[1], index + 1, time, 6.2 + index * 0.08));
  const countIn = spring(progress(time, 7.28, 7.8));
  fillRoundRect(context, 454, 218, 170, 42, 21, palette.ink);
  text(context, `${Math.round(countIn * 4)} SELECTED`, 539, 245, 13, palette.mint, 800, "center");

  const chooseCourier = progress(time, 7.65, 8.1);
  const cardIn = progress(time, 6.65, 7.45);
  drawFulfilmentCard(context, 736, 248, "Own driver", "Ava Morgan · available", "4 stops · route ready", chooseCourier < 0.55, cardIn, "#315ee7");
  drawFulfilmentCard(context, 736, 380, "Courier partner", "Capital Courier · same-day", "Request, fee, ref + tracking", chooseCourier >= 0.55, cardIn, "#0c9871");

  const cursorX = mix(1128, 1082, easeInOut(progress(time, 7.28, 7.9)));
  const cursorY = mix(338, 432, easeInOut(progress(time, 7.28, 7.9)));
  drawCursor(context, cursorX, cursorY, progress(time, 7.1, 7.55), progress(time, 7.82, 8.12) > 0.25 && progress(time, 7.82, 8.12) < 0.9);

  const buttonIn = spring(progress(time, 8.0, 8.55));
  context.save();
  context.globalAlpha *= buttonIn;
  fillRoundRect(context, 736, 532, 454, 70, 20, palette.blue);
  const requested = progress(time, 8.72, 9.18);
  text(context, requested > 0.65 ? "REQUESTED 4 ORDERS" : "REQUEST COURIER · 4 ORDERS", 963, 575, 15, palette.white, 800, "center");
  if (requested > 0.65) drawCheck(context, 1128, 567, 12, requested);
  context.restore();
  const toastIn = sceneAlpha(time, 9.02, 10.35, 0.25);
  context.save();
  context.globalAlpha *= toastIn;
  fillRoundRect(context, 764, 626, 400, 48, 16, "#dcf8ed", "rgba(12,152,113,0.2)");
  text(context, "Request status stays beside every order", 964, 657, 13, "#087c59", 800, "center");
  context.restore();
  context.restore();
}

function drawStopRow(context, x, y, order, name, active, amount) {
  context.save();
  context.globalAlpha *= clamp(amount);
  context.translate(x, y);
  fillRoundRect(context, 0, 0, 380, 86, 18, active ? "rgba(49,94,231,0.13)" : "rgba(255,255,255,0.055)", active ? "rgba(125,155,255,0.5)" : "rgba(255,255,255,0.09)", active ? 2 : 1);
  text(context, "⋮⋮", 20, 50, 20, active ? palette.sky : "#65738a", 800);
  fillRoundRect(context, 48, 20, 46, 46, 15, active ? palette.blue : "#25334d");
  text(context, String(order), 71, 50, 16, palette.white, 800, "center");
  text(context, name, 112, 38, 16, palette.white, 800);
  text(context, active ? "Moving stop" : "Ready", 112, 61, 12, active ? palette.mint : palette.slate, 600);
  context.restore();
}

function drawV2RouteScene(context, time) {
  const alpha = sceneAlpha(time, 10.1, 14.85, 0.42);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  brandBug(context);
  drawWorkflowRail(context, 2, false);
  text(context, "Route preview.", 60, 132, 52, palette.white, 800);
  text(context, "Drag to reorder.", 60, 190, 52, palette.sky, 800);
  text(context, "The line redraws instantly.", 62, 232, 22, palette.slate, 600);

  const reorder = easeInOut(progress(time, 12.1, 13.1));
  const rows = [
    { order: 1, name: "King Street Flowers", from: 292, to: 292 },
    { order: 2, name: "Harbour Pharmacy", from: 388, to: 484 },
    { order: 3, name: "Rosewood Events", from: 484, to: 388 },
  ];
  rows.forEach((row, index) => {
    const y = mix(row.from, row.to, reorder);
    const active = index === 2 && reorder > 0.05 && reorder < 0.95;
    drawStopRow(context, 60, y, row.order, row.name, active, progress(time, 10.28 + index * 0.1, 10.88 + index * 0.1));
  });

  const mapIn = spring(progress(time, 10.35, 11.08));
  context.save();
  context.globalAlpha *= mapIn;
  context.translate(mix(1320, 500, mapIn), 118);
  fillRoundRect(context, 0, 0, 720, 532, 28, "#eef4f6", "rgba(125,155,255,0.34)", 2);
  context.save();
  roundRect(context, 0, 0, 720, 532, 28);
  context.clip();
  context.fillStyle = "#eef3f4";
  context.fillRect(0, 0, 720, 532);
  context.strokeStyle = "#cfd9df";
  context.lineWidth = 2;
  for (let x = -380; x < 980; x += 76) {
    context.beginPath();
    context.moveTo(x, -80);
    context.lineTo(x + 380, 620);
    context.stroke();
  }
  for (let y = -240; y < 800; y += 74) {
    context.beginPath();
    context.moveTo(-100, y);
    context.lineTo(820, y + 230);
    context.stroke();
  }
  context.strokeStyle = "rgba(255,255,255,0.95)";
  context.lineWidth = 8;
  for (let y = 40; y < 620; y += 138) {
    context.beginPath();
    context.moveTo(-40, y);
    context.bezierCurveTo(220, y - 60, 420, y + 70, 790, y - 16);
    context.stroke();
  }
  const original = [[84, 432], [234, 328], [406, 382], [574, 226], [646, 96]];
  const revised = [[84, 432], [406, 382], [234, 328], [574, 226], [646, 96]];
  const points = original.map((point, index) => [mix(point[0], revised[index][0], reorder), mix(point[1], revised[index][1], reorder)]);
  drawRoute(context, points, easeInOut(progress(time, 10.78, 11.72)), 10, false);
  points.forEach((point, index) => drawPin(context, point[0], point[1], String(index + 1), progress(time, 11.0 + index * 0.11, 11.58 + index * 0.11), index === 0 ? "#0c9871" : palette.blue));
  const driverProgress = clamp(progress(time, 11.35, 14.25));
  const segmentCount = points.length - 1;
  const scaled = driverProgress * segmentCount;
  const segment = Math.min(segmentCount - 1, Math.floor(scaled));
  const local = scaled - segment;
  const px = mix(points[segment][0], points[segment + 1][0], local);
  const py = mix(points[segment][1], points[segment + 1][1], local);
  context.fillStyle = palette.ink;
  context.beginPath();
  context.arc(px, py, 12, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.white;
  context.lineWidth = 3;
  context.stroke();
  context.restore();
  fillRoundRect(context, 26, 24, 184, 42, 21, "rgba(248,251,255,0.94)");
  text(context, reorder > 0.78 ? "ROUTE UPDATED" : "ROUTE PREVIEW", 118, 51, 12, reorder > 0.78 ? "#087c59" : palette.blue, 800, "center");
  fillRoundRect(context, 534, 454, 156, 52, 18, palette.ink);
  text(context, "4 STOPS · 31 MIN", 612, 486, 12, palette.mint, 800, "center");
  context.restore();
  context.restore();
}

function drawPhone(context, x, y, w, h, amount) {
  context.save();
  context.globalAlpha *= clamp(amount);
  context.translate(x, y + 24 * (1 - easeOut(amount)));
  context.shadowColor = "rgba(0,0,0,0.3)";
  context.shadowBlur = 34;
  fillRoundRect(context, 0, 0, w, h, 38, "#071225", "rgba(255,255,255,0.22)", 2);
  context.shadowBlur = 0;
  fillRoundRect(context, w / 2 - 46, 14, 92, 20, 10, "#111b2d");
  context.restore();
}

function drawV2DeliveryScene(context, time) {
  const alpha = sceneAlpha(time, 14.55, 19.75, 0.42);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time, true);
  brandBug(context, true);
  drawWorkflowRail(context, 3, true);
  text(context, "Deliver with proof.", 62, 130, 52, palette.ink, 800);
  text(context, "Keep customers informed.", 62, 187, 52, palette.blue, 800);
  text(context, "One update for dispatch, driver and customer.", 64, 230, 21, "#69788f", 600);

  const phoneIn = spring(progress(time, 14.82, 15.52));
  drawPhone(context, 66, 274, 290, 390, phoneIn);
  context.save();
  context.globalAlpha *= phoneIn;
  text(context, "DRIVER APP", 92, 326, 11, palette.sky, 800);
  text(context, "King Street Flowers", 92, 362, 18, palette.white, 800);
  text(context, "181 Bay St, Toronto", 92, 389, 13, palette.slate, 500);
  fillRoundRect(context, 92, 420, 238, 50, 16, "rgba(49,94,231,0.2)", "rgba(125,155,255,0.34)");
  text(context, "ARRIVED AT STOP", 211, 451, 13, palette.sky, 800, "center");
  const proofReady = progress(time, 16.35, 17.0);
  fillRoundRect(context, 92, 486, 238, 106, 18, proofReady > 0.55 ? "rgba(112,224,180,0.17)" : "rgba(255,255,255,0.06)", proofReady > 0.55 ? "rgba(112,224,180,0.42)" : "rgba(255,255,255,0.1)");
  context.save();
  roundRect(context, 104, 498, 82, 82, 13);
  context.clip();
  context.drawImage(floral, 104, 498, 82, 82);
  context.restore();
  text(context, proofReady > 0.55 ? "Photo attached" : "Add photo proof", 202, 529, 15, palette.white, 800);
  text(context, proofReady > 0.55 ? "Ready to complete" : "Optional signature", 202, 555, 12, proofReady > 0.55 ? palette.mint : palette.slate, 600);
  fillRoundRect(context, 92, 608, 238, 42, 15, proofReady > 0.55 ? "#0c9871" : palette.blue);
  text(context, proofReady > 0.55 ? "DELIVERED" : "COMPLETE DELIVERY", 202, 635, 12, palette.white, 800, "center");
  if (proofReady > 0.55) drawCheck(context, 304, 629, 11, proofReady);
  context.restore();

  const trackingIn = spring(progress(time, 15.15, 15.9));
  context.save();
  context.globalAlpha *= trackingIn;
  context.translate(mix(1300, 418, trackingIn), 278);
  fillRoundRect(context, 0, 0, 790, 386, 28, palette.white, "rgba(137,158,191,0.28)", 1.5);
  text(context, "CUSTOMER TRACKING", 30, 46, 11, palette.blue, 800);
  text(context, time > 17.15 ? "Delivered" : "On the way", 30, 92, 34, palette.ink, 800);
  text(context, time > 17.15 ? "Photo proof is ready." : "Your delivery is moving.", 30, 124, 16, "#6e7d92", 600);
  fillRoundRect(context, 30, 152, 456, 198, 20, "#edf3f5");
  context.save();
  roundRect(context, 30, 152, 456, 198, 20);
  context.clip();
  context.strokeStyle = "#d1dbe2";
  context.lineWidth = 2;
  for (let x = -120; x < 620; x += 68) {
    context.beginPath();
    context.moveTo(30 + x, 140);
    context.lineTo(240 + x, 370);
    context.stroke();
  }
  for (let y = 130; y < 390; y += 58) {
    context.beginPath();
    context.moveTo(12, y);
    context.lineTo(520, y + 86);
    context.stroke();
  }
  const trackPoints = [[74, 310], [178, 282], [256, 226], [362, 242], [444, 184]];
  drawRoute(context, trackPoints, easeInOut(progress(time, 15.45, 17.15)), 8, false);
  drawPin(context, 444, 184, "4", progress(time, 16.7, 17.28), "#0c9871");
  context.restore();
  const proofCardIn = progress(time, 17.0, 17.62);
  context.save();
  context.globalAlpha *= proofCardIn;
  fillRoundRect(context, 518, 152, 242, 198, 20, "#071225");
  text(context, "COMPLETION RECORD", 538, 183, 10, palette.sky, 800);
  drawCheck(context, 638, 236, 27, proofCardIn);
  text(context, "Delivered", 638, 286, 22, palette.white, 800, "center");
  text(context, "Photo · time · outcome", 638, 315, 12, palette.slate, 600, "center");
  context.restore();
  context.restore();
  context.restore();
}

function drawV2ControlScene(context, time) {
  const alpha = sceneAlpha(time, 19.45, 22.35, 0.38);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  brandBug(context);
  const copyIn = easeOut(progress(time, 19.6, 20.12));
  context.save();
  context.globalAlpha *= copyIn;
  text(context, "Every stop has", 62, 146, 52, palette.white, 800);
  text(context, "an owner and a record.", 62, 202, 52, palette.sky, 800);
  text(context, "Dispatch without losing the details.", 64, 246, 22, palette.slate, 600);
  const chips = ["ASSIGNED", "ROUTE", "TRACKING", "PROOF", "MILEAGE"];
  chips.forEach((chip, index) => {
    const chipIn = spring(progress(time, 19.92 + index * 0.1, 20.42 + index * 0.1));
    context.save();
    context.globalAlpha *= chipIn;
    fillRoundRect(context, 64 + (index % 2) * 146, 302 + Math.floor(index / 2) * 58, 132, 42, 21, index === 4 ? "rgba(112,224,180,0.14)" : "rgba(125,155,255,0.12)", index === 4 ? "rgba(112,224,180,0.3)" : "rgba(125,155,255,0.22)");
    text(context, chip, 130 + (index % 2) * 146, 329 + Math.floor(index / 2) * 58, 11, index === 4 ? palette.mint : palette.sky, 800, "center");
    context.restore();
  });
  context.restore();

  const frameIn = spring(progress(time, 19.72, 20.42));
  context.save();
  context.globalAlpha *= frameIn;
  context.translate(mix(1380, 470, frameIn), 112);
  context.rotate(mix(0.045, 0, easeInOut(progress(time, 19.72, 20.65))));
  drawBrowserFrame(context, 0, 0, 760, 520, product);
  const sweep = 0.5 + Math.sin(time * 3.2) * 0.12;
  context.strokeStyle = `rgba(54,215,230,${0.36 + sweep})`;
  context.lineWidth = 4;
  context.shadowColor = palette.cyan;
  context.shadowBlur = 18;
  roundRect(context, 430, 182, 286, 260, 16);
  context.stroke();
  context.restore();
  context.restore();
}

function drawV2FinalScene(context, time) {
  const alpha = sceneAlpha(time, 21.95, 24.15, 0.32);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  background(context, time);
  const route = [[-100, 598], [186, 532], [356, 614], [574, 506], [778, 585], [984, 460], [1380, 510]];
  drawRoute(context, route, easeInOut(progress(time, 21.98, 22.78)), 11, true);
  const logoIn = spring(progress(time, 22.0, 22.56));
  context.save();
  context.translate(640, 164);
  context.scale(logoIn, logoIn);
  context.drawImage(mark, -48, -48, 96, 96);
  context.restore();
  const copyIn = easeOut(progress(time, 22.22, 22.78));
  context.globalAlpha *= copyIn;
  text(context, "RIVO BY FLORALJET", 640, 230, 13, palette.mint, 800, "center");
  text(context, "Own drivers. Courier partners.", 640, 286, 48, palette.white, 800, "center");
  text(context, "One delivery control room.", 640, 342, 48, palette.sky, 800, "center");
  fillRoundRect(context, 398, 404, 484, 78, 24, palette.blue);
  text(context, "SEE YOUR DELIVERY DAY IN RIVO", 640, 451, 16, palette.white, 800, "center");
  text(context, "floraljet.llc", 640, 537, 27, palette.mint, 800, "center");
  context.restore();
}

function drawFrame(time) {
  ctx.clearRect(0, 0, width, height);
  drawV2HookScene(ctx, time);
  drawV2IntakeScene(ctx, time);
  drawV2ChoiceScene(ctx, time);
  drawV2RouteScene(ctx, time);
  drawV2DeliveryScene(ctx, time);
  drawV2ControlScene(ctx, time);
  drawV2FinalScene(ctx, time);
}

async function waitForExit(process, label) {
  const [code] = await once(process, "exit");
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
}

async function createAudioBed(path) {
  const sampleRate = 48000;
  const channels = 2;
  const bytesPerSample = 2;
  const sampleCount = Math.floor(sampleRate * duration);
  const dataSize = sampleCount * channels * bytesPerSample;
  const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);

  const chords = [
    [130.81, 164.81, 196.0],
    [98.0, 123.47, 146.83],
    [87.31, 110.0, 130.81],
    [98.0, 123.47, 146.83],
  ];
  // A bright major-key product-demo bed: cheerful forward motion without a
  // lead melody competing with the on-screen product copy.
  const bpm = 116;
  const beatLength = 60 / bpm;
  const halfBeatLength = beatLength / 2;
  const chordDuration = beatLength * 4;
  const transitionBeats = [0, 2.9, 6.0, 10.1, 14.55, 19.45, 21.95]
    .map((beat) => beat / playbackScale);
  let noiseState = 0x5f3759df;
  let smoothNoise = 0;
  const nextNoise = () => {
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    return (noiseState / 4294967296) * 2 - 1;
  };

  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const chordIndex = Math.floor(t / chordDuration) % chords.length;
    const chordTime = t % chordDuration;
    const edgeEnvelope = Math.min(1, chordTime / 0.24, (chordDuration - chordTime) / 0.34);
    const chord = chords[chordIndex];
    const beatTime = t % beatLength;
    const beatIndex = Math.floor(t / beatLength);
    const padDuck = 0.66 + 0.34 * easeOut(progress(beatTime, 0, 0.2));
    let left = 0;
    let right = 0;

    chord.forEach((frequency, noteIndex) => {
      const drift = Math.sin(2 * Math.PI * (0.08 + noteIndex * 0.025) * t) * 0.8;
      const phase = 2 * Math.PI * (frequency + drift) * t;
      const pad = (Math.sin(phase) + Math.sin(phase * 2) * 0.08) * 0.014 * edgeEnvelope * padDuck;
      left += pad * (noteIndex === 2 ? 0.78 : 1);
      right += (Math.sin(phase + 0.018 * (noteIndex + 1)) + Math.sin(phase * 2 + 0.03) * 0.08) * 0.014 * edgeEnvelope * padDuck * (noteIndex === 0 ? 0.78 : 1);
    });

    const bassEnvelope = Math.exp(-beatTime * 5.8) * Math.min(1, beatTime * 45);
    const bassActive = beatIndex % 4 === 0 || beatIndex % 4 === 2;
    const bass = bassActive ? Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.052 * bassEnvelope * edgeEnvelope : 0;
    left += bass;
    right += bass;

    const chordPulseLength = beatLength * 2;
    const chordPulseTime = t % chordPulseLength;
    const chordPulseEnvelope = Math.exp(-chordPulseTime * 3.2) * Math.min(1, chordPulseTime * 38);
    chord.forEach((frequency, noteIndex) => {
      const tone = (Math.sin(2 * Math.PI * frequency * 2 * t) + Math.sin(2 * Math.PI * frequency * 4 * t) * 0.06) * 0.0075 * chordPulseEnvelope;
      left += tone * (noteIndex === 2 ? 0.76 : 1);
      right += tone * (noteIndex === 0 ? 0.76 : 1);
    });

    const kickPhase = 2 * Math.PI * (94 * beatTime - 62 * beatTime * beatTime);
    const kick = Math.sin(kickPhase) * Math.exp(-beatTime * 18) * 0.082;
    left += kick;
    right += kick;

    const rawNoise = nextNoise();
    smoothNoise = smoothNoise * 0.72 + rawNoise * 0.28;
    const backbeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
    if (backbeat && beatTime < 0.14) {
      const clapEnvelope = Math.exp(-beatTime * 24) * Math.min(1, beatTime * 90);
      const clap = (rawNoise * 0.7 + smoothNoise * 0.3) * 0.024 * clapEnvelope;
      left += clap * 0.88;
      right += clap;
    }

    const halfBeatTime = t % halfBeatLength;
    const halfBeatIndex = Math.floor(t / halfBeatLength);
    const hat = rawNoise * Math.exp(-halfBeatTime * 64) * (halfBeatIndex % 2 ? 0.01 : 0.006);
    left += hat * 0.72;
    right -= hat * 0.72;

    for (const beat of transitionBeats) {
      const delta = t - beat;
      if (delta >= 0 && delta < 0.32) {
        const kickEnvelope = Math.exp(-delta * 13);
        const kickFrequency = 92 - delta * 120;
        const kick = Math.sin(2 * Math.PI * kickFrequency * delta) * 0.08 * kickEnvelope;
        left += kick;
        right += kick;
      }
      const whooshDelta = t - (beat - 0.24);
      if (whooshDelta >= 0 && whooshDelta < 0.3) {
        const whooshEnvelope = Math.sin(Math.PI * (whooshDelta / 0.3));
        const whoosh = nextNoise() * 0.009 * whooshEnvelope;
        left += whoosh * (0.6 + whooshDelta);
        right += whoosh * (0.9 - whooshDelta);
      }
    }

    const masterFade = Math.min(1, t / 0.55, (duration - t) / 0.9);
    left = Math.tanh(left * 1.5) * masterFade;
    right = Math.tanh(right * 1.5) * masterFade;
    wav.writeInt16LE(Math.round(clamp(left, -1, 1) * 32767), 44 + index * 4);
    wav.writeInt16LE(Math.round(clamp(right, -1, 1) * 32767), 46 + index * 4);
  }

  await writeFile(path, wav);
}

if (process.env.ROVA_REUSE_VIDEO === "1") {
  await copyFile(output, silentOutput);
  console.log("Reusing the validated video stream");
} else {
  const encoder = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", silentOutput,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const outputTime = frame / fps;
    drawFrame(outputTime * playbackScale);
    const png = await canvas.encode("png");
    if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
    if (frame % (fps * 2) === 0) console.log(`Rendered ${frame}/${totalFrames} frames`);
  }
  encoder.stdin.end();
  await waitForExit(encoder, "Video render");
}

await createAudioBed(audioOutput);
const audioFilter = `[1:a]loudnorm=I=-17.5:TP=-1.5:LRA=7,afade=t=in:st=0:d=0.55,afade=t=out:st=${duration - 1.25}:d=1.25[a]`;
const muxer = spawn(ffmpeg, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", silentOutput,
  "-i", audioOutput,
  "-filter_complex", audioFilter,
  "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
  "-shortest", "-movflags", "+faststart", output,
], { stdio: ["ignore", "inherit", "inherit"] });

try {
  await waitForExit(muxer, "Audio mix");
} catch {
  await copyFile(silentOutput, output);
}

const posterProcess = spawn(ffmpeg, [
  "-hide_banner", "-loglevel", "error", "-y", "-ss", String(8.65 / playbackScale), "-i", output,
  "-frames:v", "1", "-q:v", "2", poster,
], { stdio: ["ignore", "inherit", "inherit"] });
await waitForExit(posterProcess, "Poster extraction");
await rm(silentOutput, { force: true });
await rm(audioOutput, { force: true });

console.log(`Created ${output}`);
console.log(`Created ${poster}`);
