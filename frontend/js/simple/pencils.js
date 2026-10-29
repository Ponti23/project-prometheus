// Pencil previews: a pending change shows on its card as a dashed value next to the real one, with Save / Edit / No.
// The after values come from GET /api/actions/preview (the calculator run on a copy); nothing changes until Save.
import { api } from "../api.js";
import { flashFace } from "../face.js";
import { h, icon, toast } from "../ui.js";
import { announce, app } from "./app.js";
import { cardId } from "./canvas.js";
import { CARDS } from "./cards/index.js";
import { LOOSE, numKey } from "./cards/prepare.js";
import { describe, renderChat } from "./chat.js";
import * as flame from "./flame.js";

const PREVIEWABLE = new Set(["add_inventory", "update_inventory", "update_profile"]);

export const pending = () => (app.data.actions || []).filter((a) => a.status === "pending");

export async function loadPreview() {
  const ids = pending().filter((a) => PREVIEWABLE.has(a.kind)).map((a) => a.id);
  app.data.preview = ids.length ? await api.get(`/actions/preview?ids=${ids.join(",")}`).catch(() => null) : null;
}

function cardFor(target, category) {
  const cat = app.data.summary.categories.find((c) => c.targets.some((t) => t.key === target));
  return cat?.key || LOOSE[(category || "").toLowerCase()] || null;
}

// The card a proposal belongs on, derived from the payload the same way the tools derive their hints.
export function ownerCard(a) {
  const p = a.payload || {};
  if (a.kind === "add_inventory") { const k = cardFor(p.target_key, p.category); return k && cardId("category", k); }
  if (a.kind === "update_inventory") {
    const it = app.data.inventory.find((i) => i.id === p.item_id);
    const k = cardFor(p.changes?.target_key || it?.target_key, p.changes?.category || it?.category);
    return k && cardId("category", k);
  }
  if (a.kind === "update_profile") return "household";
  if (a.kind === "save_approved_tasks") return "next";
  if (a.kind === "create_plan") return cardId("plan", p.scenario);
  return null;
}

export function focusKey(a) {
  const p = a.payload || {};
  if (a.kind === "add_inventory") return numKey(p.target_key);
  if (a.kind === "update_inventory") return numKey(p.changes?.target_key || app.data.inventory.find((i) => i.id === p.item_id)?.target_key);
  if (a.kind === "update_profile") return "adults" in p || "children" in p ? "household.people" : "duration_days" in p ? "household.goal" : null;
  return null;
}

// Render the card again with the preview data, off screen, and read its numbers.
function previewNumbers(c) {
  const pv = app.data.preview;
  const def = CARDS[c.type];
  if (!pv || !def) return {};
  const real = app.data;
  app.data = { ...real, summary: pv.summary, inventory: pv.inventory, household: { ...real.household, profile: pv.profile } };
  let v = null;
  try { v = def.render({ ...c, ui: {} }); } catch { v = null; } finally { app.data = real; }
  if (!v) return {};
  const tmp = h("div", {}, v.body);
  return Object.fromEntries([...tmp.querySelectorAll("[data-num]")].map((n) => [n.dataset.num, n.textContent]));
}

// Called after every paint: add pencil values and, on the proposal's own card, Save / Edit / No.
export function decorate(c) {
  const after = previewNumbers(c);
  for (const n of c.el.querySelectorAll(".card-body [data-num]")) {
    const v = after[n.dataset.num];
    if (v !== undefined && v !== n.textContent) {
      n.classList.add("was");
      // While the flame is on its way, pencils wait to be drawn (it draws them as it hovers).
      n.after(h("span", { class: `pencil${app.holdPencils ? "" : " drawn"}`, "aria-label": `will be ${v}` }, h("span", { class: "arrow", "aria-hidden": "true" }, "→"), v));
    }
  }
  const mine = pending().filter((a) => ownerCard(a) === c.id);
  if (!mine.length) return;
  c.el.classList.add("has-proposal");
  // Save / Edit / No sits just under the number it changes, so the flame never covers it.
  const body = c.el.querySelector(".card-body");
  const n = mine.map(focusKey).map((k) => k && body.querySelector(`[data-num="${k}"]`)).find(Boolean);
  let anchor = n;
  while (anchor && anchor.parentElement !== body) anchor = anchor.parentElement;
  const bars = mine.map((a) => proposalBar(c, a));
  if (anchor) anchor.after(...bars); else body.prepend(...bars);
}

function proposalBar(c, a) {
  const editing = c.ui.editAction === a.id;
  return h("div", { class: "proposal-bar", "data-action": a.id },
    h("div", { class: "what" }, icon("pencil"), h("span", {}, describe(a))),
    editing ? editForm(c, a) : h("div", { class: "row" },
      h("button", { class: "btn primary sm", type: "button", onclick: () => app.approve(a) }, "Save"),
      editable(a) ? h("button", { class: "btn sm", type: "button", onclick: () => { c.ui.editAction = a.id; app.canvas.paint(c); } }, "Edit") : null,
      h("button", { class: "btn sm ghost", type: "button", onclick: () => app.reject(a) }, "No")));
}

const editable = (a) => (a.kind === "add_inventory" || a.kind === "update_inventory") && quantityOf(a) != null
  || (a.kind === "update_profile" && ["adults", "children", "duration_days"].some((k) => k in a.payload));
const quantityOf = (a) => (a.kind === "add_inventory" ? a.payload.quantity : a.payload.changes?.quantity);

function editForm(c, a) {
  const fields = a.kind === "update_profile"
    ? ["adults", "children", "duration_days"].filter((k) => k in a.payload).map((k) => [k, a.payload[k], { adults: "Adults", children: "Children", duration_days: "Goal (days)" }[k]])
    : [["quantity", quantityOf(a), "Amount"]];
  const inputs = fields.map(([k, v, label]) => [k, h("input", { type: "number", min: 0, step: "any", value: v, "aria-label": label })]);
  return h("form", { class: "row", onsubmit: async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(inputs.map(([k, el]) => [k, Number(el.value)]));
    try {
      await api.post(`/actions/${a.id}/edit`, { changes });
      c.ui.editAction = null;
      await app.refresh();
      await renderChat();
    } catch (err) { toast(err.message, true); }
  } },
  fields.map(([k, , label], i) => h("label", { class: "field" }, h("span", {}, label), inputs[i][1])),
  h("button", { class: "btn primary sm", type: "submit" }, "Done"),
  h("button", { class: "btn sm ghost", type: "button", onclick: () => { c.ui.editAction = null; app.canvas.paint(c); } }, "Cancel"));
}

// The number the flame lands on for a proposal (or the card itself).
export function target(a) {
  const id = ownerCard(a);
  const c = id && app.canvas.get(id);
  if (!c) return null;
  const key = focusKey(a);
  return (key && c.el.querySelector(`[data-num="${key}"]`)) || c.el.querySelector(".card-head");
}

app.approve = async (a) => {
  const id = ownerCard(a);
  if (id && app.canvas.get(id)) await app.canvas.reveal(id);
  const ok = await flame.stamp(target(a), async () => {
    try {
      await api.post(`/actions/${a.id}/approve`);
      announce(`Saved: ${describe(a)}`);
      await app.refresh({ ripple: true });
      return true;
    } catch (e) {
      toast(e.message, true);
      await app.refresh();
      return false;
    }
  });
  await renderChat();
  return ok;
};

app.reject = async (a) => {
  const el = document.querySelectorAll(`[data-action="${a.id}"]`);
  el.forEach((x) => x.classList.add("fading"));
  try {
    await api.post(`/actions/${a.id}/reject`);
    flashFace(["sad", 1500]);
    announce("Not saved");
  } catch (e) { toast(e.message, true); }
  await app.refresh();
  await renderChat();
};
