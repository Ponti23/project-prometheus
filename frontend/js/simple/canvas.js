// The canvas: an infinite world of real DOM cards moved with one transform (text stays sharp and readable).
// Cards are identified by "type:key", so spawning one that exists focuses it instead. The app places cards; the model never does.
import { clear, h, icon } from "../ui.js";

const MIN_Z = 0.25, MAX_Z = 2, COMPACT_Z = 0.6, GAP = 24, GRID = 24;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const phone = matchMedia("(max-width: 760px)");
const KEY = "prometheus.canvas.";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export const cardId = (type, key) => (key ? `${type}:${key}` : type);

export function clearSavedLayouts() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(KEY)).forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
}

export class Canvas {
  // render(card) → { icon, title, tag, body, mini, status, width } or null when the card has nothing to show.
  constructor(root, { render, decorate, defaults, rank, onZoom, onRemove }) {
    Object.assign(this, { root, render, decorate, defaults, rank, onZoom, onRemove });
    this.world = root.querySelector(".world");
    this.pointersEl = root.querySelector(".pointers");
    this.cam = { x: 0, y: 0, z: 1 };
    this.cards = new Map();
    this.gesture = null;
    this.touches = new Map();
    this.stack = phone.matches;
    root.classList.toggle("stack", this.stack);
    this.bind();
  }

  // ------------------------------------------------------------ open / save
  open(name) {
    if (this.name) this.save();
    this.stopGlide();
    this.name = name;
    this.cards.clear();
    this.world.replaceChildren();
    this.pointersEl.replaceChildren();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY + name) || "null"); } catch { /* ignore */ }
    if (saved?.cards?.length) {
      this.cam = { x: 0, y: 0, z: 1, ...saved.cam };
      for (const c of saved.cards) this.add(c);
    }
    if (!this.cards.size) {
      this.cam = { x: 0, y: 0, z: 1 };
      for (const d of this.defaults(name)) this.add(d);
      this.tidy({ animate: false, fit: false });
    }
    this.reorder();
    this.apply();
  }

  save() {
    if (!this.name) return;
    const cards = [...this.cards.values()].map(({ type, key, x, y, pinned }) => ({ type, key, x, y, pinned }));
    try { localStorage.setItem(KEY + this.name, JSON.stringify({ cam: this.cam, cards })); } catch { /* ignore */ }
  }

  saveSoon() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.save(), 250);
  }

  // ------------------------------------------------------------ cards
  add({ type, key = null, x = 0, y = 0, pinned = false }) {
    const c = { id: cardId(type, key), type, key, x, y, pinned, ui: {} };
    c.el = h("article", { class: "card", tabindex: 0, "data-id": c.id, role: "group" },
      h("header", { class: "card-head" },
        h("span", { class: "card-icon" }), h("h3", { class: "card-title" }), h("span", { class: "card-tag" }),
        h("button", { class: "card-btn pin", type: "button", "aria-label": "Pin card", "aria-pressed": String(pinned), onclick: () => this.togglePin(c.id) }, icon("pin")),
        h("button", { class: "card-btn close", type: "button", "aria-label": "Remove card", onclick: () => this.remove(c.id) }, icon("x"))),
      h("div", { class: "card-body" }),
      h("div", { class: "card-mini", "aria-hidden": "true" }));
    c.el.addEventListener("focusout", () => setTimeout(() => { if (c.dirty && !c.el.contains(document.activeElement)) this.paint(c); }));
    this.cards.set(c.id, c);
    if (!this.paint(c)) { this.cards.delete(c.id); return null; }
    this.world.appendChild(c.el);
    this.position(c);
    return c;
  }

  paint(c) {
    // Don't wipe a form the user is typing in; repaint once they leave it.
    const a = document.activeElement;
    if (a && c.el.contains(a) && a.matches("input, textarea, select")) { c.dirty = true; return true; }
    c.dirty = false;
    const v = this.render(c);
    if (!v) return false;
    const el = c.el;
    el.style.width = `${v.width || 300}px`;
    el.dataset.status = v.status || "";
    el.toggleAttribute("data-pinned", c.pinned);
    el.setAttribute("aria-label", v.title);
    clear(el.querySelector(".card-icon"), icon(v.icon || "box"));
    el.querySelector(".card-title").textContent = v.title;
    clear(el.querySelector(".card-tag"), v.tag || "");
    clear(el.querySelector(".card-body"), v.body);
    clear(el.querySelector(".card-mini"), v.mini || "");
    el.classList.remove("has-proposal");
    this.decorate?.(c);
    this.settleSoon();
    return true;
  }

  settleSoon() {
    cancelAnimationFrame(this.settleRaf);
    this.settleRaf = requestAnimationFrame(() => this.settle());
  }

  // Cards grow (a pencil value, a form). Push the ones underneath down so nothing overlaps.
  settle() {
    if (this.stack) return;
    const list = [...this.cards.values()].filter((c) => c.x > -9000);
    let moved = false;
    for (let pass = 0; pass < list.length; pass++) {
      let changed = false;
      list.sort((a, b) => a.y - b.y);
      for (let i = 0; i < list.length; i++) {
        const a = list[i], ah = a.el.offsetHeight, aw = a.el.offsetWidth;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const overlapX = Math.min(a.x + aw, b.x + b.el.offsetWidth) - Math.max(a.x, b.x);
          if (overlapX <= 0 || b.y < a.y || b.y >= a.y + ah + GAP / 2) continue;
          // A neighbour that only clips the edge moves right; one underneath moves down.
          if (overlapX < 80 && b.x > a.x) b.x = a.x + aw + GAP;
          else b.y = a.y + ah + GAP;
          changed = moved = true;
        }
      }
      if (!changed) break;
    }
    if (!moved) return;
    if (!reduce.matches) {
      this.world.classList.add("tidying");
      setTimeout(() => this.world.classList.remove("tidying"), 500);
    }
    list.forEach((c) => this.position(c));
    this.saveSoon();
  }

  renderAll() {
    for (const c of [...this.cards.values()]) if (!this.paint(c)) this.drop(c.id);
  }

  position(c) {
    c.el.style.transform = this.stack ? "" : `translate(${Math.round(c.x)}px, ${Math.round(c.y)}px)`;
  }

  get(id) { return this.cards.get(id); }

  // Show a card: focus it if it's already here, otherwise place it in free space near the middle and glide to it.
  async spawn(type, key = null, { focus = true, reveal = true, at = null } = {}) {
    const id = cardId(type, key);
    let c = this.cards.get(id);
    if (c) { this.paint(c); }
    else {
      c = this.add({ type, key, x: -9999, y: -9999 });
      if (!c) return null;
      const p = at || this.freeSpot(c.el.offsetWidth, c.el.offsetHeight, c);
      Object.assign(c, p);
      this.position(c);
      c.el.classList.add("arrive");
      setTimeout(() => c.el.classList.remove("arrive"), 700);
      this.reorder();
      this.saveSoon();
    }
    if (focus || reveal) await this.reveal(id, { focus });
    return c;
  }

  // Glide so all of these cards are in view (used when one chat turn touches several).
  async revealAll(ids) {
    const list = ids.map((i) => this.cards.get(i)).filter(Boolean);
    if (!list.length || list.every((c) => this.visible(c))) return;
    if (this.stack || list.length === 1) return this.reveal(list[0].id);
    const b = this.bounds(list), W = this.root.clientWidth, H = this.root.clientHeight;
    const z = clamp(Math.min((W - 120) / b.w, (H - 120) / b.h, Math.max(this.cam.z, COMPACT_Z), 1), MIN_Z, 1);
    await this.glide({ z, x: W / 2 - (b.x + b.w / 2) * z, y: H / 2 - (b.y + b.h / 2) * z });
  }

  drop(id) {
    const c = this.cards.get(id);
    if (!c) return;
    c.el.remove();
    this.cards.delete(id);
    this.saveSoon();
  }

  remove(id) {
    const c = this.cards.get(id);
    if (!c) return;
    const snap = { type: c.type, key: c.key, x: c.x, y: c.y, pinned: c.pinned };
    const title = c.el.getAttribute("aria-label");
    this.drop(id);
    this.onRemove?.([snap], `Removed ${title}`, () => { this.add(snap); this.reorder(); this.saveSoon(); });
  }

  clearUnpinned() {
    const gone = [...this.cards.values()].filter((c) => !c.pinned);
    if (!gone.length) return;
    const snaps = gone.map(({ type, key, x, y, pinned }) => ({ type, key, x, y, pinned }));
    gone.forEach((c) => this.drop(c.id));
    this.onRemove?.(snaps, `Cleared ${snaps.length} card${snaps.length > 1 ? "s" : ""}`, () => {
      snaps.forEach((s) => this.add(s)); this.reorder(); this.saveSoon();
    });
  }

  togglePin(id) {
    const c = this.cards.get(id);
    c.pinned = !c.pinned;
    c.el.toggleAttribute("data-pinned", c.pinned);
    c.el.querySelector(".pin").setAttribute("aria-pressed", String(c.pinned));
    this.saveSoon();
  }

  // Tab follows reading order: top to bottom, then left to right.
  reorder() {
    const list = [...this.cards.values()].sort((a, b) => Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x);
    if (list.every((c, i) => this.world.children[i] === c.el)) return;
    const active = document.activeElement;
    for (const c of list) this.world.appendChild(c.el);
    if (active && this.world.contains(active)) active.focus({ preventScroll: true });
  }

  rects(except) {
    return [...this.cards.values()].filter((c) => c !== except && c.x > -9000)
      .map((c) => ({ x: c.x, y: c.y, w: c.el.offsetWidth, h: c.el.offsetHeight }));
  }

  // Square spiral out from the middle of the view until the card fits without touching another.
  freeSpot(w, hgt, self) {
    const others = this.rects(self);
    if (this.stack) {
      const top = Math.min(0, ...others.map((r) => r.y));
      return { x: 0, y: top - hgt - GAP };
    }
    const mid = this.toWorld(this.root.clientWidth / 2, this.root.clientHeight / 2);
    const x0 = mid.x - w / 2, y0 = mid.y - hgt / 2, step = 40;
    const free = (x, y) => others.every((r) => x + w + GAP <= r.x || r.x + r.w + GAP <= x || y + hgt + GAP <= r.y || r.y + r.h + GAP <= y);
    for (let ring = 0; ring < 80; ring++) {
      const cells = [];
      for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) cells.push([i * step, j * step]);
      }
      cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      for (const [dx, dy] of cells) if (free(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    }
    return { x: x0, y: y0 };
  }

  // Masonry columns in a fixed order, starting at the top left of the view.
  tidy({ animate = true, fit = true } = {}) {
    const list = [...this.cards.values()].sort((a, b) => this.rank(a) - this.rank(b));
    if (!list.length) return;
    const colW = Math.max(...list.map((c) => c.el.offsetWidth));
    const viewW = (this.root.clientWidth - 120) / this.cam.z;
    const cols = clamp(Math.floor((viewW + GAP) / (colW + GAP)), 1, 4);
    const origin = this.toWorld(60, 72);
    const heights = Array(cols).fill(origin.y);
    for (const c of list) {
      const col = heights.indexOf(Math.min(...heights));
      c.x = origin.x + col * (colW + GAP);
      c.y = heights[col];
      heights[col] += c.el.offsetHeight + GAP;
    }
    if (animate && !reduce.matches) {
      this.world.classList.add("tidying");
      setTimeout(() => this.world.classList.remove("tidying"), 500);
    }
    list.forEach((c) => this.position(c));
    this.reorder();
    this.saveSoon();
    if (fit) this.fit();
  }

  // ------------------------------------------------------------ camera
  apply() {
    const { x, y, z } = this.cam;
    if (this.stack) {
      this.world.style.transform = "";
      this.root.style.backgroundSize = this.root.style.backgroundPosition = "";
    } else {
      this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      let g = GRID * z;
      while (g < 14) g *= 2; // keep the dots from turning into noise far out
      this.root.style.backgroundSize = `${g}px ${g}px`;
      this.root.style.backgroundPosition = `${x}px ${y}px`;
    }
    const compact = !this.stack && z < COMPACT_Z;
    if (compact !== this.root.classList.contains("compact")) {
      // Compact cards keep their full-size footprint, so the zoomed-out map matches the layout.
      for (const c of this.cards.values()) c.el.style.height = compact ? `${c.el.offsetHeight}px` : "";
      this.root.classList.toggle("compact", compact);
    }
    this.onZoom?.(z);
    this.updatePointers();
    this.saveSoon();
  }

  toWorld(sx, sy) {
    return { x: (sx - this.cam.x) / this.cam.z, y: (sy - this.cam.y) / this.cam.z };
  }

  zoomAt(f, sx = this.root.clientWidth / 2, sy = this.root.clientHeight / 2) {
    const z = clamp(this.cam.z * f, MIN_Z, MAX_Z), k = z / this.cam.z;
    this.cam = { x: sx - (sx - this.cam.x) * k, y: sy - (sy - this.cam.y) * k, z };
    this.apply();
  }

  zoomTo(z) {
    this.zoomAt(z / this.cam.z);
  }

  glide(to, ms = 450) {
    this.stopGlide();
    if (reduce.matches || this.stack) { Object.assign(this.cam, to); this.apply(); return Promise.resolve(); }
    const from = { ...this.cam }, t0 = performance.now();
    return new Promise((done) => {
      this.glideDone = done;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), e = ease(k);
        for (const p of ["x", "y", "z"]) this.cam[p] = from[p] + ((to[p] ?? from[p]) - from[p]) * e;
        this.apply();
        if (k < 1) this.raf = requestAnimationFrame(step);
        else { this.raf = null; this.glideDone = null; done(); }
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  stopGlide() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    const d = this.glideDone;
    this.glideDone = null;
    d?.();
  }

  bounds(list = [...this.cards.values()]) {
    if (!list.length) return null;
    const r = list.map((c) => ({ x: c.x, y: c.y, w: c.el.offsetWidth, h: c.el.offsetHeight }));
    const x = Math.min(...r.map((a) => a.x)), y = Math.min(...r.map((a) => a.y));
    return { x, y, w: Math.max(...r.map((a) => a.x + a.w)) - x, h: Math.max(...r.map((a) => a.y + a.h)) - y };
  }

  fit() {
    const b = this.bounds();
    if (!b || this.stack) return Promise.resolve();
    const W = this.root.clientWidth, H = this.root.clientHeight, pad = 64;
    const z = clamp(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), MIN_Z, 1);
    return this.glide({ z, x: W / 2 - (b.x + b.w / 2) * z, y: H / 2 - (b.y + b.h / 2) * z });
  }

  // Screen rect of a card relative to the canvas.
  screenRect(c) {
    const { x, y, z } = this.cam;
    return { x: c.x * z + x, y: c.y * z + y, w: c.el.offsetWidth * z, h: c.el.offsetHeight * z };
  }

  visible(c, margin = 16) {
    if (this.stack) {
      const r = c.el.getBoundingClientRect(), v = this.root.getBoundingClientRect();
      return r.top >= v.top && r.bottom <= v.bottom - 120;
    }
    const r = this.screenRect(c);
    return r.x >= margin && r.y >= margin && r.x + r.w <= this.root.clientWidth - margin && r.y + r.h <= this.root.clientHeight - margin;
  }

  // Glide so the card is in view (centred, zooming out only if it can't fit).
  async reveal(id, { focus = false } = {}) {
    const c = this.cards.get(id);
    if (!c) return;
    if (this.stack) {
      c.el.scrollIntoView({ block: "center", behavior: reduce.matches ? "auto" : "smooth" });
    } else if (!this.visible(c)) {
      const W = this.root.clientWidth, H = this.root.clientHeight;
      const w = c.el.offsetWidth, hh = c.el.offsetHeight;
      // Zoom in far enough for full detail, but never so far that the card doesn't fit.
      const z = clamp(Math.min(Math.max(this.cam.z, COMPACT_Z), (W - 80) / w, (H - 80) / hh), MIN_Z, MAX_Z);
      await this.glide({ z, x: W / 2 - (c.x + w / 2) * z, y: H / 2 - (c.y + hh / 2) * z });
    }
    if (focus) c.el.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ changes off screen
  glow(id) {
    const c = this.cards.get(id);
    if (!c) return;
    c.el.classList.remove("glow");
    void c.el.offsetWidth;
    c.el.classList.add("glow");
    setTimeout(() => c.el.classList.remove("glow"), 1600);
    if (!this.visible(c)) {
      c.pointer = { label: `${c.el.getAttribute("aria-label")} changed`, until: Date.now() + 9000 };
      this.updatePointers();
      setTimeout(() => this.updatePointers(), 9100);
    }
  }

  updatePointers() {
    if (!this.pointersEl) return;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const chips = [];
    for (const c of this.cards.values()) {
      if (!c.pointer || c.pointer.until < Date.now() || this.visible(c, 0)) { c.pointer = null; continue; }
      if (this.stack) { chips.push(h("button", { class: "pointer bottom", onclick: () => this.reveal(c.id, { focus: true }) }, c.pointer.label, icon("arrow"))); continue; }
      const r = this.screenRect(c);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const ang = Math.atan2(cy - H / 2, cx - W / 2);
      const px = clamp(cx, 90, W - 90), py = clamp(cy, 28, H - 70);
      chips.push(h("button", {
        class: "pointer", style: { left: `${px}px`, top: `${py}px`, "--rot": `${ang}rad` },
        onclick: () => { c.pointer = null; this.reveal(c.id, { focus: true }); },
      }, c.pointer.label, icon("arrow")));
    }
    this.pointersEl.replaceChildren(...chips);
  }

  // ------------------------------------------------------------ input
  bind() {
    const r = this.root;
    r.addEventListener("pointerdown", (e) => this.down(e));
    r.addEventListener("pointermove", (e) => this.move(e));
    r.addEventListener("pointerup", (e) => this.up(e));
    r.addEventListener("pointercancel", (e) => this.up(e));
    r.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    r.addEventListener("keydown", (e) => this.cardKey(e));
    r.addEventListener("scroll", () => {
      // Off-screen focus would scroll the clipped canvas; move the camera instead.
      if (!this.stack && (r.scrollLeft || r.scrollTop)) { r.scrollLeft = r.scrollTop = 0; }
      this.updatePointers();
    }, { passive: true });
    r.addEventListener("focusin", (e) => {
      const el = e.target.closest(".card");
      const c = el && this.cards.get(el.dataset.id);
      if (c && !this.stack && !this.visible(c, 0) && !this.gesture) this.reveal(c.id);
    });
    addEventListener("keydown", (e) => {
      if (e.code === "Space" && !typing(e.target)) { this.space = true; r.classList.add("space"); if (e.target === document.body || e.target === r) e.preventDefault(); }
    });
    addEventListener("keyup", (e) => { if (e.code === "Space") { this.space = false; r.classList.remove("space"); } });
    addEventListener("resize", () => this.updatePointers());
    phone.addEventListener("change", () => {
      this.stack = phone.matches;
      r.classList.toggle("stack", this.stack);
      this.cards.forEach((c) => this.position(c));
      this.apply();
    });
  }

  down(e) {
    if (this.stack || e.target.closest(".canvas-ui")) return;
    const head = e.target.closest(".card-head");
    const inCard = e.target.closest(".card");
    const control = e.target.closest("button, a, input, textarea, select, label, [contenteditable]");
    this.stopGlide();
    if (e.pointerType === "touch") this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) { this.startPinch(); return; }
    if (control && !this.space) return;
    let kind = null;
    if (this.space || e.button === 1 || !inCard) kind = "pan";
    else if (head) kind = "card";
    else if (e.pointerType === "touch") kind = "pan";
    if (!kind || (e.button !== 0 && e.button !== 1)) return;
    const c = kind === "card" ? this.cards.get(inCard.dataset.id) : null;
    this.gesture = { kind, c, id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, live: false };
    if (kind === "pan" && !inCard) e.preventDefault();
  }

  move(e) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) { this.movePinch(); return; }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    if (!g.live) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
      g.live = true;
      this.root.setPointerCapture(e.pointerId);
      this.root.classList.add(g.kind === "card" ? "dragging" : "panning");
      if (g.c) g.c.el.classList.add("lifted");
    }
    const dx = e.clientX - g.lx, dy = e.clientY - g.ly;
    g.lx = e.clientX; g.ly = e.clientY;
    if (g.kind === "pan") {
      this.cam.x += dx; this.cam.y += dy;
      this.apply();
    } else {
      g.c.x += dx / this.cam.z; g.c.y += dy / this.cam.z;
      this.position(g.c);
    }
  }

  up(e) {
    this.touches.delete(e.pointerId);
    if (this.pinch && this.touches.size < 2) { this.pinch = null; return; }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    this.root.classList.remove("dragging", "panning");
    if (g.live && g.c) { g.c.el.classList.remove("lifted"); this.reorder(); this.saveSoon(); }
  }

  startPinch() {
    this.gesture = null;
    const [a, b] = [...this.touches.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  movePinch() {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rect = this.root.getBoundingClientRect();
    this.cam.x += mx - this.pinch.mx; this.cam.y += my - this.pinch.my;
    this.zoomAt(d / this.pinch.d, mx - rect.left, my - rect.top);
    Object.assign(this.pinch, { d, mx, my });
  }

  wheel(e) {
    if (this.stack || e.target.closest(".drawer")) return;
    e.preventDefault();
    this.stopGlide();
    const unit = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      const rect = this.root.getBoundingClientRect();
      this.zoomAt(Math.exp(-clamp(e.deltaY * unit, -50, 50) * 0.008), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
      this.cam.x -= dx * unit; this.cam.y -= dy * unit;
      this.apply();
    }
  }

  // Arrow keys move the focused card; Shift makes bigger steps.
  cardKey(e) {
    const el = e.target;
    if (this.stack || !el.classList?.contains("card")) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const c = this.cards.get(el.dataset.id), step = e.shiftKey ? 80 : 16;
    c.x += d[0] * step; c.y += d[1] * step;
    this.position(c);
    if (!this.visible(c, 0)) this.reveal(c.id);
    clearTimeout(this.keyT);
    this.keyT = setTimeout(() => { this.reorder(); this.saveSoon(); }, 400);
  }
}

export function typing(el) {
  return !!el?.closest?.("input, textarea, select, [contenteditable]");
}
