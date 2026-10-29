// Vault canvas: search the offline guides, and one card per guide with its sources. Plus memory, on any canvas.
import { api } from "../../api.js";
import { h, icon, toast } from "../../ui.js";
import { app, load } from "../app.js";
import { sendChat } from "../chat.js";
import { button, link, mini } from "./common.js";

const SAFETY = { caution: ["partial", "Careful"], seek_help: ["missing", "Get professional help"] };

function search(c) {
  const ui = c.ui;
  if (ui.filter !== undefined && ui.filter !== ui.lastFilter) { ui.q = ui.filter; ui.lastFilter = ui.filter; }
  const params = new URLSearchParams();
  if (ui.q) params.set("q", ui.q);
  if (ui.topic) params.set("topic", ui.topic);
  const data = load(`/knowledge?${params}`);
  const input = h("input", { type: "search", value: ui.q || "", placeholder: "Search the guides", "aria-label": "Search the guides" });
  return {
    icon: "search", title: "Guides", width: 340,
    body: [
      h("form", { class: "search-row", onsubmit: (e) => { e.preventDefault(); ui.q = input.value.trim(); input.blur(); app.canvas.paint(c); } },
        input, h("button", { class: "btn sm", type: "submit", "aria-label": "Search" }, icon("search"))),
      data ? h("div", { class: "chips" }, data.topics.map((t) => h("button", {
        type: "button", class: "chip", "aria-pressed": String(ui.topic === t),
        onclick: () => { ui.topic = ui.topic === t ? null : t; app.canvas.paint(c); },
      }, t.replace("-", " ")))) : null,
      !data ? h("p", { class: "muted" }, "Loading…")
        : data.results.length ? h("ul", { class: "results" }, data.results.slice(0, 8).map((e) => h("li", {},
            h("button", { type: "button", onclick: () => app.spawn("guide", e.id) }, h("strong", {}, e.title), h("span", {}, e.summary)))))
        : h("p", { class: "muted" }, "Nothing matches. Try other words."),
    ],
    mini: mini(ui.q ? `“${ui.q}”` : "Guides", data ? `${data.results.length} found` : ""),
  };
}

function guide(c) {
  const e = load(`/knowledge/${c.key}`);
  if (!e) return { icon: "book", title: "Guide", body: h("p", { class: "muted" }, "Loading…"), mini: mini("…") };
  const [st, word] = SAFETY[e.safety] || [];
  return {
    icon: "book", title: e.title, width: 360, status: st || "",
    body: [
      word ? h("span", { class: `pill ${st}` }, icon("warn"), word) : null,
      h("p", {}, e.summary),
      h("ul", { class: "plain" }, e.points.map((p) => h("li", {}, p))),
      h("p", { class: "source" }, icon("book"), " ", e.sources.map((s, i) => [i ? " · " : "",
        h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", title: s.publisher }, s.title)])),
      h("div", { class: "row" }, button("Ask Prometheus about this", () => sendChat(`Explain "${e.title}" for our household.`), "sm")),
    ],
    mini: mini(e.title),
  };
}

// Memory notes Prometheus saved stay "suggested" until you confirm them.
function memory(c) {
  const notes = load("/memory");
  if (!notes) return { icon: "spark", title: "Memory", body: h("p", { class: "muted" }, "Loading…"), mini: mini("…") };
  const act = async (fn) => { try { await fn(); delete app.cache["/memory"]; app.canvas.paint(c); } catch (e) { toast(e.message, true); } };
  const input = h("input", { type: "text", placeholder: "Something to remember", "aria-label": "New note" });
  return {
    icon: "spark", title: "Memory", width: 320, tag: `${notes.length} notes`,
    body: [
      notes.length ? h("ul", { class: "items" }, notes.map((n) => h("li", {},
        h("div", { class: "item-main" }, h("span", {}, n.text), n.status === "suggested" ? h("span", { class: "tag warn" }, "Suggested") : null),
        h("div", { class: "item-ctl" },
          n.status === "suggested" ? link("Keep it", () => act(() => api.post(`/memory/${n.id}/confirm`))) : h("span"),
          link("Forget", () => act(() => api.del(`/memory/${n.id}`)))))))
        : h("p", { class: "muted" }, "Nothing yet."),
      h("form", { class: "search-row", onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) act(() => api.post("/memory", { text: t })); } },
        input, h("button", { class: "btn sm", type: "submit" }, "Add")),
    ],
    mini: mini(`${notes.length} notes`),
  };
}

export const VAULT = {
  search: { canvas: "vault", width: 340, rank: 0, icon: () => "search", title: () => "Guides", render: search },
  guide: {
    canvas: "vault", width: 360, float: true, rank: 1, keys: () => (load("/knowledge?") || { results: [] }).results.map((e) => e.id),
    icon: () => "book", title: (k) => (load("/knowledge?") || { results: [] }).results.find((e) => e.id === k)?.title || k, render: guide,
  },
  memory: { canvas: "vault", width: 320, float: true, rank: 30, icon: () => "spark", title: () => "Memory", render: memory },
};
