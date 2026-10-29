// The card registry. A card's identity is "type:key"; its canvas decides where it lives.
import { h } from "../../ui.js";
import { app } from "../app.js";
import { PREPARE } from "./prepare.js";
import { REBUILD } from "./rebuild.js";
import { SURVIVE } from "./survive.js";
import { VAULT } from "./vault.js";

export const CARDS = { ...PREPARE, ...SURVIVE, ...REBUILD, ...VAULT };

export const CANVASES = {
  prepare: { title: "Prepare", icon: "box" },
  survive: { title: "Survive", icon: "shield" },
  rebuild: { title: "Rebuild", icon: "bolt" },
  vault: { title: "Vault", icon: "book" },
};

// Which canvas a card belongs on. Reference cards (How do we know?, guides, memory) open wherever you are.
export function canvasFor(type) {
  const d = CARDS[type];
  return !d?.canvas || d.float ? app.canvasName : d.canvas;
}

export function renderCard(c) {
  const def = CARDS[c.type];
  if (!def || !app.data.summary) return null;
  try {
    const v = def.render(c);
    if (v) v.width ||= def.width;
    return v;
  } catch (e) {
    console.error(e);
    return { icon: "warn", title: def.title(c.key), body: h("p", { class: "muted" }, "This card couldn't load.") };
  }
}

export function defaultCards(name) {
  const s = app.data.summary;
  if (name === "prepare") {
    if (firstRun()) return [{ type: "household" }, { type: "quick" }];
    const out = [{ type: "stages" }, { type: "next" }, { type: "category", key: "water" }];
    if (s && s.expired.length + s.expiring_soon.length + s.unavailable.length) out.push({ type: "expiring" });
    return out;
  }
  if (name === "survive") {
    const plan = app.data.plans?.[0];
    return [{ type: "scenarios" }, plan ? { type: "plan", key: plan.scenario } : { type: "scenario", key: "blackout" }, { type: "resources" }];
  }
  if (name === "rebuild") return [{ type: "path" }, { type: "lesson", key: app.data.household?.topic || "energy_basics" }];
  if (name === "vault") return [{ type: "search" }, { type: "guide", key: "kb-survival-kit" }];
  return [];
}

// A brand-new household: nothing saved yet.
export function firstRun() {
  return !!app.data.household && !app.data.household.confirmed && !app.data.inventory?.length;
}

export function drawerItems(name) {
  const out = [];
  for (const [type, d] of Object.entries(CARDS)) {
    if (d.canvas !== name || d.hidden) continue;
    const keys = d.keys ? d.keys() : [null];
    for (const key of keys) out.push({ type, key, title: d.title(key), icon: d.icon(key) });
  }
  return out;
}

export function rank(c) {
  const d = CARDS[c.type];
  const keys = d?.keys?.() || [];
  return (d?.rank ?? 50) + Math.max(0, keys.indexOf(c.key)) * 0.01;
}
