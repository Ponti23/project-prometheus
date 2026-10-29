import { api } from "../api.js";
import { clear, h, icon, toast } from "../ui.js";

export async function renderSettings(root, { state, refresh }) {
  const [notes, log, sources] = await Promise.all([api.get("/memory"), api.get("/toollog"), api.get("/sources")]);
  const ai = state.status.ai;
  const verifyOut = h("pre", { class: "mono", style: { display: "none", background: "var(--bg)", padding: "10px", borderRadius: "8px", fontSize: "12px", whiteSpace: "pre-wrap" } });
  const newNote = h("input", { type: "text", placeholder: "Something Prometheus should remember…" });

  clear(root,
    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "AI connection")),
      kv("Mode", ai.configured ? "Cloud inference" : "Unavailable — offline data only"),
      kv("Provider", ai.provider),
      kv("Model", ai.model),
      kv("Endpoint", ai.base_url),
      kv("Local AI (llama.cpp)", "Planned — not part of this build"),
      h("div", { class: "form-row", style: { marginTop: "10px" } },
        h("button", { class: "btn", disabled: !ai.configured, onclick: async (e) => {
          e.target.disabled = true;
          try { const out = await api.get("/ai/verify"); verifyOut.style.display = "block"; verifyOut.textContent = JSON.stringify(out, null, 2); }
          catch (err) { toast(err.message, true); }
          e.target.disabled = false;
        } }, "Verify live connection to Nebius"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, ai.configured ? "Calls GET /v1/models with your key." : "Set NEBIUS_API_KEY in .env and restart.")),
      verifyOut),

    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Memory"), h("div", { class: "right" }, h("span", { class: "badge" }, `${notes.length} notes`))),
      h("p", { class: "muted", style: { marginTop: 0, fontSize: "13px" } },
        "Notes Prometheus saves are marked ", h("span", { class: "badge amber" }, "suggested"), " until you confirm them. Your household profile and inventory are always editable in Prepare."),
      notes.length ? h("ul", { class: "mini-list" }, notes.map((n) => noteRow(n, refresh, () => renderSettings(root, { state, refresh })))) : h("div", { class: "empty" }, "No memory notes yet."),
      h("form", { class: "form-row", style: { marginTop: "10px" }, onsubmit: async (e) => {
        e.preventDefault();
        if (!newNote.value.trim()) return;
        await api.post("/memory", { text: newNote.value.trim() });
        renderSettings(root, { state, refresh });
      } }, h("label", { class: "field", style: { flex: "1 1 260px" } }, newNote), h("button", { class: "btn sm", type: "submit" }, icon("plus"), "Add note"))),

    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Data")),
      h("p", { class: "muted", style: { marginTop: 0, fontSize: "13px" } }, "Your data is stored in a local SQLite file on the Prometheus server and tied to this browser. Demo data is synthetic."),
      h("div", { class: "form-row" },
        h("button", { class: "btn", onclick: async () => { await api.post("/household/demo"); toast("Demo household loaded"); await refresh({ chat: true }); } }, "Load demo household"),
        h("button", { class: "btn", onclick: async () => { await api.del("/chat/history"); toast("Conversation cleared"); await refresh({ chat: true }); } }, "Clear conversation"),
        h("button", { class: "btn danger", onclick: async () => {
          if (!confirm("Delete this household's profile, inventory, tasks, plans, memory and conversation?")) return;
          await api.post("/household/reset"); toast("Household reset"); await refresh({ chat: true });
        } }, "Reset household"))),

    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Tool call log (technical proof)"), h("div", { class: "right" }, h("span", { class: "badge" }, `last ${log.length}`))),
      log.length ? h("div", { style: { overflowX: "auto" } }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, ["Time (UTC)", "Tool", "OK", "Effect", "Arguments"].map((t) => h("th", {}, t)))),
        h("tbody", {}, log.map((r) => h("tr", {},
          h("td", { class: "num" }, r.created_at.replace("T", " ").slice(0, 19)),
          h("td", { class: "mono" }, r.tool),
          h("td", {}, r.ok ? "✓" : "✕"),
          h("td", {}, h("span", { class: `badge ${r.effect === "state_changed_after_approval" ? "teal" : r.effect === "pending_action" ? "amber" : ""}` }, r.effect)),
          h("td", { class: "mono", style: { fontSize: "11px", minWidth: "220px", maxWidth: "360px", wordBreak: "break-word" }, title: JSON.stringify(r.args) }, shortArgs(r.args))))))) :
        h("div", { class: "empty" }, "No tool calls yet.")),

    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Source registry"), h("div", { class: "right" }, h("span", { class: "badge" }, `${sources.length} sources`))),
      h("p", { class: "muted", style: { marginTop: 0, fontSize: "13px" } }, "Prometheus may only cite these. 'checked' means a link check (scripts/check_sources.py) confirmed it resolves."),
      h("ul", { class: "mini-list" }, sources.map((s) => h("li", {},
        h("span", { class: "ico", title: s.checked ? "link checked" : "not yet checked" }, s.checked ? "✓" : "○"),
        h("span", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title), h("span", { class: "faint" }, ` · ${s.publisher}`)))))),
  );
}

function noteRow(n, refresh, rerender) {
  return h("li", {},
    h("span", { class: `badge ${n.status === "confirmed" ? "teal" : "amber"}` }, n.status),
    h("span", { style: { flex: 1 } }, n.text, h("span", { class: "faint" }, ` · from ${n.source}`)),
    n.status === "suggested" ? h("button", { class: "btn sm", onclick: async () => { await api.post(`/memory/${n.id}/confirm`); rerender(); } }, "Confirm") : null,
    h("button", { class: "btn ghost sm", onclick: async () => {
      const text = prompt("Edit memory note", n.text);
      if (text && text.trim()) { await api.patch(`/memory/${n.id}`, { text: text.trim() }); rerender(); }
    } }, "Edit"),
    h("button", { class: "btn ghost sm", "aria-label": "Delete note", onclick: async () => { await api.del(`/memory/${n.id}`); rerender(); } }, icon("trash")));
}

// Plan and task proposals carry long arguments; show a preview and keep the full JSON in the tooltip.
function shortArgs(args) {
  const s = JSON.stringify(args);
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}

function kv(k, v) {
  return h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));
}
