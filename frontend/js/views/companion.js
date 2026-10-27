import { api } from "../api.js";
import { clear, emblemSvg, h, hydrateIcons, pct, toast } from "../ui.js";

export function renderCompanion(root, { state, refresh, navigate, sendChat }) {
  const { household, readiness, tasks, plans } = state;
  const open = tasks.filter((t) => t.status === "open").length;
  const plan = plans[0];
  const big = h("div", { class: "emblem lg", "data-state": state.status?.ai.configured ? "idle" : "offline", html: emblemSvg() });

  clear(root,
    h("div", { class: "hero" }, big,
      h("div", {},
        h("div", { class: "eyebrow" }, "Humanity's backup brain"),
        h("h2", {}, household.confirmed ? `Welcome back, ${household.profile.name}.` : "Hello. I'm Prometheus."),
        h("div", { class: "tagline" }, "PREPARE TODAY · SURVIVE TOMORROW · REBUILD THE FUTURE"),
        h("p", { class: "muted", style: { maxWidth: "620px" } },
          "I remember your household, track your supplies and plans, explain the science, and ask before I change anything. ",
          "Every number I give you comes from a calculation or a cited source, not a guess."))),

    !household.confirmed ? h("div", { class: "panel", style: { marginTop: "14px" } },
      h("div", { class: "panel-head" }, h("h2", {}, "Get started")),
      h("p", { class: "muted", style: { marginTop: 0 } }, "Tell me about your household in the chat, fill in the profile in Prepare, or load a synthetic demo household."),
      h("div", { class: "form-row" },
        h("button", { class: "btn primary", onclick: () => sendChat("Hi Prometheus! I'm preparing a family of five for a 30-day emergency.") }, "Say hello to Prometheus"),
        h("button", { class: "btn", onclick: () => navigate("prepare") }, "Set up household profile"),
        h("button", { class: "btn", onclick: async () => { await api.post("/household/demo"); toast("Demo household loaded"); await refresh({ chat: true }); } }, "Load demo household"))) : null,

    h("div", { class: "grid-3", style: { marginTop: "14px" } },
      modeCard("box", "Prepare", pct(readiness.overall_coverage), "coverage of planning targets", `${readiness.missing.length} shortfalls · ${open} open tasks`, () => navigate("prepare")),
      modeCard("shield", "Survive", plan ? `${plan.steps.filter((s) => s.done).length}/${plan.steps.length}` : "—", plan ? `steps done · ${plan.title}` : "no saved plan yet", "Extended blackout scenario ready", () => navigate("survive")),
      modeCard("bolt", "Rebuild", String(state.tree?.nodes.length || 0), "nodes in the electricity tree", household.topic ? `Current topic: ${state.tree.nodes.find((n) => n.id === household.topic)?.title}` : "Start with Energy & power", () => navigate("rebuild"))),

    h("div", { class: "panel", style: { marginTop: "14px" } },
      h("div", { class: "panel-head" }, h("h2", {}, "How Prometheus stays honest")),
      h("div", { class: "grid-3" },
        principle("Real tools", "I read your saved household, inventory and plans through validated tool calls — shown as pills under each reply."),
        principle("You approve changes", "Anything that changes your data is a proposal card. Nothing is saved until you click Approve."),
        principle("Sourced, offline-ready", "Guidance comes from a curated vault with linked sources. Data views work without internet; AI chat needs the cloud."))),
  );
  hydrateIcons(root);
}

function modeCard(ic, title, num, label, foot, onclick) {
  return h("div", { class: "panel mode-card", role: "button", tabindex: "0", onclick, onkeydown: (e) => e.key === "Enter" && onclick() },
    h("div", { class: "panel-head" }, h("span", { "data-icon": ic }), h("h3", {}, title)),
    h("div", { class: "num" }, num),
    h("div", { class: "muted" }, label),
    h("div", { class: "faint", style: { marginTop: "8px", fontSize: "12px" } }, foot));
}

function principle(title, text) {
  return h("div", {}, h("div", { style: { fontWeight: 600, marginBottom: "4px" } }, title), h("div", { class: "muted", style: { fontSize: "13px" } }, text));
}
