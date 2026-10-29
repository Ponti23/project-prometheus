// Permission modes, like Claude Code: Ask first (default), Auto and Plan. Remembered per household.
import { clear, h, icon } from "../ui.js";
import { announce, app } from "./app.js";

export const MODES = [
  { id: "ask", label: "Ask first", icon: "pencil", hint: "Shows each change and waits for Save" },
  { id: "auto", label: "Auto", icon: "bolt", hint: "Saves small changes itself. You can undo." },
  { id: "plan", label: "Plan", icon: "map", hint: "Only drafts. Nothing changes until you save." },
];

const slot = document.getElementById("modeSlot");
const input = document.getElementById("chatInput");
const key = () => `prometheus.permission.${app.status?.household_id || "default"}`;

export function getMode() {
  try { return localStorage.getItem(key()) || "ask"; } catch { return "ask"; }
}

export function setMode(id) {
  try { localStorage.setItem(key(), id); } catch { /* storage unavailable */ }
  apply();
  announce(`${MODES.find((m) => m.id === id).label} mode`);
}

function apply() {
  const mode = MODES.find((m) => m.id === getMode()) || MODES[0];
  document.body.dataset.permission = mode.id;
  clear(slot, h("button", {
    class: "mode-chip", type: "button", "data-mode": mode.id, "aria-haspopup": "menu", "aria-expanded": "false",
    title: `${mode.hint} (Shift+Tab to switch)`, onclick: (e) => { e.stopPropagation(); toggleMenu(); },
  }, icon(mode.icon), h("span", {}, mode.label), h("span", { class: "caret", "aria-hidden": "true" }, "▾")));
}

function toggleMenu(open = !document.getElementById("modeMenu")) {
  document.getElementById("modeMenu")?.remove();
  slot.querySelector(".mode-chip").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const cur = getMode();
  const menu = h("div", { class: "mode-menu", id: "modeMenu", role: "menu" }, MODES.map((m) => h("button", {
    type: "button", role: "menuitemradio", "aria-checked": String(m.id === cur),
    onclick: () => { toggleMenu(false); setMode(m.id); input.focus(); },
  }, icon(m.icon), h("span", { class: "t" }, h("strong", {}, m.label), h("span", {}, m.hint)))));
  slot.appendChild(menu);
  menu.querySelector('[aria-checked="true"]').focus();
  setTimeout(() => document.addEventListener("click", () => toggleMenu(false), { once: true }));
}

export function initModes() {
  apply();
  // Shift+Tab in the message box cycles the mode (Tab still moves on, so focus never gets stuck).
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      const i = MODES.findIndex((m) => m.id === getMode());
      setMode(MODES[(i + 1) % MODES.length].id);
    }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });
}
