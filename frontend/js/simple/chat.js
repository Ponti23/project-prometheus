// Simple-mode chat: short copy, approvals as Save / No. Advanced keeps the full trace and tool log.
import { api } from "../api.js";
import { flashFace, setFaceBase } from "../face.js";
import { clear, h, icon, markdown, toast } from "../ui.js";
import { announce, app, qty } from "./app.js";

const $ = (id) => document.getElementById(id);
const log = $("chatLog"), form = $("chatForm"), input = $("chatInput"), sendBtn = $("sendBtn");
const stateEl = $("chatState"), suggestionsEl = $("suggestions"), chatEl = $("chat");

const SUGGEST = {
  prepare: ["I bought 5 L of water", "What should I get next?", "Our old torch is broken"],
  survive: ["The power is out. What do we do?", "How long is fridge food safe?"],
  rebuild: ["Teach me how electricity works", "What should I learn first?"],
  vault: ["How do I make water safe to drink?", "Can I run a generator in the garage?"],
};
const BUSY = {
  prepare: "Checking your supplies…", survive: "Checking your plan…", rebuild: "Finding your lesson…", vault: "Searching the guides…",
};

let busy = false;

export function initChat() {
  form.addEventListener("submit", (e) => { e.preventDefault(); sendChat(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(input.value); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
    if (!busy && input.value.trim()) flashFace(["listening", 1800]);
  });
  // Phone: the chat is a bar that pulls up into a sheet.
  const handle = $("sheetHandle");
  const setOpen = (open) => {
    chatEl.classList.toggle("open", open);
    handle.setAttribute("aria-expanded", String(open));
    handle.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) log.scrollTop = log.scrollHeight;
  };
  handle.addEventListener("click", () => setOpen(!chatEl.classList.contains("open")));
  log.addEventListener("click", (e) => { if (!chatEl.classList.contains("open") && !e.target.closest("button, a")) setOpen(true); });
  let y0 = null;
  handle.addEventListener("touchstart", (e) => (y0 = e.touches[0].clientY), { passive: true });
  handle.addEventListener("touchend", (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dy) > 30) setOpen(dy < 0);
    y0 = null;
  });
  idle();
}

export function setSuggestions(name) {
  clear(suggestionsEl, (SUGGEST[name] || []).map((s) => h("button", { class: "suggestion", type: "button", onclick: () => sendChat(s) }, s)));
}

function idle() {
  const on = app.status?.ai.configured;
  stateEl.textContent = on ? "" : "Chat is off";
  setFaceBase(on ? "idle" : "sleeping");
}

function setBusy(on) {
  busy = on;
  sendBtn.disabled = on;
  if (on) { stateEl.textContent = BUSY[app.canvasName] || "Thinking…"; setFaceBase("thinking"); }
  else idle();
}

function welcome() {
  const on = app.status?.ai.configured;
  return h("div", { class: "msg assistant" }, h("div", { class: "bubble" },
    on ? h("p", {}, "Hi, I'm Prometheus. Tell me what you have, or what's happening.")
       : h("p", {}, "Chat is off right now (no AI connected). Your cards, plans and guides still work.")));
}

export async function renderChat() {
  let history = [];
  try { history = await api.get("/chat/history"); } catch (e) { toast(e.message, true); }
  clear(log, welcome(), history.map(messageEl));
  if (!busy) idle();
  log.scrollTop = log.scrollHeight;
}

function messageEl(m) {
  if (m.role === "user") return h("div", { class: "msg user" }, m.content);
  if (m.role === "event") {
    const a = app.data.actions.find((x) => x.id === m.meta?.action_id);
    const ok = m.meta?.approved;
    return h("div", { class: `msg event ${ok ? "ok" : ""}` }, icon(ok ? "check" : "x"), ok ? "Saved: " : "Not saved: ", a ? describe(a) : "a change");
  }
  if (m.role === "error") return h("div", { class: "msg error" }, icon("warn"), "Chat isn't working right now. Your cards still do.");
  if (m.role !== "assistant" || !m.content || m.meta?.draft || !m.meta?.trace) return null;
  const actions = (m.meta.actions || []).map((id) => app.data.actions.find((a) => a.id === id)).filter(Boolean);
  return h("div", { class: "msg assistant" },
    h("div", { class: "bubble", html: markdown(m.content) }),
    m.meta.sources?.length ? h("div", { class: "sources", "aria-label": "Sources" },
      icon("book"), m.meta.sources.map((s) => h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", title: s.publisher }, s.title))) : null,
    actions.map(actionEl));
}

function actionEl(a) {
  const pending = a.status === "pending";
  const done = { approved: ["check", "Saved"], rejected: ["x", "Not saved"], failed: ["warn", "Couldn't save"] }[a.status];
  return h("div", { class: `proposal ${a.status}`, "data-action": a.id },
    h("div", { class: "what" }, icon(pending ? "pencil" : done[0]), h("span", {}, describe(a))),
    a.kind === "save_approved_tasks" ? h("ul", {}, a.payload.tasks.map((t) => h("li", {}, t.title))) : null,
    a.kind === "create_plan" ? h("ol", {}, a.payload.steps.map((s) => h("li", {}, s.text))) : null,
    pending
      ? h("div", { class: "row" },
          h("button", { class: "btn primary sm", type: "button", onclick: () => resolve(a, "approve") }, "Save"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => resolve(a, "reject") }, "No"))
      : h("div", { class: "done" }, done[1]));
}

// Proposals in plain words, built from the payload the server validated.
export function describe(a) {
  const p = a.payload || {};
  const item = (id) => app.data.inventory?.find((i) => i.id === id);
  if (a.kind === "add_inventory") return `Add ${qty(p.quantity, p.unit)} ${p.name}`;
  if (a.kind === "update_inventory") {
    const it = item(p.item_id), ch = p.changes || {}, parts = [];
    if (ch.quantity != null) parts.push(`set to ${qty(ch.quantity, ch.unit || it?.unit)}`);
    if (ch.status === "unavailable") parts.push("broken or used up");
    if (ch.status === "ok") parts.push("working again");
    if (ch.kcal_per_unit != null) parts.push(`${qty(ch.kcal_per_unit)} kcal each`);
    if (ch.expires_on) parts.push(`use by ${ch.expires_on}`);
    if (ch.name) parts.push(`rename to ${ch.name}`);
    return `${it?.name || "Item"}: ${parts.join(", ") || "update"}`;
  }
  if (a.kind === "save_approved_tasks") return `Add ${p.tasks.length} thing${p.tasks.length === 1 ? "" : "s"} to your list`;
  if (a.kind === "create_plan") return `Save the plan "${p.title}"`;
  if (a.kind === "update_profile") {
    const words = { adults: "adults", children: "children", duration_days: "goal (days)", needs_medication: "daily medicine", hot_climate: "hot climate", pets: "pets", name: "name" };
    return "Household: " + Object.entries(p).map(([k, v]) => `${words[k] || k.replace(/_/g, " ")} ${fmtVal(v)}`).join(", ");
  }
  return a.summary;
}

function fmtVal(v) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? `${x.count} ${x.kind}` : x)).join(", ") || "none";
  return String(v);
}

export async function resolve(a, verb) {
  try {
    await api.post(`/actions/${a.id}/${verb}`);
    flashFace(verb === "approve" ? ["glee", 1600] : ["sad", 1400]);
    announce(verb === "approve" ? `Saved: ${describe(a)}` : "Not saved");
    await app.refresh({ ripple: verb === "approve" });
    await renderChat();
    return true;
  } catch (e) {
    flashFace(["error", 2000]);
    toast(e.message, true);
    return false;
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
  setBusy(true);
  try {
    const out = await api.post("/chat", { message: text, mode: app.canvasName, ...app.chatContext() });
    await app.refresh();
    setBusy(false);
    await renderChat();
    await app.applyHints(out.ui_hints || [], out.actions || [], text);
    flashFace(["speaking", 1400], [out.actions?.length ? "wink" : "happy", 1400]);
  } catch (e) {
    typing.remove();
    setBusy(false);
    log.appendChild(h("div", { class: "msg error" }, icon("warn"),
      e.status === 503 ? "Chat is off right now. Your cards still work." : e.status === 429 ? e.message : "Chat isn't working right now. Your cards still do."));
    log.scrollTop = log.scrollHeight;
    flashFace(["error", 2000], ["sad", 1400]);
  }
}
