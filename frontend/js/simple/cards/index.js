// The card registry. A card's identity is "type:key"; its canvas decides where it lives.
import { h } from "../../ui.js";
import { app } from "../app.js";
import { PREPARE } from "./prepare.js";

export const CARDS = { ...PREPARE };

export const CANVASES = {
  prepare: { title: "Prepare", icon: "box" },
  survive: { title: "Survive", icon: "shield" },
  rebuild: { title: "Rebuild", icon: "bolt" },
  vault: { title: "Vault", icon: "book" },
};

// Which canvas a card belongs on. Cards like "How do we know?" open wherever you are.
export function canvasFor(type) {
  return CARDS[type]?.canvas || app.canvasName;
}

export function renderCard(c) {
  const def = CARDS[c.type];
  if (!def || !app.data.summary) return null;
  try {
    return def.render(c);
  } catch (e) {
    console.error(e);
    return { icon: "warn", title: def.title(c.key), body: h("p", { class: "muted" }, "This card couldn't load.") };
  }
}

export function defaultCards(name) {
  const s = app.data.summary;
  if (name === "prepare") {
    const out = [{ type: "stages" }, { type: "next" }, { type: "category", key: "water" }];
    if (s && s.expired.length + s.expiring_soon.length + s.unavailable.length) out.push({ type: "expiring" });
    return out;
  }
  return Object.entries(CARDS).filter(([, d]) => d.canvas === name && d.default).map(([type, d]) => ({ type, key: d.default === true ? null : d.default }));
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
