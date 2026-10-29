// Shared state for Simple mode. main.js fills in the functions; cards and chat read app.data.
import { api } from "../api.js";
import { h } from "../ui.js";

export const app = {
  status: null,
  data: {},           // latest API snapshots: summary, household, inventory, readiness, tasks, actions, plans
  cache: {},          // data that rarely changes, fetched once: /sources, /scenarios, /techtree, …
  canvasName: "prepare",
  canvas: null,
  refresh: async () => {},
  show: async () => {},
  spawn: async () => {},
};

const live = document.getElementById("live");

export function announce(msg) {
  live.textContent = "";
  setTimeout(() => (live.textContent = msg), 30);
}

// Fetch something once and repaint the cards when it arrives. Returns undefined until then.
export function load(path) {
  const hit = app.cache[path];
  if (hit && !(hit instanceof Promise)) return hit;
  if (!hit) {
    app.cache[path] = api.get(path)
      .then((v) => { app.cache[path] = v; app.canvas?.renderAll(); })
      .catch(() => { delete app.cache[path]; });
  }
  return undefined;
}

// A toast with an optional button (Undo, Show me…).
export function notify(msg, { action, onAction, ms = 5000, err = false } = {}) {
  document.querySelectorAll(".toast.act").forEach((t) => t.remove());
  const t = h("div", { class: `toast act${err ? " err" : ""}`, role: "status" }, h("span", {}, msg),
    action ? h("button", { type: "button", onclick: () => { t.remove(); onAction(); } }, action) : null);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

export function stageLabel(days) {
  return { 3: "3 days", 7: "1 week", 14: "2 weeks" }[days] || `${days} days`;
}

export function qty(n, unit = "") {
  const v = Number(n);
  const s = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10);
  return unit && unit !== "each" ? `${s} ${unit}` : s;
}
