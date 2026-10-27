import { api } from "../api.js";
import { bar, clear, fmt, h, hydrateIcons, icon, pct, ring, statusTag, toast } from "../ui.js";

const CATEGORIES = ["water", "food", "medical", "lighting", "power", "communication", "hygiene", "tools", "documents", "other"];

export async function renderPrepare(root, ctx) {
  const { state } = ctx;
  const r = state.readiness;
  const [inventory] = await Promise.all([api.get("/inventory")]);
  clear(root,
    profilePanel(ctx),
    readinessPanel(r),
    alertsPanel(r),
    tasksPanel(ctx),
    inventoryPanel(ctx, inventory, r));
  hydrateIcons(root);
}

// ---------------------------------------------------------------- profile
function profilePanel({ state, refresh }) {
  const p = structuredClone(state.household.profile);
  const num = (key, label, min = 0) => h("label", { class: "field" }, label,
    h("input", { type: "number", min, max: 30, value: p[key], oninput: (e) => (p[key] = Number(e.target.value)) }));
  const petsBox = h("div", { class: "stack" });
  const renderPets = () => clear(petsBox, p.pets.map((pet, i) => h("div", { class: "form-row" },
    h("label", { class: "field" }, "Pet", h("input", { type: "text", value: pet.kind, oninput: (e) => (pet.kind = e.target.value) })),
    h("label", { class: "field" }, "Size", select(["small", "medium", "large"], pet.size, (v) => (pet.size = v))),
    h("label", { class: "field" }, "Count", h("input", { type: "number", min: 1, max: 20, value: pet.count, oninput: (e) => (pet.count = Number(e.target.value)) })),
    h("button", { class: "btn ghost sm", type: "button", onclick: () => { p.pets.splice(i, 1); renderPets(); }, "aria-label": "Remove pet" }, icon("x")))));
  renderPets();

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put("/household", {
        ...p,
        dietary_restrictions: splitList(form.querySelector("[name=diet]").value),
        special_requirements: splitList(form.querySelector("[name=special]").value),
      });
      toast("Household profile saved — targets recalculated");
      await refresh();
    } catch (err) { toast(err.message, true); }
  };

  const form = h("form", { onsubmit: save },
    h("div", { class: "form-row" },
      h("label", { class: "field", style: { flex: "2 1 200px" } }, "Household name", h("input", { type: "text", value: p.name, oninput: (e) => (p.name = e.target.value) })),
      num("adults", "Adults"), num("children", "Children"),
      h("label", { class: "field" }, "Prepare for", select(["3", "7", "14", "30"], String(p.duration_days), (v) => (p.duration_days = Number(v)), (v) => `${v} days`))),
    h("div", { class: "form-row", style: { marginTop: "10px" } },
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: p.hot_climate, onchange: (e) => (p.hot_climate = e.target.checked) }), "Hot climate"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: p.needs_medication, onchange: (e) => (p.needs_medication = e.target.checked) }), "Someone takes regular medication")),
    h("div", { class: "form-row", style: { marginTop: "10px" } },
      h("label", { class: "field" }, "Dietary restrictions (comma separated)", h("input", { type: "text", name: "diet", value: p.dietary_restrictions.join(", ") })),
      h("label", { class: "field" }, "Special requirements (comma separated)", h("input", { type: "text", name: "special", value: p.special_requirements.join(", ") }))),
    h("div", { style: { marginTop: "10px" } }, petsBox),
    h("div", { class: "form-row", style: { marginTop: "10px" } },
      h("button", { class: "btn sm", type: "button", onclick: () => { p.pets.push({ kind: "dog", size: "medium", count: 1 }); renderPets(); } }, icon("plus"), "Add pet"),
      h("span", { style: { flex: 1 } }),
      h("button", { class: "btn primary", type: "submit" }, "Save profile")));

  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Household profile"),
      h("div", { class: "right" }, state.household.confirmed ? h("span", { class: "badge teal" }, "✓ confirmed by you") : h("span", { class: "badge amber" }, "⚠ default — not confirmed"))),
    form);
}

// ---------------------------------------------------------------- readiness
function readinessPanel(r) {
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Smart survival kit"),
      h("div", { class: "right" }, h("span", { class: "badge" }, `${r.household.people} people · ${r.household.pets} pets · ${r.household.duration_days} days`))),
    h("div", { class: "meter" },
      ring(r.overall_coverage),
      h("div", {},
        h("div", { style: { fontWeight: 600 } }, `${pct(r.overall_coverage)} coverage of planning targets`),
        h("div", { class: "muted", style: { fontSize: "13px", maxWidth: "520px" } }, r.disclaimer),
        h("div", { class: "form-row", style: { marginTop: "8px" } },
          h("span", { class: "chip" }, `Water: ${r.supply_days.water != null ? fmt(r.supply_days.water) + " days" : "—"}`),
          h("span", { class: "chip" }, `Food: ${r.supply_days.food != null ? fmt(r.supply_days.food) + " days" : "—"}`)))),
    h("table", { class: "data", style: { marginTop: "14px" } },
      h("thead", {}, h("tr", {}, ["Target", "Need", "Have", "Coverage", "Status", "Basis"].map((t) => h("th", {}, t)))),
      h("tbody", {}, r.targets.map((t) => h("tr", {},
        h("td", {}, h("div", {}, t.label), h("div", { class: "faint", style: { fontSize: "11.5px" }, title: t.explain }, t.working)),
        h("td", { class: "num" }, fmt(t.quantity, t.unit)),
        h("td", { class: "num" }, fmt(t.have, t.unit)),
        h("td", {}, bar(t.coverage, t.status)),
        h("td", {}, statusTag(t.status)),
        h("td", {}, h("span", { class: `badge ${t.basis === "guideline" ? "teal" : ""}`, title: t.explain }, t.basis === "guideline" ? "guideline" : "planning default")))))),
    h("p", { class: "faint", style: { fontSize: "12px", marginBottom: 0 } },
      "Targets are calculated deterministically from data/assumptions.json. 'Guideline' numbers come from the cited source; 'planning default' numbers are Prometheus assumptions you can change. Food counts energy (kcal), so record kcal per unit for food items."));
}

function alertsPanel(r) {
  const alerts = [];
  for (const e of r.expired) alerts.push(alert("red", "warn", `${e.name} expired on ${e.expires_on} — not counted.`));
  for (const e of r.expiring_soon) alerts.push(alert("amber", "warn", `${e.name} expires in ${e.days_left} days (${e.expires_on}).`));
  for (const u of r.unavailable) alerts.push(alert("amber", "info", `${u.name} is marked unavailable — not counted.`));
  for (const n of r.not_counted) alerts.push(alert("amber", "info", `${n.name} isn't counted: ${n.reason}.`));
  if (r.untracked.length) alerts.push(alert("teal", "info", `Not linked to a target: ${r.untracked.map((u) => u.name).join(", ")}. Set "Counts toward" (and kcal for food) to include them.`));
  if (!alerts.length) return null;
  return h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Attention")), h("div", { class: "stack" }, alerts));
}

function alert(kind, ic, text) {
  return h("div", { class: `alert ${kind}` }, icon(ic), h("div", {}, text));
}

// ---------------------------------------------------------------- tasks
function tasksPanel({ state, refresh }) {
  const tasks = state.tasks;
  const complete = async (t, add) => {
    try {
      const out = await api.post(`/tasks/${t.id}/complete`, { add_to_inventory: add });
      toast(out.added_item ? `Done — added ${fmt(out.added_item.quantity, out.added_item.unit)} to inventory` : "Task done");
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const newTask = h("input", { type: "text", placeholder: "Add your own task…" });
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Restock & preparation tasks"),
      h("div", { class: "right" }, h("span", { class: "badge" }, `${tasks.filter((t) => t.status === "open").length} open`))),
    tasks.length ? h("table", { class: "data" }, h("tbody", {}, tasks.map((t) => h("tr", { style: t.status === "done" ? { opacity: 0.55 } : {} },
      h("td", { style: { width: "28px" } }, t.status === "done" ? "✓" : "☐"),
      h("td", {}, h("div", { style: t.status === "done" ? { textDecoration: "line-through" } : {} }, t.title),
        t.detail ? h("div", { class: "faint", style: { fontSize: "12px" } }, t.detail) : null),
      h("td", {}, h("span", { class: `badge ${t.source === "prometheus" ? "teal" : ""}` }, t.source === "prometheus" ? "from Prometheus · approved" : "yours")),
      h("td", { style: { whiteSpace: "nowrap", textAlign: "right" } },
        t.status === "open" ? [
          t.target_key && t.quantity ? h("button", { class: "btn sm", onclick: () => complete(t, true), title: "Mark done and add the item to inventory" }, "Done + add to inventory") : null, " ",
          h("button", { class: "btn sm", onclick: () => complete(t, false) }, "Done"),
        ] : h("button", { class: "btn ghost sm", onclick: async () => { await api.patch(`/tasks/${t.id}`, { status: "open" }); refresh(); } }, "Reopen"),
        h("button", { class: "btn ghost sm", "aria-label": "Delete task", onclick: async () => { await api.del(`/tasks/${t.id}`); refresh(); } }, icon("trash"))))))) :
      h("div", { class: "empty" }, "No tasks yet. Ask Prometheus: “What are we short of? Propose restock tasks.”"),
    h("form", { class: "form-row", style: { marginTop: "10px" }, onsubmit: async (e) => {
      e.preventDefault();
      if (!newTask.value.trim()) return;
      await api.post("/tasks", { title: newTask.value.trim() });
      refresh();
    } }, h("label", { class: "field", style: { flex: "1 1 260px" } }, newTask), h("button", { class: "btn sm", type: "submit" }, icon("plus"), "Add task")));
}

// ---------------------------------------------------------------- inventory
function inventoryPanel({ refresh }, items, r) {
  const targets = r.targets.map((t) => [t.key, t.label]);
  const draft = { name: "", category: "water", quantity: 1, unit: "L", target_key: "", kcal_per_unit: "", expires_on: "", status: "ok" };
  const patch = async (id, body) => {
    try { await api.patch(`/inventory/${id}`, body); await refresh(); } catch (e) { toast(e.message, true); }
  };
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post("/inventory", {
        ...draft,
        quantity: Number(draft.quantity),
        target_key: draft.target_key || null,
        kcal_per_unit: draft.kcal_per_unit === "" ? null : Number(draft.kcal_per_unit),
        expires_on: draft.expires_on || null,
      });
      toast(`Added ${draft.name} — shortages recalculated`);
      await refresh();
    } catch (err) { toast(err.message, true); }
  };
  const tf = (key, label, attrs = {}) => h("label", { class: "field" }, label, h("input", { value: draft[key], oninput: (e) => (draft[key] = e.target.value), ...attrs }));

  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Inventory"), h("div", { class: "right" }, h("span", { class: "badge" }, `${items.length} items`))),
    items.length ? h("div", { style: { overflowX: "auto" } }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, ["Item", "Qty", "Counts toward", "kcal/unit", "Expires", "Condition", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, items.map((i) => h("tr", {},
        h("td", {}, h("div", {}, i.name), h("div", { class: "faint", style: { fontSize: "11.5px" } }, i.category)),
        h("td", { class: "num" }, h("input", { class: "qty", type: "number", min: 0, step: "any", value: i.quantity, "aria-label": `Quantity of ${i.name}`,
          onchange: (e) => patch(i.id, { quantity: Number(e.target.value) }) }), " ", i.unit),
        h("td", {}, select(["", ...targets.map((t) => t[0])], i.target_key || "", (v) => patch(i.id, { target_key: v || null }),
          (v) => (v ? targets.find((t) => t[0] === v)?.[1] || v : "— not linked —"))),
        h("td", { class: "num" }, i.kcal_per_unit ?? "—"),
        h("td", { class: "num" }, i.expires_on || "—"),
        h("td", {}, h("button", { class: `btn sm ${i.status === "ok" ? "" : "danger"}`, title: "Toggle working / unavailable",
          onclick: () => patch(i.id, { status: i.status === "ok" ? "unavailable" : "ok" }) }, i.status === "ok" ? "✓ Working" : "✕ Unavailable")),
        h("td", {}, h("button", { class: "btn ghost sm", "aria-label": `Delete ${i.name}`, onclick: async () => { await api.del(`/inventory/${i.id}`); refresh(); } }, icon("trash")))))))) :
      h("div", { class: "empty" }, "Inventory is empty. Add items below or ask Prometheus to add them."),
    h("form", { onsubmit: add, style: { marginTop: "14px" } },
      h("div", { class: "eyebrow", style: { marginBottom: "8px" } }, "Add item"),
      h("div", { class: "form-row" },
        tf("name", "Name", { type: "text", required: true, placeholder: "e.g. Bottled water" }),
        h("label", { class: "field" }, "Category", select(CATEGORIES, draft.category, (v) => (draft.category = v))),
        tf("quantity", "Quantity", { type: "number", min: 0, step: "any", required: true }),
        tf("unit", "Unit", { type: "text", required: true, placeholder: "L, each, cans…" })),
      h("div", { class: "form-row", style: { marginTop: "8px" } },
        h("label", { class: "field" }, "Counts toward", select(["", ...targets.map((t) => t[0])], "", (v) => (draft.target_key = v), (v) => (v ? targets.find((t) => t[0] === v)?.[1] : "auto / none"))),
        tf("kcal_per_unit", "kcal per unit (food)", { type: "number", min: 0, step: "any" }),
        tf("expires_on", "Expires", { type: "date" }),
        h("label", { class: "field" }, "Condition", select(["ok", "unavailable"], "ok", (v) => (draft.status = v), (v) => (v === "ok" ? "Working" : "Unavailable"))),
        h("button", { class: "btn primary", type: "submit" }, icon("plus"), "Add"))));
}

// ---------------------------------------------------------------- helpers
function select(options, value, onchange, labelFn = (v) => v) {
  return h("select", { onchange: (e) => onchange(e.target.value) },
    options.map((o) => h("option", { value: o, selected: o === value }, labelFn(o))));
}

function splitList(s) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
