import { api } from "../api.js";
import { clear, escapeHtml, h, icon, toast } from "../ui.js";

const NODE_W = 150, NODE_H = 54, COL = 168, ROW = 88, PAD_X = 64, PAD_Y = 20;
const SAFETY = { low: ["teal", "Low risk"], caution: ["amber", "Caution"], professional: ["red", "Professional only"] };

export async function renderRebuild(root, ctx) {
  const { state } = ctx;
  const tree = state.tree;
  const selected = state.view.node || state.household.topic || "energy_basics";
  const detail = await api.get(`/techtree/${selected}`);
  const path = new Set(detail.learning_path.map((p) => p.id));

  const select = async (id) => {
    state.view.node = id;
    try { await api.post("/context", { topic: id }); } catch (e) { toast(e.message, true); }
    await ctx.refresh();
  };

  clear(root,
    h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("div", {}, h("h2", {}, tree.title), h("div", { class: "muted", style: { fontSize: "13px" } }, tree.description)),
        h("div", { class: "right legend" },
          h("span", {}, h("i", { style: { background: "var(--teal)" } }), "low risk"),
          h("span", {}, h("i", { style: { background: "var(--amber)" } }), "caution"),
          h("span", {}, h("i", { style: { background: "var(--red)" } }), "professional only"))),
      h("div", { class: "tree-wrap" }, treeSvg(tree, selected, path, select)),
      h("p", { class: "faint", style: { fontSize: "12px", marginBottom: 0 } },
        "A curated dependency graph (validated: no cycles; every hands-on node requires Electrical safety). Highlighted: the learning path to the selected node. Click or press Enter on a node.")),
    nodePanel(detail, select, ctx));
}

// Top-to-bottom layout: tier = row, nodes in a tier spread horizontally.
function layout(tree) {
  const tiers = {};
  for (const n of tree.nodes) (tiers[n.tier] ||= []).push(n);
  const maxCols = Math.max(...Object.values(tiers).map((t) => t.length));
  const width = PAD_X * 2 + maxCols * COL - (COL - NODE_W);
  const nTiers = Math.max(...tree.nodes.map((n) => n.tier)) + 1;
  const height = PAD_Y * 2 + nTiers * ROW - (ROW - NODE_H);
  const pos = {};
  for (const [tier, nodes] of Object.entries(tiers)) {
    const rowWidth = nodes.length * COL - (COL - NODE_W);
    const left = (width - rowWidth) / 2;
    nodes.forEach((n, i) => (pos[n.id] = { x: left + i * COL, y: PAD_Y + Number(tier) * ROW }));
  }
  return { pos, width, height, tiers: nTiers };
}

function treeSvg(tree, selected, path, select) {
  const { pos, width, height, tiers } = layout(tree);
  const onPath = (id) => id === selected || path.has(id);
  let edges = "", nodes = "", labels = "";
  for (let t = 0; t < tiers; t++) labels += `<text class="tier-label" x="10" y="${PAD_Y + t * ROW + NODE_H / 2 + 3}">T${t}</text>`;
  for (const n of tree.nodes) {
    for (const p of n.prerequisites) {
      const a = pos[p], b = pos[n.id];
      const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y, my = (y1 + y2) / 2;
      const cls = onPath(n.id) && onPath(p) ? "edge path" : "edge";
      edges += `<path class="${cls}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
    }
    const { x, y } = pos[n.id];
    const cls = ["node", n.id === selected ? "selected" : "", path.has(n.id) ? "path" : "", n.id === tree.goal ? "goal" : ""].join(" ");
    const title = n.title.length > 21 ? n.title.slice(0, 20) + "…" : n.title;
    nodes += `<g class="${cls}" data-id="${n.id}" tabindex="0" role="button" aria-label="${escapeHtml(n.title)}, ${n.kind}, ${n.safety} risk">
      <title>${escapeHtml(n.title)}</title>
      <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}"/>
      <circle class="safety-${n.safety}" cx="${x + NODE_W - 12}" cy="${y + 12}" r="4"/>
      <text class="k" x="${x + 12}" y="${y + 20}">${n.id === tree.goal ? "◎ goal · " : ""}${n.kind}</text>
      <text class="t" x="${x + 12}" y="${y + 39}">${escapeHtml(title)}</text></g>`;
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg class="tree-svg" viewBox="0 0 ${width} ${height}" style="max-width:${width}px" role="group" aria-label="Electricity technology tree">${labels}${edges}${nodes}</svg>`;
  const svg = wrap.firstChild;
  svg.querySelectorAll(".node").forEach((g) => {
    g.addEventListener("click", () => select(g.dataset.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(g.dataset.id); } });
  });
  return svg;
}

function nodePanel(d, select, { sendChat }) {
  const [color, label] = SAFETY[d.safety.level];
  const have = d.materials.filter((m) => m.have), missing = d.materials.filter((m) => !m.have);
  return h("section", { class: "panel node-detail" },
    h("div", { class: "panel-head" },
      h("div", {}, h("div", { class: "eyebrow" }, `${d.kind} · tier ${d.tier}`), h("h2", {}, d.title)),
      h("div", { class: "right" }, h("span", { class: `badge ${color}` }, label))),
    h("p", { style: { marginTop: 0 } }, d.summary),
    h("div", { class: "grid-2" },
      h("div", {},
        h("div", { class: "eyebrow", style: { margin: "4px 0 6px" } }, "Why it matters"),
        h("p", { style: { marginTop: 0 } }, d.why),
        h("div", { class: "eyebrow", style: { margin: "10px 0 6px" } }, "Learning path (prerequisites, in order)"),
        d.learning_path.length
          ? h("div", { class: "path-list" }, d.learning_path.flatMap((p, i) => [
              i ? h("span", { class: "arrow" }, "→") : null,
              h("button", { class: "step", onclick: () => select(p.id) }, p.title)]), h("span", { class: "arrow" }, "→"), h("strong", {}, d.title))
          : h("div", { class: "muted" }, "No prerequisites — a great place to start."),
        d.unlocks.length ? [h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "Unlocks"),
          h("div", { class: "path-list" }, d.unlocks.map((u) => h("button", { class: "step", onclick: () => select(u.id) }, u.title)))] : null,
        h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "Learning goals"),
        h("ul", { style: { margin: 0, paddingLeft: "18px" } }, d.goals.map((g) => h("li", {}, g))),
        h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "Safe activity"),
        h("p", { style: { margin: 0 } }, d.activity)),
      h("div", {},
        h("div", { class: `alert ${color === "teal" ? "teal" : color}` }, icon(color === "teal" ? "info" : "warn"), h("div", {}, h("strong", {}, "Safety: "), d.safety.note)),
        h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "Materials vs. your inventory"),
        d.materials.length ? h("ul", { class: "mini-list" },
          have.map((m) => h("li", {}, h("span", { class: "ico", style: { color: "var(--teal)" } }, "✓"), h("span", {}, m.name, h("span", { class: "faint" }, ` — you have: ${m.matched_items.join(", ")}`)))),
          missing.map((m) => h("li", {}, h("span", { class: "ico", style: { color: "var(--amber)" } }, "✕"), h("span", {}, m.name, h("span", { class: "faint" }, " — not in inventory")))))
          : h("div", { class: "muted" }, "No materials needed — knowledge only."),
        d.knowledge.length ? [h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "From the knowledge vault"),
          h("ul", { class: "mini-list" }, d.knowledge.map((k) => h("li", {}, h("span", { class: "ico" }, "📖"), h("span", {}, h("strong", {}, k.title), " — ", k.summary))))] : null,
        h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, "Sources"),
        h("ul", { class: "mini-list" }, d.sources.map((s) => h("li", {}, h("span", { class: "ico" }, "↗"),
          h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title), h("span", { class: "faint" }, ` · ${s.publisher}`)))))),
    h("div", { class: "form-row", style: { marginTop: "14px" } },
      h("button", { class: "btn primary", onclick: () => sendChat(`Teach me "${d.title}" — explain it simply, connect it to what we already have, and tell me the next safe learning step.`) }, "Ask Prometheus to teach this")));
}
