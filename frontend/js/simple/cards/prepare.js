// Prepare canvas cards. Every number comes from /api/summary (the deterministic calculator).
import { api } from "../../api.js";
import { h, icon, toast } from "../../ui.js";
import { announce, app, load, qty, stageLabel } from "../app.js";
import { button, dot, link, mini, num, pill, row, segmented, stepper } from "./common.js";

export const CAT_ICON = {
  water: "water", food: "food", medicine: "pill", pet_food: "paw", light_power: "bulb",
  radio: "radio", hygiene: "soap", tools: "wrench", documents: "doc",
};
// Inventory categories that belong on each card when an item isn't linked to a target.
const LOOSE = { water: "water", food: "food", medical: "medicine", lighting: "light_power", power: "light_power", communication: "radio", hygiene: "hygiene", tools: "tools", documents: "documents" };

const summary = () => app.data.summary;
const catOf = (key) => summary().categories.find((c) => c.key === key);
const targetRow = (key) => summary().categories.flatMap((c) => c.targets).find((t) => t.key === key);

// ---------------------------------------------------------------- Ready in stages
function stages() {
  const s = summary();
  const cur = s.stages.find((x) => !x.reached);
  const goal = s.stages.at(-1);
  return {
    icon: "flag", title: "Ready in stages", width: 340, status: cur ? "partial" : "met",
    body: [
      h("ol", { class: "ladder", style: { "--n": s.stages.length } }, s.stages.map((st) => h("li", {
        class: st.reached ? "reached" : st === cur ? "current" : "",
        title: st.reached ? `Ready for ${st.label}` : `${st.left} left for ${st.label}`,
      }, h("span", { class: "rung" }, st.reached ? icon("check") : null), h("span", { class: "lbl" }, st.label)))),
      cur
        ? h("p", { class: "headline" }, num(String(cur.left), "stages.left"), ` left for ${cur.label}`)
        : h("p", { class: "headline ok" }, icon("check"), ` Ready for ${goal.label}`),
      cur ? link("See what to get", () => app.spawn("next")) : null,
    ],
    mini: mini(cur ? `${cur.left} left` : "Ready", cur ? `for ${cur.label}` : `for ${goal.label}`),
  };
}

// ---------------------------------------------------------------- Next up
function next() {
  const s = summary();
  const items = s.next_up;
  const label = stageLabel(s.focus_days);
  return {
    icon: "list", title: "Next up", tag: s.current ? `for ${label}` : "", width: 300,
    status: items.length ? "partial" : "met",
    body: items.length
      ? h("ul", { class: "checklist" }, items.map((it) => h("li", { "data-key": it.key },
          it.key === "food_kcal"
            ? [h("span", { class: "box", "aria-hidden": "true" }), h("span", { class: "t" }, it.title), link("How?", () => app.spawn("category", "food"))]
            : h("label", { class: "tick" },
                h("input", { type: "checkbox", onchange: (e) => tick(it, e.target) }),
                h("span", { class: "t" }, it.title)))))
      : h("p", { class: "headline ok" }, icon("check"), ` All set for ${label}`),
    mini: mini(items.length ? `${items.length} to get` : "All set", `for ${label}`),
  };
}

// Ticking an item completes its task and adds it to supplies (the existing task endpoint).
async function tick(it, box) {
  box.disabled = true;
  try {
    let task = app.data.tasks.find((t) => t.status === "open" && t.target_key === it.key && t.quantity === it.quantity);
    if (!task) {
      task = await api.post("/tasks", { title: `Get ${lowerFirst(it.title)}`, target_key: it.key, quantity: it.quantity, unit: it.unit });
    }
    await api.post(`/tasks/${task.id}/complete`, { add_to_inventory: true });
    announce(`Added ${it.title} to your supplies`);
    await app.refresh({ ripple: true });
  } catch (e) {
    box.checked = false; box.disabled = false;
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------- supply categories
function itemsFor(cat) {
  const keys = new Set(cat.targets.map((t) => t.key));
  return app.data.inventory.filter((i) => (i.target_key ? keys.has(i.target_key) : LOOSE[i.category] === cat.key));
}

function headline(cat) {
  const t = cat.targets[0];
  if (cat.key === "water") return h("p", { class: "headline" }, num(t.have_text, "water.have"), h("span", { class: "sub" }, " · ", num(dayText(t.days), "water.days")));
  if (cat.key === "food") return h("p", { class: "headline" }, num(dayText(t.days), "food.days"), h("span", { class: "sub" }, " of food for everyone"));
  if (cat.key === "pet_food") return h("p", { class: "headline" }, num(dayText(t.days), "pet_food.days"), h("span", { class: "sub" }, " of pet food"));
  if (cat.key === "medicine" && t.key === "medication_days") return h("p", { class: "headline" }, num(dayText(t.days), "medication_days.have"), h("span", { class: "sub" }, " of medicine"));
  return null;
}

function dayText(d) {
  return d == null ? "—" : `${Math.round(d * 10) / 10} day${d === 1 ? "" : "s"}`;
}

function lowerFirst(s) {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function gearText(t) {
  return `${qty(t.have)} of ${t.need_text}`;
}

function category(c) {
  const cat = catOf(c.key);
  if (!cat) return null;
  const s = summary();
  const label = stageLabel(s.focus_days);
  const items = itemsFor(cat);
  const head = headline(cat);
  const rows = cat.targets.filter((t) => !head || t !== cat.targets[0]);
  const single = cat.targets.length === 1;
  const t0 = cat.targets[0];
  const short = cat.targets.filter((t) => t.short_text).map((t) => t.short_text);
  const miniValue = head ? head.querySelector(".num").textContent : gearText(cat.targets.find((t) => t.status !== "met") || t0);
  return {
    icon: CAT_ICON[cat.key], title: cat.label, width: 330, status: cat.status,
    body: [
      head,
      rows.length ? h("ul", { class: "targets" }, rows.map((t) => h("li", {},
        dot(t.status), num(gearText(t), `${t.key}.have`),
        single ? null : link("Why?", () => app.spawn("why", t.key))))) : null,
      h("div", { class: "status-line" },
        cat.status === "met" ? pill("met", `Enough for ${label}`) : pill(cat.status, `Short for ${label}`),
        short.length && head ? h("span", { class: "need" }, `Get ${short.map(lowerFirst).join(", ")}`) : null),
      items.length ? h("ul", { class: "items" }, items.map((i) => itemRow(c, i, cat))) : h("p", { class: "muted" }, "Nothing recorded yet."),
      c.ui.adding ? addForm(c, cat) : null,
      row(
        c.ui.adding ? null : button("Add", () => { c.ui.adding = true; app.canvas.paint(c); }, "sm"),
        single || head ? link("Why?", () => app.spawn("why", t0.key), "help") : null),
    ],
    mini: mini(miniValue, cat.status === "met" ? "Ready" : "Short"),
  };
}

function itemRow(c, i, cat) {
  const r = app.data.summary;
  const expired = r.expired.find((e) => e.id === i.id);
  const soon = r.expiring_soon.find((e) => e.id === i.id);
  const uncounted = r.not_counted.find((e) => e.id === i.id) || (!i.target_key && r.untracked.find((e) => e.id === i.id));
  const broken = i.status === "unavailable";
  const food = cat.key === "food" && uncounted && !i.kcal_per_unit;
  return h("li", { class: broken || expired ? "off" : "" },
    h("div", { class: "item-main" },
      h("span", { class: "name" }, i.name),
      broken ? h("span", { class: "tag bad" }, "Broken or used up") : null,
      expired ? h("span", { class: "tag bad" }, "Expired") : soon ? h("span", { class: "tag warn" }, `Use within ${soon.days_left} days`) : null,
      uncounted && !food && !broken ? h("span", { class: "tag" }, "Not counted") : null),
    h("div", { class: "item-ctl" },
      qtyStepper(c, i),
      broken
        ? link("Working again", () => patchItem(i, { status: "ok" }, `${i.name} is working again`))
        : link("Broken or used up", () => patchItem(i, { status: "unavailable" }, `${i.name} marked broken or used up`))),
    food ? kcalAsk(i) : null);
}

function qtyStepper(c, i) {
  const step = 1;
  const set = (v) => {
    i.quantity = Math.max(0, Math.round(v * 10) / 10);
    app.canvas.paint(c);
    clearTimeout(i._t);
    i._t = setTimeout(() => patchItem(i, { quantity: i.quantity }, `${i.name}: ${qty(i.quantity, i.unit)}`), 450);
  };
  return h("span", { class: "stepper sm", role: "group", "aria-label": `Amount of ${i.name}` },
    h("button", { type: "button", "aria-label": `Less ${i.name}`, disabled: i.quantity <= 0, onclick: () => set(i.quantity - step) }, icon("minus")),
    h("output", {}, qty(i.quantity, i.unit === "each" ? "" : i.unit)),
    h("button", { type: "button", "aria-label": `More ${i.name}`, onclick: () => set(i.quantity + step) }, icon("plus")));
}

// Food only counts once its energy is known. We never guess it: the label (or the user) says.
function kcalAsk(i) {
  const unit = i.unit.replace(/s$/, "");
  const input = h("input", { type: "number", min: 1, step: "any", inputmode: "numeric", placeholder: "kcal", "aria-label": `kcal per ${unit} of ${i.name}` });
  return h("form", { class: "kcal-ask", onsubmit: (e) => {
    e.preventDefault();
    const v = Number(input.value);
    if (v > 0) patchItem(i, { kcal_per_unit: v, target_key: "food_kcal" }, `${i.name} now counts as food`);
  } }, h("span", {}, `Not counted yet. kcal per ${unit}? (on the label)`), input, h("button", { class: "btn sm", type: "submit" }, "Count it"));
}

async function patchItem(i, body, msg) {
  try {
    await api.patch(`/inventory/${i.id}`, body);
    announce(msg);
    await app.refresh({ ripple: true });
  } catch (e) { toast(e.message, true); }
}

function addForm(c, cat) {
  const targets = cat.targets;
  const meta = (key) => app.data.readiness.targets.find((t) => t.key === key) || {};
  const d = c.ui.draft ||= { target: targets.find((t) => t.status !== "met")?.key || targets[0].key, name: "", amount: 1, kcal: "" };
  const unitOf = (key) => ({ L: "L", kcal: "each", "pet-days": "pet-days", days: "days" })[meta(key).unit] || meta(key).unit || "each";
  const save = async (e) => {
    e.preventDefault();
    const m = meta(d.target);
    const unit = d.target === "food_kcal" ? "each" : unitOf(d.target);
    try {
      await api.post("/inventory", {
        name: d.name.trim() || m.label, category: m.category || cat.key, quantity: Number(d.amount) || 0, unit,
        target_key: d.target, kcal_per_unit: d.target === "food_kcal" && d.kcal ? Number(d.kcal) : null,
      });
      c.ui.adding = false; c.ui.draft = null;
      announce(`Added ${d.name || m.label}`);
      await app.refresh({ ripple: true });
    } catch (err) { toast(err.message, true); }
  };
  const field = (label, input) => h("label", { class: "field" }, h("span", {}, label), input);
  return h("form", { class: "add-form", onsubmit: save },
    targets.length > 1 ? field("What", h("select", { onchange: (e) => (d.target = e.target.value) },
      targets.map((t) => h("option", { value: t.key, selected: t.key === d.target }, t.label)))) : null,
    field("Name", h("input", { type: "text", value: d.name, placeholder: meta(d.target).label, oninput: (e) => (d.name = e.target.value) })),
    field(d.target === "food_kcal" ? "How many" : `Amount (${unitOf(d.target)})`,
      h("input", { type: "number", min: 0, step: "any", value: d.amount, oninput: (e) => (d.amount = e.target.value) })),
    d.target === "food_kcal" ? field("kcal each (on the label)", h("input", { type: "number", min: 0, step: "any", value: d.kcal, oninput: (e) => (d.kcal = e.target.value) })) : null,
    row(h("button", { class: "btn primary sm", type: "submit" }, "Save"),
      button("Cancel", () => { c.ui.adding = false; c.ui.draft = null; app.canvas.paint(c); }, "sm ghost")));
}

// ---------------------------------------------------------------- household
function household(c) {
  const hh = app.data.household;
  const p = hh.profile;
  const people = p.adults + p.children;
  if (c.ui.edit) return householdEdit(c, p);
  const pets = p.pets.map((x) => `${x.count} ${x.kind}${x.count > 1 ? "s" : ""}`).join(", ");
  const line = (k, v) => h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));
  return {
    icon: "people", title: "Household", width: 300, status: hh.confirmed ? "" : "partial",
    tag: hh.confirmed ? "" : "Not set up",
    body: [
      line("People", num(`${p.adults} adult${p.adults === 1 ? "" : "s"} · ${p.children} child${p.children === 1 ? "" : "ren"}`, "household.people")),
      line("Pets", pets || "None"),
      line("Goal", num(`${p.duration_days} days`, "household.goal")),
      p.needs_medication ? line("Medicine", "Someone takes it daily") : null,
      p.hot_climate ? line("Climate", "Hot") : null,
      [...p.dietary_restrictions, ...p.special_requirements].length
        ? h("ul", { class: "notes" }, [...p.dietary_restrictions, ...p.special_requirements].map((n) => h("li", {}, n))) : null,
      row(button("Edit", () => { c.ui.edit = structuredClone(p); app.canvas.paint(c); }, "sm")),
    ],
    mini: mini(`${people} ${people === 1 ? "person" : "people"}`, `${p.duration_days} days`),
  };
}

function householdEdit(c, p) {
  const d = c.ui.edit;
  const repaint = () => app.canvas.paint(c);
  const set = (k) => (v) => { d[k] = v; repaint(); };
  const line = (k, ctl) => h("div", { class: "kv edit" }, h("span", { class: "k" }, k), ctl);
  const save = async () => {
    try {
      await api.patch("/household", {
        adults: d.adults, children: d.children, pets: d.pets, duration_days: d.duration_days,
        needs_medication: d.needs_medication, hot_climate: d.hot_climate,
      });
      c.ui.edit = null;
      announce("Household saved");
      await app.refresh({ ripple: true });
    } catch (e) { toast(e.message, true); }
  };
  return {
    icon: "people", title: "Household", width: 300, status: "",
    body: [
      line("Adults", stepper(d.adults, set("adults"), { label: "adults" })),
      line("Children", stepper(d.children, set("children"), { label: "children" })),
      d.pets.map((pet, i) => line(pet.kind[0].toUpperCase() + pet.kind.slice(1) + "s", stepper(pet.count, (v) => {
        if (v < 1) d.pets.splice(i, 1); else pet.count = v;
        repaint();
      }, { min: 0, max: 20, label: pet.kind }))),
      line("Pets", h("span", { class: "row" },
        link("+ Dog", () => { addPet(d, "dog"); repaint(); }), link("+ Cat", () => { addPet(d, "cat"); repaint(); }))),
      line("Goal", segmented([[3, "3d"], [7, "1wk"], [14, "2wk"], [30, "30d"]], d.duration_days, set("duration_days"), "Goal")),
      line("Medicine", segmented([[true, "Yes"], [false, "No"]], d.needs_medication, set("needs_medication"), "Daily medicine")),
      line("Hot climate", segmented([[true, "Yes"], [false, "No"]], d.hot_climate, set("hot_climate"), "Hot climate")),
      row(button("Save", save, "primary sm"), button("Cancel", () => { c.ui.edit = null; repaint(); }, "sm ghost")),
    ],
    mini: mini("Editing"),
  };
}

function addPet(d, kind) {
  const p = d.pets.find((x) => x.kind === kind);
  if (p) p.count += 1; else d.pets.push({ kind, size: kind === "cat" ? "small" : "medium", count: 1 });
}

// ---------------------------------------------------------------- expiring & broken
function expiring() {
  const s = summary();
  const rows = [
    ...s.expired.map((e) => [e, "bad", `Expired ${e.expires_on}`]),
    ...s.expiring_soon.map((e) => [e, "warn", `${e.days_left} days left`]),
    ...s.unavailable.map((e) => [e, "bad", "Broken or used up"]),
  ];
  return {
    icon: "clock", title: "Check these", width: 300, status: rows.length ? "partial" : "met",
    body: rows.length
      ? h("ul", { class: "items" }, rows.map(([e, cls, text]) => h("li", {},
          h("div", { class: "item-main" }, h("span", { class: "name" }, e.name), h("span", { class: `tag ${cls}` }, text)),
          text === "Broken or used up" ? h("div", { class: "item-ctl" }, link("Working again", () => patchItem(e, { status: "ok" }, `${e.name} is working again`))) : null)))
      : h("p", { class: "headline ok" }, icon("check"), " Nothing to check"),
    mini: mini(rows.length ? `${rows.length} to check` : "All good"),
  };
}

// ---------------------------------------------------------------- how do we know?
function why(c) {
  const t = targetRow(c.key);
  if (!t) return null;
  const src = (load("/sources") || []).find((x) => x.id === t.source);
  return {
    icon: "help", title: "How do we know?", width: 320, status: "",
    body: [
      h("h4", {}, t.label),
      h("p", {}, h("strong", {}, `For ${stageLabel(summary().focus_days)}: `), `${t.working} = ${t.need_text}`),
      h("p", { class: "muted" }, t.explain),
      h("p", {}, t.basis === "guideline" ? pill("met", "From a guideline") : h("span", { class: "pill" }, icon("info"), "Planning default")),
      src ? h("p", { class: "source" }, h("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, src.title), h("span", { class: "muted" }, ` · ${src.publisher}`)) : null,
      h("p", { class: "faint" }, "Planning targets, not a safety guarantee."),
    ],
    mini: mini(t.label),
  };
}

export const PREPARE = {
  stages: { canvas: "prepare", rank: 0, icon: () => "flag", title: () => "Ready in stages", render: stages },
  next: { canvas: "prepare", rank: 1, icon: () => "list", title: () => "Next up", render: next },
  household: { canvas: "prepare", rank: 2, icon: () => "people", title: () => "Household", render: household },
  category: {
    canvas: "prepare", rank: 10, keys: () => summary().categories.map((c) => c.key),
    icon: (k) => CAT_ICON[k], title: (k) => catOf(k)?.label || k, render: category,
  },
  expiring: { canvas: "prepare", rank: 30, icon: () => "clock", title: () => "Check these", render: expiring },
  why: { canvas: null, rank: 40, icon: () => "help", title: () => "How do we know?", render: why, hidden: true },
};
