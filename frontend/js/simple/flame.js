// The flame's choreography. Its home is the chat avatar; it flies out to the number a change touches,
// hovers while the pencil value appears, stamps it on Save and flies home. Any click or key skips to the end.
import { flashFace, setFaceBase } from "../face.js";
import { h } from "../ui.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const FLIGHT_MS = 700;
const seat = document.getElementById("seat");
const stateEl = document.getElementById("chatState");
let flyer = null;      // the one position: fixed flame
let at = null;         // where it is now (viewport x/y of its top-left), null = home
let anim = null;
let skipping = false;
let running = 0;
let homeText = "";

const SIZE = () => (matchMedia("(max-width: 760px)").matches ? 40 : 46);

function homeRect() {
  const r = seat.getBoundingClientRect();
  if (r.width) return r;
  // Phone with the chat folded: the sheet handle is home.
  return document.getElementById("sheetHandle").getBoundingClientRect();
}

function ensure() {
  if (flyer) return flyer;
  flyer = h("div", { class: "face flyer", "aria-hidden": "true" });
  document.body.appendChild(flyer);
  return flyer;
}

// Any click or key press during a flight jumps to the end state.
for (const ev of ["pointerdown", "keydown"]) {
  addEventListener(ev, () => { if (running) { skipping = true; anim?.finish(); } }, true);
}

const wait = (ms) => (skipping || reduce.matches ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

function startPos() {
  if (at) return at;
  const r = homeRect(), s = SIZE();
  return { x: r.left + r.width / 2 - s / 2, y: r.top + r.height / 2 - (s * 1.14) / 2 };
}

// Where to sit: just on top of the element, centred.
function perch(el) {
  const r = el.getBoundingClientRect(), s = SIZE();
  return { x: r.left + Math.min(r.width, 160) / 2 - s / 2, y: r.top - s * 1.14 * 0.82 };
}

async function flyTo(pos, face = "look-right") {
  ensure();
  const from = startPos(), s = SIZE();
  flyer.style.width = `${s}px`;
  flyer.hidden = false;
  if (!seat.classList.contains("away")) {
    // While it's away, the avatar spot is an empty seat that says where it went.
    homeText = stateEl.textContent;
    stateEl.textContent = `on ${document.querySelector('.tab[aria-selected="true"] .lbl')?.textContent || "the canvas"}…`;
    seat.classList.add("away");
  }
  if (skipping || reduce.matches) {
    flyer.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    at = pos;
    return;
  }
  flashFace([face, FLIGHT_MS + 100]);
  // A gentle arc: a quadratic curve lifted above the straight line.
  const lift = Math.min(160, Math.hypot(pos.x - from.x, pos.y - from.y) * 0.35);
  const c = { x: (from.x + pos.x) / 2, y: Math.min(from.y, pos.y) - lift };
  const frames = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const x = u * u * from.x + 2 * u * t * c.x + t * t * pos.x;
    const y = u * u * from.y + 2 * u * t * c.y + t * t * pos.y;
    const tilt = (pos.x - from.x > 0 ? 1 : -1) * Math.sin(Math.PI * t) * 10;
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${tilt}deg)` });
  }
  anim = flyer.animate(frames, { duration: FLIGHT_MS, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
  try { await anim.finished; } catch { /* cancelled */ }
  flyer.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  anim.cancel();
  anim = null;
  at = pos;
}

async function goHome(face = "happy") {
  if (!at) return;
  const r = homeRect(), s = SIZE();
  await flyTo({ x: r.left + r.width / 2 - s / 2, y: r.top + r.height / 2 - (s * 1.14) / 2 }, "look-right");
  flyer.hidden = true;
  at = null;
  seat.classList.remove("away");
  stateEl.textContent = homeText;
  flashFace([face, 1500]);
}

// Run one choreography at a time; a new one first skips the old one to its end.
let chain = Promise.resolve();
function run(fn) {
  chain = chain.then(async () => {
    running++;
    try { await fn(); } catch (e) { console.error(e); } finally {
      running--;
      if (!running) { skipping = false; if (at) await goHome(); }
    }
  });
  return chain;
}

// Fly to a tab before the canvas switches (so it's clear where we went).
export function toTab(tabEl) {
  return run(async () => { await flyTo(perch(tabEl)); await wait(120); });
}

// Read-only answer: point at up to three numbers, then come home.
export function point(els) {
  return run(async () => {
    for (const el of els.slice(0, 3)) {
      await flyTo(perch(el));
      flashFace(["look-down", 900]);
      el.classList.add("pointed");
      await wait(650);
      el.classList.remove("pointed");
    }
  });
}

// A change is waiting: hover over each number while its pencil value appears, then wait at home with a wink.
export function pencil(els, { stay = false } = {}) {
  return run(async () => {
    for (const el of els.slice(0, 3)) {
      await flyTo(perch(el));
      flashFace(["look-down", 1000]);
      el.closest(".card")?.querySelectorAll(".pencil").forEach((p) => p.classList.add("drawn"));
      await wait(700);
    }
    if (!stay) await goHome("wink");
    setFaceBase("idle");
    flashFace(["wink", 1800]);
  });
}

// Save: settle on the number, wait for the server, then lift off as the value changes.
export function stamp(el, save) {
  let ok = false;
  return run(async () => {
    if (el) {
      await flyTo(perch(el), "look-down");
      flashFace(["glee", 1600]);
      flyer.classList.add("stamp");
      await wait(260);
    }
    ok = await save();
    flyer?.classList.remove("stamp");
    if (!ok) { flashFace(["error", 2000]); await wait(600); await goHome("sad"); return; }
    if (el) flyer.classList.add("sparkle");
    await wait(420);
    flyer?.classList.remove("sparkle");
    await goHome("glee");
  }).then(() => ok);
}

export function busy() {
  return running > 0;
}
