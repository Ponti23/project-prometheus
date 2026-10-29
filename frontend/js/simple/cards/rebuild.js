// Rebuild canvas: the technology tree as a numbered path of lessons, and one card per lesson.
import { api } from "../../api.js";
import { h, icon } from "../../ui.js";
import { app, load } from "../app.js";
import { sendChat } from "../chat.js";
import { button, link, mini } from "./common.js";

// Lessons are numbered in tier order; a tier with several nodes is a choice of what to learn next.
export function lessons(tree) {
  const tiers = [...new Set(tree.nodes.map((n) => n.tier))].sort((a, b) => a - b);
  let n = 0;
  const groups = tiers.map((t) => tree.nodes.filter((x) => x.tier === t).map((x) => ({ ...x, n: ++n })));
  return { groups, byId: Object.fromEntries(groups.flat().map((x) => [x.id, x])) };
}

function before(tree, id) {
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const out = new Set();
  const walk = (i) => byId[i]?.prerequisites.forEach((p) => { if (!out.has(p)) { out.add(p); walk(p); } });
  walk(id);
  return out;
}

const SAFE = { low: null, caution: ["warn", "Careful"], professional: ["x", "Theory only"] };
const loading = (title) => ({ icon: "bolt", title, body: h("p", { class: "muted" }, "Loading…"), mini: mini("…") });

function path(c) {
  const tree = load("/techtree");
  if (!tree) return loading("Learning path");
  const { groups, byId } = lessons(tree);
  const here = app.data.household.topic;
  const towards = c.ui.filter && byId[c.ui.filter] ? c.ui.filter : null;
  const lit = towards ? before(tree, towards).add(towards) : null;
  const row = (x) => h("li", { class: [x.id === here ? "here" : "", lit && !lit.has(x.id) ? "dim" : ""].join(" ") },
    h("button", { type: "button", onclick: () => openLesson(x.id) },
      h("span", { class: "n" }, String(x.n)), h("span", { class: "t" }, x.title),
      SAFE[x.safety] ? h("span", { class: `tag ${x.safety === "professional" ? "bad" : "warn"}` }, SAFE[x.safety][1]) : null,
      x.id === here ? h("span", { class: "tag ok" }, "You're here") : null));
  return {
    icon: "bolt", title: "Learning path", width: 340, tag: towards ? `to ${byId[towards].title}` : "",
    body: [
      h("p", { class: "muted" }, `Goal: ${byId[tree.goal]?.title}`),
      h("ol", { class: "path" }, groups.map((g) => (g.length === 1 ? row(g[0])
        : h("li", { class: "choice" }, h("span", { class: "choose" }, "Choose next"), h("ol", {}, g.map(row)))))),
      towards ? link("Show the whole path", () => { c.ui.filter = null; app.canvas.paint(c); }) : null,
    ],
    mini: mini(`${tree.nodes.length} lessons`, here && byId[here] ? `at ${byId[here].n}` : ""),
  };
}

export function openLesson(id) {
  api.post("/context", { topic: id }).catch(() => {});
  app.data.household.topic = id;
  app.spawn("lesson", id);
  app.canvas.get("path") && app.canvas.paint(app.canvas.get("path"));
}

function lesson(c) {
  const tree = load("/techtree");
  const v = load(`/techtree/${c.key}`);
  if (!tree || !v) return loading("Lesson");
  const { byId } = lessons(tree);
  const pro = v.safety.level === "professional";
  return {
    icon: "bolt", title: `Lesson ${byId[c.key]?.n ?? ""}`, width: 360,
    status: pro ? "missing" : v.safety.level === "caution" ? "partial" : "met",
    body: [
      h("h3", {}, v.title),
      h("p", {}, v.summary),
      h("p", { class: "muted" }, v.why),
      pro ? h("p", { class: "call" }, icon("warn"), "Theory only. Leave wiring to a licensed electrician.") : null,
      h("div", { class: "try" }, h("strong", {}, "Try this safely"), h("p", {}, v.activity), v.safety.note ? h("p", { class: "muted" }, v.safety.note) : null),
      v.goals.length ? [h("h3", {}, "You'll be able to"), h("ul", { class: "plain" }, v.goals.map((g) => h("li", {}, g)))] : null,
      v.materials.length ? [h("h3", {}, "Things you'll use"), h("ul", { class: "plain" }, v.materials.map((m) => h("li", {},
        h("span", { class: `sdot ${m.have ? "met" : "missing"}` }, icon(m.have ? "check" : "x")), " ", m.name,
        m.have ? h("span", { class: "muted" }, ` · you have ${m.matched_items[0]}`) : null)))] : null,
      v.unlocks.length ? h("p", { class: "row" }, h("span", { class: "muted" }, "Next:"), v.unlocks.map((u) => link(u.title, () => openLesson(u.id)))) : null,
      v.sources.length ? h("p", { class: "source" }, icon("book"), " ", v.sources.map((s, i) => [i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title)])) : null,
      h("div", { class: "row" }, button("Ask Prometheus to teach me", () => sendChat(`Teach me "${v.title}" step by step, for our household.`), "primary sm")),
    ],
    mini: mini(v.title, pro ? "Theory only" : ""),
  };
}

export const REBUILD = {
  path: { canvas: "rebuild", width: 340, rank: 0, icon: () => "map", title: () => "Learning path", render: path },
  lesson: {
    canvas: "rebuild", width: 360, rank: 1, keys: () => { const t = load("/techtree"); return t ? lessons(t).groups.flat().map((x) => x.id) : []; },
    icon: () => "bolt", title: (k) => { const t = load("/techtree"); const x = t && lessons(t).byId[k]; return x ? `${x.n}. ${x.title}` : k; },
    render: lesson,
  },
};
