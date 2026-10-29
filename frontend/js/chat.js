import { api } from "./api.js";
import { flashFace } from "./face.js";
import { clear, h, markdown, setEmblemState, toast } from "./ui.js";

const log = document.getElementById("chatLog");
const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const stateEl = document.getElementById("chatState");
const suggestionsEl = document.getElementById("suggestions");
const hoodBtn = document.getElementById("hoodToggle");

let app = null; // { state, refresh, navigate }
let busy = false;
let showHood = false;

export function initChat(ctx) {
  app = ctx;
  try { showHood = localStorage.getItem("prometheus.hood") === "1"; } catch { /* ignore */ }
  updateHoodBtn();
  form.addEventListener("submit", (e) => { e.preventDefault(); sendChat(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(input.value); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px";
    if (!busy && input.value.trim()) flashFace(["listening", 1800]);
  });
  hoodBtn.addEventListener("click", () => {
    showHood = !showHood;
    try { localStorage.setItem("prometheus.hood", showHood ? "1" : "0"); } catch { /* ignore */ }
    updateHoodBtn();
    renderChat();
  });
}

function updateHoodBtn() {
  hoodBtn.textContent = `Under the hood: ${showHood ? "on" : "off"}`;
  hoodBtn.setAttribute("aria-pressed", String(showHood));
}

export function setSuggestions(list) {
  clear(suggestionsEl, list.map((s) => h("button", { class: "suggestion", type: "button", onclick: () => sendChat(s) }, s)));
}

function setBusy(on, label = "Thinking…", emblem = "thinking") {
  busy = on;
  sendBtn.disabled = on;
  stateEl.textContent = on ? label : app.state.status?.ai.configured ? "Standing by · cloud AI configured" : "Cloud AI unavailable · offline data only";
  setEmblemState(on ? emblem : app.state.status?.ai.configured ? "idle" : "offline");
}

// The AI chip only claims "live" after a real reply; it names the model the API reported back.
function markLive(step) {
  const chip = document.getElementById("aiChip");
  chip.className = "chip ok";
  chip.title = `Last reply: model ${step.model}, response id ${step.response_id}, via ${step.provider}`;
  clear(chip, h("span", { class: "dot" }), h("span", {}, `Cloud AI live · ${step.model.split("/").pop()}`));
}

function welcome() {
  const ai = app.state.status?.ai;
  return h("div", { class: "msg assistant" },
    h("div", { class: "bubble" },
      h("p", {}, h("strong", {}, "Prometheus is online."), " I'm your scientific companion for preparing, surviving and rebuilding."),
      h("p", {}, "Tell me about your household, ask what you're missing, describe an emergency, or ask me to teach you how to restore electricity. I'll use your saved data and the offline knowledge vault, and I'll ask before changing anything."),
      ai?.configured
        ? h("p", { class: "muted" }, `Cloud inference: ${ai.model} via ${ai.provider}.`)
        : h("div", { class: "alert amber" }, "Cloud AI is not configured (no NEBIUS_API_KEY). Chat is unavailable, but inventory, plans, the knowledge vault and the tech tree all work offline."),
      h("p", { class: "faint", style: { fontSize: "11.5px" } }, "This greeting is part of the app, not a model response.")));
}

export async function renderChat() {
  let history = [];
  try { history = await api.get("/chat/history"); } catch (e) { toast(e.message, true); }
  const actions = Object.fromEntries((app.state.actions || []).map((a) => [a.id, a]));
  clear(log, welcome(), history.map((m) => messageEl(m, actions)));
  const lastLive = [...history].reverse().find((m) => m.role === "assistant" && m.meta?.trace?.length);
  if (lastLive) markLive(lastLive.meta.trace.at(-1));
  setBusy(false);
  log.scrollTop = log.scrollHeight;
}

function messageEl(m, actions) {
  if (m.role === "user") return h("div", { class: "msg user" }, m.content);
  if (m.role === "event") return h("div", { class: "msg event" }, "● ", m.content.replace(/ proposal [0-9a-f]+ \([a-z_]+\)/, ""));
  if (m.role === "error") return h("div", { class: "msg error" }, "⚠ AI unavailable: ", m.content);
  if (m.role !== "assistant") return null;
  // Intermediate assistant messages that only carried tool calls are summarised in the final message trace.
  if (!m.meta?.trace && !m.content) return null;
  if (!m.meta?.trace) return m.content ? h("div", { class: "msg assistant" }, h("div", { class: "bubble", html: markdown(m.content) })) : null;
  const trace = m.meta.trace;
  const calls = trace.flatMap((s) => s.tool_calls);
  return h("div", { class: "msg assistant" },
    h("div", { class: "bubble", html: markdown(m.content) }),
    calls.length ? h("div", { class: "tools-used", "aria-label": "Tools used" },
      calls.map((c) => h("span", { class: `tool-pill ${c.kind}${c.ok ? "" : " fail"}`, title: c.ok ? c.effect : "failed" }, c.name))) : null,
    (m.meta.actions || []).map((id) => actions[id] && actionCard(actions[id])),
    showHood ? hood(trace) : null);
}

function hood(trace) {
  const first = trace[0] || {};
  const tokens = trace.reduce((n, s) => n + (s.usage?.total_tokens || 0), 0);
  const latency = trace.reduce((n, s) => n + (s.latency_ms || 0), 0);
  const summary = `${first.provider} · ${first.model} · ${trace.length} call(s) · ${latency} ms · ${tokens} tokens`;
  return h("details", { class: "hood", open: true },
    h("summary", {}, summary),
    h("pre", {}, JSON.stringify(trace.map((s) => ({
      round: s.round, model: s.model, response_id: s.response_id, latency_ms: s.latency_ms, usage: s.usage,
      finish_reason: s.finish_reason,
      tool_calls: s.tool_calls.map((c) => ({ name: c.name, kind: c.kind, ok: c.ok, effect: c.effect, arguments: c.arguments, action_id: c.action_id, result: c.result_preview })),
    })), null, 2)));
}

function actionCard(a) {
  const tasks = a.kind === "save_approved_tasks" ? a.payload.tasks : null;
  const steps = a.kind === "create_plan" ? a.payload.steps : null;
  const resolved = a.status !== "pending";
  const statusText = { approved: "✓ Approved — saved", rejected: "✕ Rejected — nothing changed", failed: "⚠ Failed to apply" }[a.status];
  return h("div", { class: "action-card" + (resolved ? " resolved" : "") },
    h("div", { class: "label" }, resolved ? statusText : "◆ Proposal — needs your approval"),
    h("div", { class: "summary" }, a.summary),
    tasks ? h("ul", {}, tasks.map((t) => h("li", {}, t.title))) : null,
    steps ? h("ul", {}, steps.map((s) => h("li", {}, `[${s.priority}] ${s.text}`))) : null,
    resolved ? null : h("div", { class: "row" },
      h("button", { class: "btn primary sm", onclick: () => resolve(a, "approve") }, "✓ Approve"),
      h("button", { class: "btn sm", onclick: () => resolve(a, "reject") }, "✕ Reject")));
}

async function resolve(a, verb) {
  try {
    await api.post(`/actions/${a.id}/${verb}`);
    toast(verb === "approve" ? "Approved — saved to your household" : "Rejected — nothing changed");
    flashFace(verb === "approve" ? ["glee", 1800] : ["sad", 1600]);
    await app.refresh({ chat: true });
  } catch (e) {
    flashFace(["error", 2000]);
    toast(e.message, true);
  }
}

export async function sendChat(text) {
  text = (text || "").trim();
  if (!text || busy) return;
  input.value = "";
  input.style.height = "auto";
  log.appendChild(h("div", { class: "msg user" }, text));
  const typing = h("div", { class: "msg assistant" }, h("div", { class: "bubble typing", "aria-label": "Prometheus is thinking" }, h("span"), h("span"), h("span")));
  log.appendChild(typing);
  log.scrollTop = log.scrollHeight;
  setBusy(true, "Thinking with Nemotron… (reading your data via tools)");
  try {
    const out = await api.post("/chat", { message: text, mode: app.state.mode });
    for (const hint of out.ui_hints || []) {
      if (hint.open) app.navigate(hint.open, hint.node ? { node: hint.node } : hint.scenario ? { scenario: hint.scenario } : {});
    }
    await app.refresh({ chat: true });
    // Proposals waiting on the user get a wink; otherwise a plain happy finish.
    flashFace(["speaking", 1600], [out.actions?.length ? "wink" : "happy", 1600]);
  } catch (e) {
    typing.remove();
    log.appendChild(h("div", { class: "msg error" }, "⚠ ", e.message));
    setBusy(false);
    flashFace(["error", 2200], ["sad", 1600]);
    if (e.status === 0) toast(e.message, true);
  }
}
