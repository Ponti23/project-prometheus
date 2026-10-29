// Simple mode: a top bar, a canvas of cards and the chat. Advanced mode (advanced.html) is unchanged.
import { api } from "../api.js";
import { clear, h, hydrateIcons, icon, toast } from "../ui.js";
import { announce, app, notify } from "./app.js";
import { Canvas, cardId, clearSavedLayouts, typing } from "./canvas.js";
import { CANVASES, canvasFor, CARDS, defaultCards, drawerItems, rank, renderCard } from "./cards/index.js";
import { describe, initChat, renderChat, sendChat, setSuggestions } from "./chat.js";
import * as flame from "./flame.js";
import { initModes } from "./modes.js";
import { decorate, loadPreview, ownerCard, pending, target } from "./pencils.js";

const $ = (id) => document.getElementById(id);
const NAMES = Object.keys(CANVASES);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ---------------------------------------------------------------- data
app.refresh = async ({ ripple = false } = {}) => {
  const before = ripple ? snapshotNumbers() : null;
  const [summary, household, inventory, readiness, tasks, actions, plans] = await Promise.all([
    api.get("/summary"), api.get("/household"), api.get("/inventory"), api.get("/readiness"),
    api.get("/tasks"), api.get("/actions"), api.get("/plans"),
  ]);
  Object.assign(app.data, { summary, household, inventory, readiness, tasks, actions, plans });
  await loadPreview();
  app.canvas?.renderAll();
  if (before) rippleChanges(before);
};

// Every number on a card carries data-num; after a change, cards whose numbers moved glow.
function snapshotNumbers() {
  const out = {};
  for (const c of app.canvas?.cards.values() || []) {
    out[c.id] = [...c.el.querySelectorAll(".card-body [data-num], .card-body .t")].map((n) => n.textContent).join("|");
  }
  return out;
}

function rippleChanges(before) {
  for (const c of app.canvas.cards.values()) {
    const now = [...c.el.querySelectorAll(".card-body [data-num], .card-body .t")].map((n) => n.textContent).join("|");
    if (before[c.id] !== undefined && before[c.id] !== now) {
      app.canvas.glow(c.id);
      announce(`Prometheus updated ${c.el.getAttribute("aria-label")}`);
    }
  }
}

// ---------------------------------------------------------------- canvases
app.show = async (name, { push = true } = {}) => {
  if (!CANVASES[name]) name = "prepare";
  app.canvasName = name;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.canvas === name)));
  $("canvas").setAttribute("aria-label", `${CANVASES[name].title} canvas`);
  document.body.dataset.canvas = name;
  store.set("prometheus.simple.canvas", name);
  if (push && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  api.post("/context", { mode: name }).catch(() => {});
  app.canvas.open(name);
  setSuggestions(name);
  renderDrawer();
};

// Show a card, switching canvas first if it lives elsewhere.
app.spawn = async (type, key = null, opts = {}) => {
  if (!CARDS[type]) return null;
  const target = canvasFor(type);
  if (target !== app.canvasName) await app.show(target);
  return app.canvas.spawn(type, key, opts);
};

app.chatContext = () => ({
  ui: "simple",
  canvas: app.canvasName,
  cards: [...app.canvas.cards.keys()],
  focused_card: app.focusedCard && app.canvas.get(app.focusedCard) ? app.focusedCard : null,
});

// The chat drives the canvas: tools say which cards a turn was about; the app places them and the flame shows the way.
app.recentAuto = new Map();
app.applyHints = async (hints, out = {}) => {
  for (const id of out.auto_saved || []) app.recentAuto.set(id, Date.now() + 9000);
  if (out.auto_saved?.length) setTimeout(() => app.canvas.renderAll(), 9100);
  try { await choreograph(hints, out); } finally {
    app.holdPencils = false;
    document.querySelectorAll(".pencil").forEach((p) => p.classList.add("drawn"));
  }
};

async function choreograph(hints, out) {
  const withCard = hints.filter((x) => x.card && CARDS[x.card.type]);
  let chosen = withCard.filter((x) => (x.priority ?? 1) >= 1);
  // Background reads (priority 0) only show a card when nothing else did, and only on this canvas.
  if (!chosen.length) chosen = withCard.filter((x) => canvasFor(x.card.type) === app.canvasName).slice(-1);
  const byId = new Map();
  for (const x of [...chosen].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1))) {
    const id = cardId(x.card.type, x.card.key ?? null);
    if (!byId.has(id)) byId.set(id, x);
  }
  const picks = [...byId.entries()].slice(0, 3);
  if (!picks.length) {
    const open = hints.find((x) => x.open && CANVASES[x.open]);
    if (open && open.open !== app.canvasName) await app.show(open.open);
    return;
  }
  const where = canvasFor(picks[0][1].card.type);
  if (where !== app.canvasName) {
    await flame.toTab(document.querySelector(`.tab[data-canvas="${where}"]`));
    await app.show(where);
  }
  const here = picks.filter(([, x]) => canvasFor(x.card.type) === app.canvasName);
  for (const [, x] of here) {
    const c = await app.canvas.spawn(x.card.type, x.card.key ?? null, { focus: false, reveal: false });
    if (c && x.filter !== undefined) { c.ui.filter = x.filter; app.canvas.paint(c); }
  }
  await app.canvas.revealAll(here.map(([id]) => id));
  // Auto mode: small changes already saved themselves; the flame stamps each one straight away.
  const saved = (out.auto_saved || []).map((id) => app.data.actions.find((a) => a.id === id)).filter(Boolean);
  for (const a of saved.slice(0, 3)) await flame.stamp(target(a), async () => true);
  const waiting = pending().filter((a) => here.some(([id]) => ownerCard(a) === id));
  if (waiting.length && document.body.dataset.permission === "plan") {
    // Plan mode: pencil in every change, then come back with "N changes ready".
    await flame.pencil(waiting.map(target).filter(Boolean).slice(0, 6));
  } else if (waiting.length) {
    // Visit the changed number on each proposal's card, then other numbers that would move (at most three).
    const els = waiting.map(target).filter(Boolean);
    const more = [...document.querySelectorAll(".card .num.was")].filter((n) => !els.some((e) => e === n || e.contains(n)) && !app.canvas.stack);
    await flame.pencil([...els, ...more]);
  } else if (!saved.length) {
    const els = here.map(([id, x]) => {
      const c = app.canvas.get(id);
      return c && ((x.focus && c.el.querySelector(`[data-num="${x.focus}"]`)) || c.el.querySelector(".card-head"));
    }).filter(Boolean);
    await flame.point(els);
  }
}

// ---------------------------------------------------------------- drawer, menu, controls
function renderDrawer() {
  const drawer = $("drawer");
  const items = drawerItems(app.canvasName);
  clear(drawer,
    h("h2", {}, "Add a card"),
    h("ul", {}, items.map((it) => h("li", {},
      h("button", {
        type: "button", class: app.canvas.get(cardId(it.type, it.key)) ? "on" : "",
        "data-type": it.type, "data-key": it.key ?? "",
        onclick: () => { app.canvas.spawn(it.type, it.key); renderDrawer(); },
        onpointerdown: (e) => dragFromDrawer(e, it),
      }, icon(it.icon), h("span", {}, it.title))))));
}

function toggleDrawer(open = !$("drawer").classList.contains("open")) {
  $("drawer").classList.toggle("open", open);
  $("addCard").setAttribute("aria-expanded", String(open));
  if (open) { renderDrawer(); $("drawer").querySelector("button")?.focus(); }
}

// Drag a card out of the drawer and drop it where you want it.
function dragFromDrawer(e, it) {
  if (app.canvas.stack || e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    if (!ghost) { ghost = h("div", { class: "drag-ghost" }, icon(it.icon), it.title); document.body.appendChild(ghost); }
    ghost.style.transform = `translate(${ev.clientX + 8}px, ${ev.clientY + 8}px)`;
  };
  const up = (ev) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    if (!ghost) return;
    ghost.remove();
    const r = $("canvas").getBoundingClientRect();
    if (ev.target.closest(".drawer") || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    const p = app.canvas.toWorld(ev.clientX - r.left, ev.clientY - r.top);
    // Suppress the click that follows the drag.
    addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
    app.canvas.spawn(it.type, it.key, { at: { x: p.x - 40, y: p.y - 20 }, focus: false }).then(renderDrawer);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

function renderMenu() {
  const item = (label, ic, fn) => h("button", { role: "menuitem", type: "button", onclick: () => { closeMenu(); fn(); } }, icon(ic), label);
  clear($("menu"),
    item("Try the demo family", "people", loadDemo),
    item("What changed", "undo", showChanges),
    item("Show me how it works", "atom", showHowItWorks),
    item("Advanced mode", "gear", () => { store.set("prometheus.ui", "advanced"); location.href = "advanced.html"; }),
    h("hr"),
    item("Clear conversation", "eraser", async () => { await api.del("/chat/history"); await renderChat(); }),
    item("Start over", "trash", resetHousehold));
}

// Every change Auto mode saved by itself, newest first, each with Undo.
function showChanges() {
  const list = app.data.actions.filter((a) => a.resolved_by === "auto").reverse();
  const close = () => panel.remove();
  document.getElementById("changesPanel")?.remove();
  const panel = h("div", { class: "panel-pop", id: "changesPanel", role: "dialog", "aria-label": "What changed" },
    h("div", { class: "row" }, h("h2", {}, "What changed"), h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, icon("x"))),
    list.length ? h("ul", {}, list.map((a) => h("li", {},
      h("span", {}, describe(a)),
      a.status === "approved"
        ? h("button", { class: "link", type: "button", onclick: async () => { await app.undo(a); showChanges(); } }, icon("undo"), "Undo")
        : h("span", { class: "muted" }, "Undone"))))
      : h("p", { class: "muted" }, "Nothing saved automatically yet. Switch the chat to Auto to let Prometheus save small changes."));
  document.body.appendChild(panel);
  panel.querySelector("button").focus();
}

function closeMenu() {
  $("menu").hidden = true;
  $("menuBtn").setAttribute("aria-expanded", "false");
}

async function loadDemo() {
  await api.post("/household/demo");
  clearSavedLayouts();
  await app.refresh();
  await app.show("prepare");
  await renderChat();
  notify("The demo family is loaded.", { action: "Show me how it works", onAction: showHowItWorks, ms: 8000 });
}

// Judges can see every tool call: Advanced mode with Under the hood on.
function showHowItWorks() {
  store.set("prometheus.hood", "1");
  location.href = "advanced.html";
}

async function resetHousehold() {
  if (!confirm("Delete your household, supplies, plans, memory and conversation?")) return;
  await api.post("/household/reset");
  clearSavedLayouts();
  await app.refresh();
  await app.show(app.canvasName);
  await renderChat();
  announce("Started over");
}

function updateZoom(z) {
  $("zoomPct").textContent = `${Math.round(z * 100)}%`;
}

function onRemove(snaps, msg, undo) {
  renderDrawer();
  notify(msg, { action: "Undo", onAction: () => { undo(); renderDrawer(); } });
  announce(msg);
}

function bindUi() {
  hydrateIcons();
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => app.show(t.dataset.canvas)));
  $("addCard").addEventListener("click", () => toggleDrawer());
  $("zoomIn").addEventListener("click", () => app.canvas.zoomAt(1.2));
  $("zoomOut").addEventListener("click", () => app.canvas.zoomAt(1 / 1.2));
  $("zoomPct").addEventListener("click", () => app.canvas.zoomTo(1));
  $("fitBtn").addEventListener("click", () => app.canvas.fit());
  $("tidyBtn").addEventListener("click", () => app.canvas.tidy());
  $("clearBtn").addEventListener("click", () => app.canvas.clearUnpinned());
  $("menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("menu").hidden;
    renderMenu();
    $("menu").hidden = !open;
    $("menuBtn").setAttribute("aria-expanded", String(open));
    if (open) $("menu").querySelector("button").focus();
  });
  document.addEventListener("click", (e) => {
    if (!$("menu").hidden && !e.target.closest("#menu")) closeMenu();
    if ($("drawer").classList.contains("open") && !e.target.closest("#drawer, #addCard")) toggleDrawer(false);
  });
  // Remember which card you tapped, so "this" in the chat means that card.
  $("canvas").addEventListener("focusin", (e) => { const c = e.target.closest(".card"); if (c) app.focusedCard = c.dataset.id; });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); toggleDrawer(false); document.getElementById("changesPanel")?.remove(); }
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); app.canvas.fit(); }
    else if (e.key === "+" || e.key === "=") app.canvas.zoomAt(1.2);
    else if (e.key === "-" || e.key === "_") app.canvas.zoomAt(1 / 1.2);
  });
  // Phone: swipe sideways to switch canvases.
  let t0 = null;
  $("canvas").addEventListener("touchstart", (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  $("canvas").addEventListener("touchend", (e) => {
    if (!t0 || !app.canvas.stack) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    t0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
      const i = NAMES.indexOf(app.canvasName) + (dx < 0 ? 1 : -1);
      if (NAMES[i]) app.show(NAMES[i]);
    }
  });
  const online = () => ($("offlineNote").hidden = navigator.onLine);
  addEventListener("online", online);
  addEventListener("offline", online);
  online();
  addEventListener("hashchange", () => { const n = location.hash.slice(1); if (CANVASES[n] && n !== app.canvasName) app.show(n, { push: false }); });
}

async function boot() {
  bindUi();
  app.canvas = new Canvas($("canvas"), { render: renderCard, decorate, defaults: defaultCards, rank, onZoom: updateZoom, onRemove });
  try {
    app.status = await api.get("/status"); // creates the household cookie before the parallel calls
    await app.refresh();
    initChat();
    initModes();
    const fromHash = location.hash.slice(1);
    await app.show(CANVASES[fromHash] ? fromHash : store.get("prometheus.simple.canvas") || "prepare");
    await renderChat();
  } catch (e) {
    toast(e.message, true);
    clear($("world"), h("div", { class: "card boot-error" }, h("p", {}, `Prometheus could not start: ${e.message}`)));
  }
}

boot();
export { sendChat };
