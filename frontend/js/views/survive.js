import { api } from "../api.js";
import { clear, fmt, h, icon, toast } from "../ui.js";

const ASK = {
  blackout: "The power grid has collapsed. We don't have electricity anymore. What should we do?",
  supply_disruption: "Shops have been closed for a week and supplies are running low. Help us plan.",
  isolation: "A storm has cut our roads and we're isolated. What should we do first?",
  zombie: "Let's run a zombie apocalypse drill — fictional simulation, using our real supplies.",
};

export async function renderSurvive(root, { state, refresh, navigate, sendChat }) {
  const scenarios = await api.get("/scenarios");
  const sel = state.view.scenario || "blackout";
  const guide = await api.get(`/scenarios/${sel}`);
  const hh = guide.household;

  clear(root,
    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Choose a scenario")),
      h("div", { class: "scenario-cards" }, scenarios.map((s) => h("button", {
        class: "scenario-card", "aria-pressed": String(s.id === sel),
        onclick: () => { state.view.scenario = s.id; renderSurvive(root, { state, refresh, navigate, sendChat }); },
      }, h("h3", {}, s.fictional ? "🎲 " : "", s.title), h("p", {}, s.description))))),

    h("section", { class: "panel" },
      guide.scenario.fictional
        ? h("div", { class: "fiction-banner" }, "◆ FICTIONAL SIMULATION — a training game, not real-world guidance")
        : h("div", { class: "alert teal" }, icon("info"), h("div", {}, h("strong", {}, "Real-world guidance. "), "If anyone's life is at risk, call emergency services first — 000 in Australia, 911 in the US, 112 in many countries.")),
      h("div", { class: "grid-2", style: { marginTop: "14px" } },
        h("div", {},
          h("div", { class: "eyebrow", style: { marginBottom: "8px" } }, "1 · Triage — answer these first"),
          h("ol", { style: { margin: 0, paddingLeft: "18px" } }, guide.triage_questions.map((q) => h("li", { style: { margin: "4px 0" } }, q)))),
        h("div", {},
          h("div", { class: "eyebrow", style: { marginBottom: "8px" } }, "2 · Your household's situation"),
          h("div", { class: "ctx-card" },
            kv("People", `${hh.adults} adults · ${hh.children} children${hh.pets.length ? " · " + hh.pets.map((p) => `${p.count} ${p.kind}`).join(", ") : ""}`),
            kv("Water on hand", hh.water_days_available != null ? `${fmt(hh.water_days_available)} days` : "unknown"),
            kv("Food on hand", hh.food_days_available != null ? `${fmt(hh.food_days_available)} days` : "unknown"),
            kv("Lighting", hh.lighting.join(", ") || "none recorded"),
            kv("Radio", hh.radio.join(", ") || "none recorded"),
            kv("Power", hh.power.join(", ") || "none recorded"),
            hh.needs_medication ? kv("Medication", "regular — protect supply") : null,
            hh.unavailable_equipment.length ? kv("Unavailable", hh.unavailable_equipment.join(", ")) : null))),
      h("div", { class: "form-row", style: { marginTop: "14px" } },
        h("button", { class: "btn primary", onclick: () => sendChat(ASK[sel]) }, "Ask Prometheus for a response plan"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, "Prometheus reads this guide, your profile and inventory via tools, then proposes a plan for you to approve."))),

    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "3 · Guideline steps"), h("div", { class: "right" }, h("span", { class: "badge" }, "offline · curated"))),
      h("ul", { class: "steps" }, guide.guideline_steps.map((s) => h("li", {},
        h("span", { class: `badge ${s.priority === "immediate" ? "red" : s.priority === "today" ? "amber" : ""}` }, s.priority),
        h("div", {}, h("div", { class: "text" }, s.text), refs(s.knowledge_refs, navigate)))))),

    plansPanel(state, refresh, navigate),
  );
}

function plansPanel(state, refresh, navigate) {
  const plans = state.plans;
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Saved response plans")),
    plans.length ? plans.map((p) => {
      const done = p.steps.filter((s) => s.done).length;
      return h("div", { class: "ctx-card", style: { marginBottom: "10px" } },
        h("div", { class: "panel-head", style: { marginBottom: "6px" } },
          p.fictional ? h("span", { class: "badge violet" }, "fiction") : h("span", { class: "badge teal" }, "real-world"),
          h("h3", {}, p.title),
          h("div", { class: "right" }, h("span", { class: "badge" }, `${done}/${p.steps.length} done`),
            h("button", { class: "btn ghost sm", "aria-label": "Delete plan", onclick: async () => { await api.del(`/plans/${p.id}`); refresh(); } }, icon("trash")))),
        p.summary ? h("p", { class: "muted", style: { marginTop: 0 } }, p.summary) : null,
        h("ul", { class: "steps" }, p.steps.map((s, i) => h("li", { class: s.done ? "done" : "" },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.done, "aria-label": s.text,
            onchange: async (e) => { try { await api.patch(`/plans/${p.id}/steps/${i}`, { done: e.target.checked }); await refresh(); } catch (err) { toast(err.message, true); } } })),
          h("span", { class: `badge ${s.priority === "immediate" ? "red" : s.priority === "today" ? "amber" : ""}` }, s.priority),
          h("div", {}, h("div", { class: "text" }, s.text), refs(s.knowledge_refs || [], navigate))))));
    }) : h("div", { class: "empty" }, "No saved plans yet. Ask Prometheus for a response plan, then approve it."));
}

function refs(ids, navigate) {
  if (!ids?.length) return null;
  return h("div", { class: "refs" }, ids.map((id) => h("button", { class: "ref-link", onclick: () => navigate("vault", { entry: id }) }, `📖 ${id.replace(/^kb-/, "")}`)));
}

function kv(k, v) {
  return h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));
}
