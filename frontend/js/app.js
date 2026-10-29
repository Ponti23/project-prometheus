import { api } from "./api.js";
import { initChat, renderChat, sendChat, setSuggestions } from "./chat.js";
import { clear, fmt, h, hydrateIcons, pct, setEmblemState, toast } from "./ui.js";
import { renderCompanion } from "./views/companion.js";
import { renderPrepare } from "./views/prepare.js";
import { renderRebuild } from "./views/rebuild.js";
import { renderSettings } from "./views/settings.js";
import { renderSurvive } from "./views/survive.js";
import { renderVault } from "./views/vault.js";

export const MODES = {
  companion: {
    title: "Companion", subtitle: "Prepare today. Survive tomorrow. Rebuild the future.", render: renderCompanion,
    suggestions: ["Hi Prometheus! I'm preparing a family of five for a 30-day emergency.", "What can you help me with?", "What do you know about my household?"],
  },
  prepare: {
    title: "Prepare", subtitle: "Household profile, survival kit targets, inventory and restocking", render: renderPrepare,
    suggestions: ["How ready are we for 30 days?", "What are we short of? Propose restock tasks.", "Our old torch is broken — mark it unavailable."],
  },
  survive: {
    title: "Survive", subtitle: "Scenario guidance, triage and a trackable response plan", render: renderSurvive,
    suggestions: ["The power grid has collapsed. We don't have electricity anymore. What should we do?", "How long will the food in our fridge stay safe?", "Run a zombie apocalypse drill (fictional simulation)."],
  },
  rebuild: {
    title: "Rebuild", subtitle: "Civilisation technology tree — restoring electricity", render: renderRebuild,
    suggestions: ["Prometheus, can you teach me how electricity works so we can eventually restore power?", "What must I learn before solar power?", "What equipment do we already have for an off-grid setup?"],
  },
  vault: {
    title: "Knowledge Vault", subtitle: "Curated, source-attributed guidance — available offline", render: renderVault,
    suggestions: ["How do I make water safe to drink?", "Is it safe to run a generator in the garage?"],
  },
  settings: {
    title: "Settings", subtitle: "AI connection, memory, data and technical proof", render: renderSettings,
    suggestions: ["What do you remember about us?"],
  },
};

export const state = {
  mode: "companion",
  status: null,
  household: null,
  readiness: null,
  tasks: [],
  actions: [],
  plans: [],
  tree: null,
  view: {}, // per-view UI state (selected node, scenario, etc.)
};

const workspace = document.getElementById("workspace");
const contextEl = document.getElementById("context");

export async function refresh({ chat = false } = {}) {
  const [household, readiness, tasks, actions, plans] = await Promise.all([
    api.get("/household"), api.get("/readiness"), api.get("/tasks"), api.get("/actions"), api.get("/plans"),
  ]);
  Object.assign(state, { household, readiness, tasks, actions, plans });
  renderContext();
  renderView();
  if (chat) await renderChat();
}

export function navigate(mode, viewState = {}) {
  if (!MODES[mode]) return;
  state.mode = mode;
  Object.assign(state.view, viewState);
  document.querySelectorAll(".nav-btn").forEach((b) => b.setAttribute("aria-current", b.dataset.mode === mode ? "page" : "false"));
  document.getElementById("modeTitle").textContent = MODES[mode].title;
  document.getElementById("modeSubtitle").textContent = MODES[mode].subtitle;
  setSuggestions(MODES[mode].suggestions);
  try { localStorage.setItem("prometheus.mode", mode); } catch { /* storage unavailable */ }
  api.post("/context", { mode }).catch(() => {});
  renderView();
  workspace.scrollTop = 0;
}

export function renderView() {
  if (!state.household) return;
  const ctx = { state, refresh, navigate, sendChat };
  Promise.resolve(MODES[state.mode].render(workspace, ctx)).catch((e) => {
    clear(workspace, h("div", { class: "alert red" }, `Could not render view: ${e.message}`));
  });
}

function renderContext() {
  const { household, readiness, tasks, actions, plans } = state;
  const p = household.profile;
  const pending = actions.filter((a) => a.status === "pending");
  const open = tasks.filter((t) => t.status === "open");
  const shortages = readiness.missing.slice(0, 5);
  const plan = plans[0];
  const node = household.topic && state.tree?.nodes.find((n) => n.id === household.topic);

  clear(contextEl,
    section("Household", "home",
      h("div", { class: "ctx-card" },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" } },
          h("strong", {}, p.name),
          household.confirmed ? h("span", { class: "badge teal" }, "✓ confirmed") : h("span", { class: "badge amber" }, "default")),
        kv("People", `${p.adults} adults · ${p.children} children`),
        kv("Pets", p.pets.length ? p.pets.map((x) => `${x.count} ${x.kind}`).join(", ") : "none"),
        kv("Plan for", `${p.duration_days} days`),
        p.needs_medication ? kv("Medication", "regular") : null)),
    section("Resources & shortages", "water",
      h("div", { class: "ctx-card" },
        kv("Coverage of targets", pct(readiness.overall_coverage)),
        kv("Water on hand", readiness.supply_days.water != null ? `${fmt(readiness.supply_days.water)} days` : "—"),
        kv("Food on hand", readiness.supply_days.food != null ? `${fmt(readiness.supply_days.food)} days` : "—"),
        shortages.length
          ? h("ul", { class: "mini-list", style: { marginTop: "6px" } },
              shortages.map((s) => h("li", {}, h("span", { class: "ico", style: { color: s.status === "missing" ? "var(--red)" : "var(--amber)" } }, s.status === "missing" ? "✕" : "◐"),
                h("span", {}, `${s.label}: need ${fmt(s.shortfall, s.unit)} more`))))
          : h("div", { class: "muted", style: { marginTop: "6px" } }, "✓ All planning targets met"),
        readiness.expiring_soon.length ? h("div", { class: "badge amber", style: { marginTop: "6px" } }, `⚠ ${readiness.expiring_soon.length} expiring soon`) : null)),
    pending.length ? section(`Awaiting your approval (${pending.length})`, "warn",
      h("div", { class: "ctx-card" }, h("ul", { class: "mini-list" }, pending.map((a) => h("li", {}, h("span", { class: "ico", style: { color: "var(--amber)" } }, "◆"), a.summary))))) : null,
    section(`Active tasks (${open.length})`, "task",
      h("div", { class: "ctx-card" }, open.length
        ? h("ul", { class: "mini-list" }, open.slice(0, 6).map((t) => h("li", {}, h("span", { class: "ico" }, "☐"), t.title)))
        : h("div", { class: "muted" }, "No open tasks."))),
    plan ? section("Active plan", "shield",
      h("div", { class: "ctx-card", style: { cursor: "pointer" }, onclick: () => navigate("survive") },
        h("div", {}, plan.fictional ? h("span", { class: "badge violet" }, "fiction") : null, " ", h("strong", {}, plan.title)),
        kv("Progress", `${plan.steps.filter((s) => s.done).length} / ${plan.steps.length} steps`))) : null,
    section("Current science topic", "atom",
      h("div", { class: "ctx-card", style: node ? { cursor: "pointer" } : {}, onclick: node ? () => navigate("rebuild", { node: node.id }) : null },
        node ? [h("strong", {}, node.title), h("div", { class: "muted" }, node.summary)] : h("div", { class: "muted" }, "None yet — explore Rebuild."))),
  );
  hydrateIcons(contextEl);
}

function section(title, ic, ...body) {
  return h("div", { class: "ctx-section" }, h("div", { class: "eyebrow" }, h("span", { "data-icon": ic }), title), ...body);
}
function kv(k, v) {
  return h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));
}

export function setAiChip(status) {
  const chip = document.getElementById("aiChip");
  const ai = status.ai;
  chip.className = "chip " + (ai.configured ? "ok" : "warn");
  chip.title = ai.configured
    ? `Configured: ${ai.model} via ${ai.provider}. Not yet verified — send a message or use Settings → Verify.`
    : "No NEBIUS_API_KEY configured — chat is unavailable; data views work offline.";
  clear(chip, h("span", { class: "dot" }), h("span", {}, ai.configured ? "Cloud AI configured · Nebius" : "Cloud AI unavailable"));
  setEmblemState(ai.configured ? "idle" : "offline");
}

async function boot() {
  hydrateIcons();
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.mode)));
  const toggle = document.getElementById("ctxToggle");
  toggle.addEventListener("click", () => {
    const open = contextEl.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  try {
    state.status = await api.get("/status"); // creates the household cookie before parallel calls
    setAiChip(state.status);
    state.tree = await api.get("/techtree");
    let mode = "companion";
    try { mode = localStorage.getItem("prometheus.mode") || mode; } catch { /* ignore */ }
    initChat({ state, refresh, navigate });
    await refresh();
    navigate(MODES[mode] ? mode : "companion");
    await renderChat();
  } catch (e) {
    toast(e.message, true);
    clear(workspace, h("div", { class: "alert red" }, `Prometheus could not start: ${e.message}`));
  }
}

boot();
