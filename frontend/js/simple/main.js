// Simple mode: a top bar, a canvas of cards and the chat. Advanced mode (advanced.html) is unchanged.
import { api } from "../api.js";
import { clear, h, hydrateIcons, icon, toast } from "../ui.js";
import { announce, app, notify } from "./app.js";
import { Canvas, cardId, clearSavedLayouts, typing } from "./canvas.js";
import { CANVASES, canvasFor, CARDS, defaultCards, drawerItems, rank, renderCard } from "./cards/index.js";
import { initChat, renderChat, sendChat, setSuggestions } from "./chat.js";

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
  canvas: app.canvasName,
  cards: [...app.canvas.cards.keys()],
  focused_card: app.focusedCard && app.canvas.get(app.focusedCard) ? app.focusedCard : null,
});

app.applyHints = async (hints) => {
  for (const hint of hints) {
    if (hint.card) await app.spawn(hint.card.type, hint.card.key ?? null);
    else if (hint.open && CANVASES[hint.open] && hint.open !== app.canvasName) await app.show(hint.open);
  }
};

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
    item("Show me how it works", "atom", showHowItWorks),
    item("Advanced mode", "gear", () => { store.set("prometheus.ui", "advanced"); location.href = "advanced.html"; }),
    h("hr"),
    item("Clear conversation", "eraser", async () => { await api.del("/chat/history"); await renderChat(); }),
    item("Start over", "trash", resetHousehold));
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
    if (e.key === "Escape") { closeMenu(); toggleDrawer(false); }
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
  app.canvas = new Canvas($("canvas"), { render: renderCard, defaults: defaultCards, rank, onZoom: updateZoom, onRemove });
  try {
    app.status = await api.get("/status"); // creates the household cookie before the parallel calls
    await app.refresh();
    initChat();
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
