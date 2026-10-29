import { setFaceBase } from "./face.js";

// Small DOM helpers. All text goes through text nodes or escaping — never raw HTML from data.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v; // only used with trusted, escaped markup
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const ICONS = {
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="M11 13l9-9"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  atom: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
};

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return span.firstChild;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => el.replaceWith(icon(el.dataset.icon)));
}

export function setEmblemState(state) {
  setFaceBase({ thinking: "thinking", tool: "thinking", offline: "sleeping" }[state] || "idle");
}

// ---- minimal, safe markdown (escape first, then a small set of inline/block rules)
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function markdown(src) {
  const lines = escapeHtml(src || "").split(/\r?\n/);
  const out = [];
  let list = null;
  let para = [];
  let table = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
  const cells = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => inline(c.trim()));
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));  // drop the |---|---| separator
    table = [];
    if (!rows.length) return;
    const [head, ...body] = rows;
    out.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead>`
      + `<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
  };
  const flushList = () => { if (list) { out.push(`<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ""}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^\s*\|/.test(line)) { flushPara(); flushList(); table.push(line); continue; }
    flushTable();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { flushPara(); flushList(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [], start: Number(m[1]) }; } list.items.push(m[2]); continue; }
    flushList();
    para.push(line);
  }
  flushTable(); flushPara(); flushList();
  return out.join("");
}

export function toast(msg, isErr = false) {
  const t = h("div", { class: "toast" + (isErr ? " err" : ""), role: "status" }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function fmt(n, unit = "") {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  const s = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
  return unit ? `${s} ${unit}` : s;
}

export function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}

export function statusTag(status) {
  const map = { met: ["✓", "Met"], partial: ["◐", "Partial"], missing: ["✕", "Missing"] };
  const [g, label] = map[status] || ["?", status];
  return h("span", { class: `status-tag ${status}` }, g, " ", label);
}

export function bar(coverage, status) {
  return h("div", { class: `bar ${status}`, role: "img", "aria-label": `${pct(coverage)} covered` },
    h("span", { style: { width: pct(coverage) } }));
}

export function ring(value, label = "COVERAGE") {
  const r = 46, c = 2 * Math.PI * r;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg class="ring" viewBox="0 0 108 108" role="img" aria-label="${pct(value)} ${label.toLowerCase()}">
    <circle class="track" cx="54" cy="54" r="${r}"/>
    <circle class="val" cx="54" cy="54" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" transform="rotate(-90 54 54)"/>
    <text x="54" y="56" text-anchor="middle">${pct(value)}</text>
    <text class="sub" x="54" y="72" text-anchor="middle">${escapeHtml(label)}</text></svg>`;
  const svg = wrap.firstChild;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    svg.querySelector(".val").style.strokeDashoffset = String(c * (1 - Math.min(1, value || 0)));
  }));
  return svg;
}
