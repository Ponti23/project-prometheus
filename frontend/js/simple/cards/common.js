// Small building blocks shared by every card.
import { h, icon } from "../../ui.js";

// Status colours always come with an icon and a word.
export const STATUS = { met: ["check", "Ready"], partial: ["warn", "Short"], missing: ["x", "None yet"] };

export function pill(status, word) {
  const [ic, w] = STATUS[status] || ["info", status];
  return h("span", { class: `pill ${status}` }, icon(ic), word || w);
}

export function dot(status) {
  const [ic, w] = STATUS[status] || ["info", status];
  return h("span", { class: `sdot ${status}`, title: w }, icon(ic), h("span", { class: "sr-only" }, w));
}

// A number the flame can find and land on.
export function num(text, key) {
  return h("span", { class: "num", "data-num": key }, text);
}

export function mini(value, word = "") {
  return [h("strong", {}, value), word ? h("span", {}, word) : null];
}

export function link(label, onclick, ic = null) {
  return h("button", { class: "link", type: "button", onclick }, ic ? icon(ic) : null, label);
}

export function button(label, onclick, cls = "") {
  return h("button", { class: `btn ${cls}`, type: "button", onclick }, label);
}

export function stepper(value, onchange, { min = 0, max = 30, label = "" } = {}) {
  return h("span", { class: "stepper", role: "group", "aria-label": label },
    h("button", { type: "button", "aria-label": `Less ${label}`, disabled: value <= min, onclick: () => onchange(value - 1) }, icon("minus")),
    h("output", {}, String(value)),
    h("button", { type: "button", "aria-label": `More ${label}`, disabled: value >= max, onclick: () => onchange(value + 1) }, icon("plus")));
}

export function segmented(options, value, onchange, label) {
  return h("span", { class: "segmented", role: "radiogroup", "aria-label": label },
    options.map(([v, text]) => h("button", { type: "button", role: "radio", "aria-checked": String(v === value), onclick: () => onchange(v) }, text)));
}

export function row(...children) {
  return h("div", { class: "row" }, ...children);
}
