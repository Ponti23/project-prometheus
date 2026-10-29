// Prometheus's face: the "Block" direction from the Notch Face Kit. Two rounded squares on a black
// notch that glide between expressions. Every `.face` element on the page mirrors the same live face.
const CX = 80, CY = 20, RADIUS = 4.5, SCAN = 4;

const P = (w, t, b, x, y = 0, rot = 0, s = 0, sb = 0) => ({ w, t, b, x, y, rot, s, sb });
const mir = (e) => ({ ...e, x: -e.x, rot: -e.rot, s: -e.s, sb: -e.sb });
const both = (e) => [e, mir(e)];

// Presets and accents come straight from the kit's expressions.json (block direction).
const PRESETS = {
  idle: { accent: "#F2F4F8", eyes: both(P(14, 6.5, 6.5, -8.2)) },
  blink: { accent: "#F2F4F8", eyes: both(P(14, 0.5, 0.5, -8.2, 1)) },
  listening: { accent: "#7CC4FF", eyes: both(P(14.5, 8, 8, -8.5, -1)) },
  thinking: { accent: "#B9A8FF", eyes: [P(13, 6, 4, -6, -2), P(13, 6, 4, 10.4, -2)], motion: "scan" },
  speaking: { accent: "#8EF0D0", eyes: both(P(14, 6.5, 6.5, -8.2)), motion: "pulse" },
  happy: { accent: "#FFD27A", eyes: both(P(14, 6, -1.5, -8.8, 0, -8)) },
  glee: { accent: "#FFD27A", eyes: both(P(14, 6, -3.5, -8.2, -2)) },
  wink: { accent: "#FFD27A", eyes: [P(14, 6, -2, -8.2, -1), P(14, 0.5, 0.5, 8.2, 0)] },
  confused: { accent: "#FFB37A", eyes: [P(14, 6.5, 6.5, -8.2), P(14, 2, 2, 8.6, 0, -10)] },
  worried: { accent: "#FFB37A", eyes: both(P(14, 5, 6.5, -8.2, 1, 0, 3)) },
  sad: { accent: "#8FB0FF", eyes: both(P(14, 3, 3, -8.2, 5, 0, 1.5)) },
  error: { accent: "#FF6B6B", eyes: both(P(14, 3, 3, -8.4, 0, 0, -2.5)), motion: "shake" },
  sleeping: { accent: "#8A90A2", eyes: both(P(14, 0.5, 0.5, -8.5, 3)), motion: "breathe" },
  "look-right": { accent: "#DDE3EE", eyes: [P(12.5, 6, 6, 3), P(14.5, 7, 7, 19)] },
  "look-down": { accent: "#DDE3EE", eyes: both(P(14, 6, 6, -8.2, 6)) },
};

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const r2 = (n) => Math.round(n * 100) / 100;

let base = "idle";      // follows the app: idle, thinking, sleeping
let flashes = [];        // short reactions played over the base: [[state, ms], …]
let flashUntil = 0;
let cur = null;

function eyePath(e) {
  const hw = e.w / 2;
  const tl = -e.t + e.s, tr = -e.t - e.s;
  const bl = Math.max(e.b + e.sb, tl + 0.4), br = Math.max(e.b - e.sb, tr + 0.4);
  const pts = [[-hw, tl], [hw, tr], [hw, br], [-hw, bl]];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const p = pts[i], a = pts[(i + 3) % 4], c = pts[(i + 1) % 4];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, lc = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const r = Math.max(0, Math.min(RADIUS, la / 2, lc / 2));
    const p1 = [p[0] + ((a[0] - p[0]) / la) * r, p[1] + ((a[1] - p[1]) / la) * r];
    const p2 = [p[0] + ((c[0] - p[0]) / lc) * r, p[1] + ((c[1] - p[1]) / lc) * r];
    d += `${i ? "L" : "M"}${r2(p1[0])},${r2(p1[1])} Q${r2(p[0])},${r2(p[1])} ${r2(p2[0])},${r2(p2[1])} `;
  }
  return d + "Z";
}

function current() {
  const now = performance.now();
  while (flashes.length && now >= flashUntil) {
    flashes.shift();
    if (flashes.length) flashUntil = now + flashes[0][1];
  }
  return flashes.length ? flashes[0][0] : base;
}

function mount(el) {
  // Cropped to the area the eyes actually travel, so they read larger in the app than on a real notch.
  el.innerHTML = `<svg viewBox="36 4 88 32" aria-hidden="true"><path/><path/></svg>`;
  el.setAttribute("role", "img");
}

function frame(now) {
  const t = now / 1000;
  const name = current();
  let p = PRESETS[name];
  if (name === "idle" && !reduce && t % 3.4 < 0.14) p = PRESETS.blink;
  const tgt = p.eyes.map((e) => ({ ...e }));
  if (!reduce && p.motion) {
    for (const e of tgt) {
      if (p.motion === "scan") e.x += SCAN * Math.sin(t * 1.6);
      if (p.motion === "pulse") { const f = 1 + 0.22 * Math.abs(Math.sin(t * 7)); e.t *= f; e.b *= f; }
      if (p.motion === "breathe") e.y += 1.2 * Math.sin(t * 1.4);
      if (p.motion === "shake" && Math.sin(t * 2) > 0.4) e.x += 1.6 * Math.sin(t * 40);
    }
  }
  if (!cur) cur = tgt.map((e) => ({ ...e }));
  const k = reduce ? 1 : 0.2;
  cur.forEach((e, i) => { for (const key of Object.keys(e)) e[key] += (tgt[i][key] - e[key]) * k; });

  for (const el of document.querySelectorAll(".face")) {
    if (!el.firstElementChild) mount(el);
    el.dataset.face = name;
    el.setAttribute("aria-label", `Prometheus looks ${name.replace("-", " ")}`);
    el.style.setProperty("--eye", p.accent);
    el.querySelectorAll("path").forEach((path, i) => {
      path.setAttribute("d", eyePath(cur[i]));
      path.setAttribute("transform", `translate(${r2(CX + cur[i].x)} ${r2(CY + cur[i].y)}) rotate(${r2(cur[i].rot)})`);
    });
  }
  requestAnimationFrame(frame);
}

// The resting expression, driven by app state.
export function setFaceBase(state) {
  base = PRESETS[state] ? state : "idle";
  if (base === "thinking") flashes = [];
}

// A short reaction (or sequence), after which the face returns to its resting expression.
export function flashFace(...steps) {
  flashes = steps.map((s) => (Array.isArray(s) ? s : [s, 1500]));
  flashUntil = performance.now() + flashes[0][1];
}

requestAnimationFrame(frame);
