// SOS: a full-screen emergency flow. High contrast, no animation, big buttons, one thing per screen.
// It needs no AI: everything comes from the curated scenarios, the vault and the household's own data.
import { api } from "../api.js";
import { clear, h, icon } from "../ui.js";
import { app } from "./app.js";
import { STEP_GROUPS } from "./cards/survive.js";

const CHOICES = [
  ["blackout", "Power out", "bolt"],
  ["supply_disruption", "Can't get supplies", "box"],
  ["isolation", "Storm, flood or fire cut us off", "home"],
];
const DONE_KEY = (id) => `prometheus.sos.done.${id}`;

let root = null;
let state = null;
let lastFocus = null;

const get = async (path) => app.cache[path] && !(app.cache[path] instanceof Promise) ? app.cache[path] : (app.cache[path] = await api.get(path));

export function openSos(scenario = null) {
  lastFocus = document.activeElement;
  root = h("div", { class: "sos-screen", role: "dialog", "aria-modal": "true", "aria-label": "Emergency help" });
  document.body.appendChild(root);
  document.body.classList.add("sos-open");
  // Everything behind the takeover is out of reach for keyboards and screen readers.
  document.querySelectorAll("body > :not(.sos-screen)").forEach((el) => { el.inert = true; });
  state = { history: [] };
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSos(); });
  if (scenario) pick(scenario); else show(hurt);
}

export function closeSos() {
  root?.remove();
  root = null;
  document.body.classList.remove("sos-open");
  document.querySelectorAll("body > *").forEach((el) => { el.inert = false; });
  lastFocus?.focus?.();
}

// Every screen: a header with the emergency number always in reach, then one question or one step.
function show(screen, push = true) {
  if (push && state.current) state.history.push(state.current);
  state.current = screen;
  Promise.resolve(screen()).then((body) => {
    clear(root,
      h("div", { class: "sos-head" },
        state.history.length ? h("button", { class: "sos-back", type: "button", onclick: back }, "‹ Back") : h("span", { class: "sos-title" }, "SOS"),
        h("a", { class: "sos-call sm", href: "tel:000" }, icon("phone"), "Call 000"),
        h("button", { class: "sos-close", type: "button", "aria-label": "Close SOS", onclick: closeSos }, icon("x"))),
      h("div", { class: "sos-main" }, body));
    root.querySelector("h1")?.setAttribute("tabindex", "-1");
    root.querySelector("h1")?.focus();
  }).catch((e) => clear(root, h("div", { class: "sos-main" }, h("h1", {}, "Couldn't load this."), h("p", {}, e.message), big("Close", closeSos))));
}

function back() {
  const prev = state.history.pop();
  if (prev) show(prev, false);
}

const big = (label, onclick, cls = "") => h("button", { class: `sos-btn ${cls}`, type: "button", onclick }, label);
const numbers = () => h("p", { class: "sos-numbers" }, "000 (AU) · ",
  h("a", { href: "tel:911" }, "911 (US)"), " · ", h("a", { href: "tel:112" }, "112"));

// The vault's own words for an urgent answer; nothing is made up here.
async function entryBlock(id, open = true) {
  const e = await get(`/knowledge/${id}`);
  return h("section", { class: "sos-entry" },
    h("h2", {}, e.title),
    open ? h("ul", {}, e.points.map((p) => h("li", {}, p))) : h("p", {}, e.summary),
    h("p", { class: "sos-src" }, "From ", [...new Map(e.sources.map((s) => [s.publisher, s])).values()]
      .map((s, i) => [i ? ", " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.publisher)])));
}

// 1. Is anyone hurt or in danger?
function hurt() {
  return [
    h("h1", {}, "Is anyone hurt or in danger?"),
    h("div", { class: "sos-row" }, big("Yes", () => show(callNow), "danger"), big("No", () => show(what))),
  ];
}

async function callNow() {
  return [
    h("h1", {}, "Call for help now"),
    h("a", { class: "sos-call", href: "tel:000" }, icon("phone"), "Call 000"),
    numbers(),
    await entryBlock("kb-first-aid-basics"),
    big("Next: what's happening?", () => show(what)),
  ];
}

// 2. What's happening?
function what() {
  return [
    h("h1", {}, "What's happening?"),
    h("div", { class: "sos-col" }, CHOICES.map(([id, label, ic]) => big([icon(ic), label], () => pick(id)))),
    h("p", { class: "sos-note" }, "The zombie drill is on the Survive canvas. It's a game, not for real emergencies."),
  ];
}

async function pick(id) {
  state.guide = await get(`/scenarios/${id}`);
  state.q = 0;
  show(question);
}

// 3. Safety check: the scenario's own questions, one per screen.
async function question() {
  const g = state.guide, i = state.q;
  if (i >= g.triage_questions.length) return steps();
  const t = g.triage[i] || {};
  const next = () => { state.q = i + 1; show(question); };
  const answer = (v) => (t.danger === v ? show(urgent) : next());
  if (t.show === "supplies") {
    const hh = g.household;
    const d = (x) => (x == null ? "none recorded" : `${Math.round(x * 10) / 10} days`);
    return [
      h("p", { class: "sos-step" }, `Safety check ${i + 1} of ${g.triage_questions.length}`),
      h("h1", {}, "What you have"),
      h("p", { class: "sos-big" }, `Water: ${d(hh.water_days_available)}`),
      h("p", { class: "sos-big" }, `Food: ${d(hh.food_days_available)}`),
      big("Next", next),
    ];
  }
  return [
    h("p", { class: "sos-step" }, `Quick safety check · ${i + 1} of ${g.triage_questions.length}`),
    h("h1", {}, g.triage_questions[i]),
    h("div", { class: "sos-row" }, big("Yes", () => answer("yes")), big("No", () => answer("no"))),
  ];
}

async function urgent() {
  const t = state.guide.triage[state.q];
  const blocks = await Promise.all((t.kb || []).map((id) => entryBlock(id)));
  return [
    h("h1", {}, "Do this first"),
    t.call ? [h("a", { class: "sos-call", href: "tel:000" }, icon("phone"), "Call 000"), numbers()] : null,
    blocks,
    big("Next", () => { state.q += 1; show(question); }),
  ];
}

// 4. Steps, one card at a time: from your saved plan if there is one, else the scenario's guideline steps.
function stepList() {
  const g = state.guide;
  const plan = app.data.plans?.find((p) => p.scenario === g.scenario.id);
  const src = plan ? plan.steps : g.guideline_steps;
  let done = {};
  try { done = JSON.parse(sessionStorage.getItem(DONE_KEY(g.scenario.id)) || "{}"); } catch { /* ignore */ }
  const order = STEP_GROUPS.map(([p]) => p);
  return { plan, list: src.map((s, i) => ({ ...s, i, done: plan ? s.done : !!done[i] })).sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority)) };
}

function youHave(text) {
  const hh = state.guide.household;
  const days = (x, what) => (x == null ? null : `${Math.round(x * 10) / 10} days of ${what}`);
  const checks = [
    [/radio/i, hh.radio.join(", ")], [/torch|candle|light/i, hh.lighting.join(", ")],
    [/water/i, days(hh.water_days_available, "water")], [/food|fridge|meal|pantry/i, days(hh.food_days_available, "food")],
    [/phone|power bank|charg/i, hh.power.join(", ")], [/first aid|injur|hurt/i, hh.first_aid.join(", ")],
  ];
  const have = checks.filter(([re, v]) => re.test(text) && v).map(([, v]) => v);
  return have.length ? h("p", { class: "sos-have" }, h("strong", {}, "You have: "), have.join("; ")) : null;
}

function steps() {
  const { list } = stepList();
  const k = list.findIndex((s) => !s.done);
  if (k < 0) return finished();
  state.step = list[k];
  const s = list[k];
  const label = STEP_GROUPS.find(([p]) => p === s.priority)?.[1] || "";
  const why = h("div", { class: "sos-why" });
  return [
    h("p", { class: "sos-step" }, `${label} · ${k + 1} of ${list.length}`),
    h("h1", {}, s.text),
    youHave(s.text),
    s.knowledge_refs?.[0] ? h("button", { class: "sos-link", type: "button", onclick: async (e) => {
      e.target.remove();
      why.replaceChildren(await entryBlock(s.knowledge_refs[0]));
    } }, "Why?") : null,
    why,
    h("div", { class: "sos-row" }, big([icon("check"), "Done"], () => markDone(s), "ok"), big("Skip", () => markDone(s, true), "quiet")),
  ];
}

// Ticking off a step is always instant: no approval, in every mode.
async function markDone(s, skip = false) {
  const { plan } = stepList();
  if (plan && !skip) {
    await api.patch(`/plans/${plan.id}/steps/${s.i}`, { done: true }).catch(() => {});
    await app.refresh().catch(() => {});
  } else {
    const key = DONE_KEY(state.guide.scenario.id);
    let done = {};
    try { done = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { /* ignore */ }
    done[s.i] = true;
    try { sessionStorage.setItem(key, JSON.stringify(done)); } catch { /* ignore */ }
  }
  show(steps, false);
}

// 5. Back to normal → restock what you used.
function finished() {
  return [
    h("h1", {}, "That's every step."),
    h("p", { class: "sos-note" }, "Keep listening for official updates."),
    big("Back to normal", () => show(restock), "ok"),
    big("Start the steps again", () => {
      try { sessionStorage.removeItem(DONE_KEY(state.guide.scenario.id)); } catch { /* ignore */ }
      show(steps, false);
    }, "quiet"),
  ];
}

function restock() {
  return [
    h("h1", {}, "Restock what you used?"),
    h("div", { class: "sos-row" },
      big("Yes", async () => { closeSos(); await app.show("prepare"); await app.spawn("next"); }, "ok"),
      big("Not now", closeSos, "quiet")),
  ];
}
