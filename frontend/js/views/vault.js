import { api } from "../api.js";
import { clear, h } from "../ui.js";

const SAFETY = { general: ["", "general"], caution: ["amber", "caution"], seek_help: ["red", "get professional help"] };

export async function renderVault(root, { state, sendChat }) {
  const v = state.view;
  const params = new URLSearchParams();
  if (v.q) params.set("q", v.q);
  if (v.topic) params.set("topic", v.topic);
  const data = await api.get(`/knowledge?${params}`);
  let results = data.results;
  if (v.entry) {
    const focus = results.find((r) => r.id === v.entry) || (await api.get(`/knowledge/${v.entry}`));
    results = [focus, ...results.filter((r) => r.id !== v.entry)];
  }

  const rerender = () => renderVault(root, { state, sendChat });
  const search = h("input", { type: "search", placeholder: "Search the vault — e.g. boil water, generator, fridge…", value: v.q || "", "aria-label": "Search knowledge" });
  clear(root,
    h("section", { class: "panel" },
      h("form", { class: "form-row", onsubmit: (e) => { e.preventDefault(); v.q = search.value.trim(); v.entry = null; rerender(); } },
        h("label", { class: "field", style: { flex: "1 1 300px" } }, search),
        h("button", { class: "btn primary", type: "submit" }, "Search"),
        v.q || v.topic || v.entry ? h("button", { class: "btn ghost", type: "button", onclick: () => { v.q = v.topic = v.entry = null; rerender(); } }, "Clear") : null),
      h("div", { class: "topic-chips", style: { marginTop: "10px" } }, data.topics.map((t) => h("button", {
        class: "topic-chip", "aria-pressed": String(v.topic === t), onclick: () => { v.topic = v.topic === t ? null : t; v.entry = null; rerender(); },
      }, t))),
      h("p", { class: "faint", style: { fontSize: "12px", marginBottom: 0 } },
        `${results.length} entries · stored locally and readable offline. Each entry links to its original source — always follow local emergency services first.`)),
    results.length ? h("div", { class: "grid-2", style: { marginTop: "14px" } }, results.map((e) => card(e, e.id === v.entry, sendChat)))
      : h("div", { class: "empty" }, "Nothing in the vault matches that. Try different words."));
  if (v.entry) root.scrollTop = 0;
}

function card(e, focused, sendChat) {
  const [cls, label] = SAFETY[e.safety] || SAFETY.general;
  return h("article", { class: "panel kb-card", style: { marginTop: 0, ...(focused ? { borderColor: "var(--teal)" } : {}) } },
    h("div", { class: "panel-head", style: { marginBottom: "6px" } },
      h("span", { class: "badge" }, e.topic), h("span", { class: `badge ${cls}` }, label)),
    h("h3", {}, e.title),
    h("p", { class: "muted", style: { margin: "6px 0" } }, e.summary),
    h("ul", {}, (e.points || []).map((p) => h("li", {}, p))),
    h("div", { class: "sources" }, h("span", { class: "eyebrow" }, "Sources"),
      e.sources.map((s) => h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, `↗ ${s.title} — ${s.publisher}`))),
    h("div", { style: { marginTop: "10px" } }, h("button", { class: "btn sm", onclick: () => sendChat(`Explain "${e.title}" for my household.`) }, "Ask Prometheus about this")));
}
