// A one-page emergency card to print and stick on the fridge. Everything on it comes from your saved data.
import { api } from "../api.js";
import { h, toast } from "../ui.js";
import { app } from "./app.js";
import { EMERGENCY_NUMBERS, STEP_GROUPS } from "./cards/survive.js";

export async function printCard() {
  let guide;
  try { guide = await api.get("/scenarios/blackout"); } catch (e) { toast(e.message, true); return; }
  const p = app.data.household.profile;
  const s = app.data.summary;
  const plan = app.data.plans[0];
  const steps = plan ? plan.steps : guide.guideline_steps;
  const reached = s.stages.filter((x) => x.reached).at(-1);
  const days = (x) => (x == null ? "none recorded" : `${Math.round(x * 10) / 10} days`);
  const pets = p.pets.map((x) => `${x.count} ${x.kind}${x.count > 1 ? "s" : ""}`).join(", ");
  const card = h("div", { class: "print-card" },
    h("h1", {}, `Emergency card: ${p.name}`),
    h("p", { class: "call" }, `Life at risk? Call ${EMERGENCY_NUMBERS}`),
    h("h2", {}, "Who lives here"),
    h("ul", {},
      h("li", {}, `${p.adults} adults, ${p.children} children${pets ? `, ${pets}` : ""}`),
      p.needs_medication ? h("li", {}, "Someone takes medicine every day") : null,
      [...p.special_requirements, ...p.dietary_restrictions].map((x) => h("li", {}, x))),
    h("h2", {}, "What we have"),
    h("ul", {},
      h("li", {}, `Water: ${days(s.water_days)}`),
      h("li", {}, `Food: ${days(s.food_days)}`),
      h("li", {}, reached ? `Ready for ${reached.label}` : `Not yet ready for ${s.stages[0].label}`),
      guide.household.lighting.length ? h("li", {}, `Light: ${guide.household.lighting.join(", ")}`) : null,
      guide.household.radio.length ? h("li", {}, `Radio: ${guide.household.radio.join(", ")}`) : null),
    h("h2", {}, plan ? plan.title : "If the power goes out"),
    STEP_GROUPS.map(([prio, label]) => {
      const list = steps.filter((x) => x.priority === prio);
      return list.length ? [h("h3", {}, label), h("ol", {}, list.map((x) => h("li", {}, x.text)))] : null;
    }),
    h("p", { class: "foot" }, `Printed ${new Date().toLocaleDateString()} from Prometheus. Planning targets, not a safety guarantee.`));
  document.querySelectorAll(".print-card").forEach((x) => x.remove());
  document.body.appendChild(card);
  window.print();
}
