// Survive canvas: scenarios, a quick safety check, what you've got, and response plans you can tick off.
import { api } from "../../api.js";
import { h, icon, toast } from "../../ui.js";
import { app, load } from "../app.js";
import { sendChat } from "../chat.js";
import { button, link, mini } from "./common.js";

export const ASK = {
  blackout: "The power is out and we don't know for how long. What should we do?",
  supply_disruption: "Shops have been closed for a week and supplies are running low. Help us plan.",
  isolation: "A storm has cut our roads and we're cut off. What should we do first?",
  zombie: "Let's run a zombie apocalypse drill. It's a fictional game, using our real supplies.",
};
const ICON = { blackout: "bolt", supply_disruption: "box", isolation: "home", zombie: "atom" };
export const STEP_GROUPS = [["immediate", "Right now"], ["today", "Today"], ["ongoing", "Keep doing"]];
export const EMERGENCY_NUMBERS = "000 (AU) · 911 (US) · 112";

const loading = (title, ic) => ({ icon: ic, title, body: h("p", { class: "muted" }, "Loading…"), mini: mini("…") });
const fiction = () => h("p", { class: "fiction" }, icon("atom"), "Fiction: a training game, not real advice");

function scenarios() {
  const list = load("/scenarios");
  if (!list) return loading("What's happening?", "shield");
  return {
    icon: "shield", title: "What's happening?", width: 320,
    body: h("ul", { class: "picker" }, list.map((s) => h("li", {},
      h("button", { type: "button", onclick: () => app.spawn("scenario", s.id) },
        icon(ICON[s.id] || "shield"),
        h("span", {}, s.fictional ? "Zombie drill" : s.title),
        s.fictional ? h("span", { class: "tag" }, "Fiction") : null)))),
    mini: mini(`${list.length} scenarios`),
  };
}

function scenario(c) {
  const g = load(`/scenarios/${c.key}`);
  if (!g) return loading("Scenario", ICON[c.key] || "shield");
  const s = g.scenario;
  return {
    icon: ICON[s.id] || "shield", title: s.fictional ? "Zombie drill" : s.title, width: 360, status: s.fictional ? "" : "partial",
    body: [
      s.fictional ? fiction() : h("p", { class: "call" }, icon("phone"), `Life at risk? Call ${EMERGENCY_NUMBERS} first.`),
      h("p", { class: "muted" }, s.description),
      // "Right now" is always open; later steps fold away to keep the card short.
      STEP_GROUPS.map(([p, label]) => {
        const steps = g.guideline_steps.filter((x) => x.priority === p);
        if (!steps.length) return null;
        const open = p === "immediate" || c.ui[p];
        return [
          h("h4", {}, open ? label : h("button", { class: "fold", type: "button", "aria-expanded": "false", onclick: () => { c.ui[p] = true; app.canvas.paint(c); } },
            `${label} (${steps.length})`, h("span", { "aria-hidden": "true" }, " ▸"))),
          open ? h("ul", { class: "steps" }, steps.map((x) => h("li", {},
            h("span", {}, x.text), x.knowledge_refs?.[0] ? link("Why?", () => app.spawn("guide", x.knowledge_refs[0])) : null))) : null,
        ];
      }),
      h("div", { class: "row" },
        button("Make our plan", () => sendChat(ASK[s.id]), "primary sm"),
        s.fictional ? null : button("Safety check", () => app.spawn("safety", s.id), "sm")),
    ],
    mini: mini(s.fictional ? "Drill" : "Guide", `${g.guideline_steps.length} steps`),
  };
}

// The quick safety check: the scenario's own triage questions.
function safety(c) {
  const g = load(`/scenarios/${c.key}`);
  if (!g) return loading("Quick safety check", "warn");
  const asked = c.ui.answers ||= {};
  return {
    icon: "warn", title: "Quick safety check", width: 340, status: Object.values(asked).includes("yes") ? "missing" : "",
    body: [
      h("ol", { class: "triage" }, g.triage_questions.map((q, i) => h("li", {},
        h("span", {}, q),
        h("span", { class: "segmented sm", role: "group", "aria-label": q },
          ["yes", "no"].map((v) => h("button", { type: "button", "aria-pressed": String(asked[i] === v), onclick: () => { asked[i] = v; app.canvas.paint(c); } }, v === "yes" ? "Yes" : "No")))))),
      Object.values(asked).includes("yes")
        ? h("p", { class: "call" }, icon("phone"), `If anyone could be hurt, call ${EMERGENCY_NUMBERS} now. Then tell Prometheus what's going on.`)
        : null,
      button("Open SOS", () => app.openSos?.(c.key), "sm danger"),
    ],
    mini: mini(`${g.triage_questions.length} questions`),
  };
}

function resources() {
  const g = load("/scenarios/blackout");
  if (!g) return loading("What you've got", "box");
  const hh = g.household;
  const line = (k, v, ok) => h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: `v ${ok === false ? "bad" : ""}` }, v));
  const days = (d) => (d == null ? "None recorded" : `${Math.round(d * 10) / 10} days`);
  return {
    icon: "box", title: "What you've got", width: 320,
    body: [
      line("Water", days(hh.water_days_available), (hh.water_days_available || 0) >= 3),
      line("Food", days(hh.food_days_available), (hh.food_days_available || 0) >= 3),
      line("Light", hh.lighting.join(", ") || "None recorded", hh.lighting.length > 0),
      line("Radio", hh.radio.join(", ") || "None recorded", hh.radio.length > 0),
      line("Power", hh.power.join(", ") || "None recorded", hh.power.length > 0),
      line("First aid", hh.first_aid.join(", ") || "None recorded", hh.first_aid.length > 0),
      hh.needs_medication ? line("Medicine", "Someone needs it daily. Protect the supply.") : null,
      hh.unavailable_equipment.length ? line("Broken", hh.unavailable_equipment.join(", "), false) : null,
      link("Fix gaps on Prepare", () => app.show("prepare")),
    ],
    mini: mini(days(hh.water_days_available), "of water"),
  };
}

// A saved plan to tick off (always instant), or the drafted one waiting for Save.
function plan(c) {
  const saved = app.data.plans.find((p) => p.scenario === c.key);
  const draft = app.data.actions.find((a) => a.kind === "create_plan" && a.status === "pending" && a.payload.scenario === c.key);
  const p = saved || draft?.payload;
  const fictional = c.key === "zombie";
  if (!p) {
    return {
      icon: "task", title: "Our plan", width: 340,
      body: [h("p", { class: "muted" }, "No plan yet."), button("Make our plan", () => sendChat(ASK[c.key] || ASK.blackout), "primary sm")],
      mini: mini("No plan"),
    };
  }
  const steps = saved ? p.steps : p.steps.map((s) => ({ ...s, done: false }));
  const done = steps.filter((s) => s.done).length;
  return {
    icon: "task", title: p.title, width: 360, status: saved ? (done === steps.length ? "met" : "partial") : "",
    tag: saved ? `${done} of ${steps.length}` : "Draft",
    body: [
      fictional ? fiction() : null,
      p.summary ? h("p", { class: "muted" }, p.summary) : null,
      STEP_GROUPS.map(([prio, label]) => {
        const list = steps.map((s, i) => [s, i]).filter(([s]) => s.priority === prio);
        return list.length ? [h("h4", {}, label), h("ul", { class: `checklist${saved ? "" : " drafted"}` }, list.map(([s, i]) => h("li", {},
          h("label", { class: "tick" },
            h("input", { type: "checkbox", checked: s.done, disabled: !saved, onchange: (e) => tickStep(p, i, e.target) }),
            h("span", { class: "t" }, s.text)),
          s.knowledge_refs?.[0] ? link("Why?", () => app.spawn("guide", s.knowledge_refs[0])) : null)))] : null;
      }),
    ],
    mini: mini(saved ? `${done} of ${steps.length}` : "Draft", "steps done"),
  };
}

async function tickStep(p, i, box) {
  try {
    await api.patch(`/plans/${p.id}/steps/${i}`, { done: box.checked });
    await app.refresh();
  } catch (e) { box.checked = !box.checked; toast(e.message, true); }
}

export const SURVIVE = {
  scenarios: { canvas: "survive", width: 320, rank: 0, icon: () => "shield", title: () => "What's happening?", render: scenarios },
  scenario: {
    canvas: "survive", width: 360, rank: 1, keys: () => (load("/scenarios") || []).map((s) => s.id),
    icon: (k) => ICON[k] || "shield", title: (k) => (load("/scenarios") || []).find((s) => s.id === k)?.title || k, render: scenario,
  },
  safety: { canvas: "survive", width: 340, rank: 2, icon: () => "warn", title: () => "Quick safety check", render: safety, hidden: true },
  resources: { canvas: "survive", width: 320, rank: 3, icon: () => "box", title: () => "What you've got", render: resources },
  plan: {
    canvas: "survive", width: 360, rank: 4, keys: () => [...new Set(app.data.plans.map((p) => p.scenario))],
    icon: () => "task", title: (k) => app.data.plans.find((p) => p.scenario === k)?.title || "Our plan", render: plan,
  },
};
