// Records the demo scenes from docs/DEMO_SCRIPT.md as separate clips, against the live app and live model.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = 'http://localhost:8000';
const OUT = path.join(__dirname, 'clips');
const ONLY = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const CURSOR = `
(() => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.1-2.7 1.4-3.8-7.2L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '-50px', top: '-50px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX - 16 + 'px', top: e.clientY - 16 + 'px', width: '32px', height: '32px', borderRadius: '50%',
        background: 'rgba(240,120,40,.35)', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s, opacity .45s' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

let mouse = { x: 800, y: 450 };
let CUR = null; // the clip being recorded, for wait markers
const wait = (p, ms) => p.waitForTimeout(ms);

async function glide(p, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16));
  const sx = mouse.x, sy = mouse.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await p.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
    await p.waitForTimeout(16);
  }
  mouse = { x, y };
}

async function click(p, loc, opts = {}) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + loc);
  await glide(p, b.x + b.width / 2, b.y + b.height / 2, opts.ms || 650);
  await wait(p, 180);
  await p.mouse.down(); await wait(p, 70); await p.mouse.up();
  await wait(p, opts.after ?? 500);
}

async function say(p, text) {
  await click(p, p.locator('#chatInput'), { after: 200 });
  await p.keyboard.type(text, { delay: 55 });
  await wait(p, 400);
  await p.keyboard.press('Enter');
}

// Waits until the chat is idle again (the model has replied and the tools have run).
async function reply(p, maxMs = 90000) {
  await wait(p, 1200);
  const w0 = Date.now() / 1000;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const st = (await p.locator('#chatState').innerText().catch(() => '')).trim();
    const busy = await p.locator('#sendBtn[disabled], .chat-log .typing').count().catch(() => 0);
    if ((!st || /Standing by|unavailable/.test(st)) && !busy) break;
    await wait(p, 400);
  }
  if (CUR) CUR.waits.push([w0, Date.now() / 1000 - 0.3]);
  await wait(p, 900);
}

class Clip {
  constructor(p, name) { this.p = p; this.name = name; this.dir = path.join(OUT, name); this.frames = []; this.waits = []; CUR = this; }
  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.p.context().newCDPSession(this.p);
    this.cdp.on('Page.screencastFrame', async (f) => {
      const file = path.join(this.dir, String(this.frames.length).padStart(6, '0') + '.jpg');
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: f.metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await wait(this.p, 300);
  }
  async stop() {
    await wait(this.p, 300);
    await this.cdp.send('Page.stopScreencast');
    await this.cdp.detach().catch(() => {});
    const end = Date.now() / 1000;
    const lines = [];
    this.frames.forEach((f, i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].t : Math.max(end, f.t + 0.1);
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    lines.push(`file '${this.frames.at(-1).file}'`);
    const list = path.join(this.dir, 'list.txt');
    fs.writeFileSync(list, lines.join('\n'));
    const t0 = this.frames[0].t;
    fs.writeFileSync(path.join(OUT, this.name + '.json'), JSON.stringify({ duration: end - t0,
      waits: this.waits.map(([a, b]) => [+(a - t0).toFixed(2), +(b - t0).toFixed(2)]).filter(([a, b]) => b - a > 1.5) }));
    const mp4 = path.join(OUT, this.name + '.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', mp4]);
    console.log('wrote', mp4, ((end - this.frames[0].t)).toFixed(1) + 's', this.frames.length, 'frames');
  }
}


class Retake extends Error {}
// Retake if the model leaked raw JSON into its reply.
const clean = async (p) => { const t = await p.locator('.chat-log').innerText(); if (/[{\[]\s*"\w+"\s*[:,\]]/.test(t)) throw new Retake('raw JSON in reply'); };
const need = async (loc, what) => { if (!(await loc.count())) throw new Retake(what); };

async function zoomAt(p, loc, target = 0.85) {
  const [x, y] = await center(loc);
  await glide(p, x, y, 700);
  for (let i = 0; i < 12; i++) {
    const pct = parseInt(await p.locator('#zoomPct').innerText());
    if (pct >= target * 100) break;
    await p.keyboard.down('Control'); await p.mouse.wheel(0, -120); await p.keyboard.up('Control');
    await wait(p, 120);
  }
  await wait(p, 600);
}

const scenes = {
  async '1-meet'(p) {
    await wait(p, 1500);
    await glide(p, 620, 600, 900);
    await wait(p, 600);
    for (let i = 0; i < 3; i++) await click(p, p.locator('#zoomOut'), { ms: i ? 250 : 800, after: 450 });
    await wait(p, 1800);
    await click(p, p.locator('#fitBtn'), { after: 1500 });
    await glide(p, 1000, 450, 900);
    await wait(p, 2500);
  },
  async '2-prepare'(p) {
    await say(p, 'I bought 5 L of water');
    await reply(p);
    const water = p.locator('#world [aria-label="Water"]').first();
    const save = water.getByRole('button', { name: 'Save', exact: true }).first();
    await need(save, 'no pencilled water change');
    await clean(p);
    await wait(p, 2500);
    await click(p, save, { after: 3000 });
    await click(p, water.getByText('Why?', { exact: true }).first(), { after: 3500 });
    await glide(p, 1000, 500, 900);
    await wait(p, 1500);
  },
  async '3-auto'(p) {
    await click(p, p.locator('.mode-chip'), { after: 700 });
    await click(p, p.getByRole('menuitemradio', { name: /Auto/ }), { after: 900 });
    await say(p, 'I just bought 2 LED torches');
    await reply(p);
    await need(p.locator('.chat-log').getByText('Undo', { exact: true }), 'torches not auto-saved');
    await wait(p, 2500);
    await say(p, 'I bought a slab of water');
    await reply(p);
    await wait(p, 2500);
    await click(p, p.locator('.mode-chip'), { after: 700 });
    await click(p, p.getByRole('menuitemradio', { name: /Ask first/ }), { after: 1200 });
  },
  async '4-survive'(p) {
    await say(p, 'The power just went out across the whole street.');
    await reply(p);
    const save = p.locator('.chat-log').getByRole('button', { name: 'Save', exact: true }).last();
    await need(save, 'no plan drafted');
    await clean(p);
    await wait(p, 2000);
    const src = p.locator('.chat-log a').first();
    if (await src.count()) { await glide(p, ...(await center(src)), 900); await wait(p, 1500); }
    await click(p, save, { after: 2000 });
    const plan = p.locator('#world [aria-label^="Blackout"], #world [aria-label*="plan" i]').first();
    if (await plan.count()) await zoomAt(p, plan);
    const step = p.locator('#world input[type=checkbox]:not([disabled])').first();
    if (await step.count()) { await step.scrollIntoViewIfNeeded(); await click(p, step, { after: 2000 }); }
    await wait(p, 1500);
  },
  async '5-sos'(p) {
    await click(p, p.locator('#sosBtn'), { after: 1100 });
    const sos = p.locator('.sos-screen');
    await click(p, sos.getByRole('button', { name: 'No', exact: true }), { after: 900 });
    await click(p, sos.getByRole('button', { name: /Power out/ }), { after: 1100 });
    for (let i = 0; i < 15; i++) {
      if (await sos.getByRole('button', { name: /Done/ }).count()) break;
      const next = sos.getByRole('button', { name: 'Next', exact: true });
      if (await next.count()) { await wait(p, 1600); await click(p, next, { after: 900 }); continue; }
      const txt = (await sos.innerText()).toLowerCase();
      const yes = /generator|grill|camp stove|barbecue/.test(txt);
      await click(p, sos.getByRole('button', { name: yes ? 'Yes' : 'No', exact: true }).first(), { after: 900 });
    }
    await wait(p, 2000);
    await click(p, sos.getByRole('button', { name: /Done/ }).first(), { after: 2200 });
    await click(p, sos.getByRole('button', { name: 'Close SOS' }), { after: 1200 });
  },
  async '6-rebuild'(p) {
    await say(p, 'Teach me how electricity works.');
    await reply(p);
    await need(p.locator('#world [aria-label^="Lesson"], #world [aria-label*="electric" i]'), 'no lesson card');
    await clean(p);
    await wait(p, 3000);
    const theory = p.locator('#world').getByText(/Theory only/).first();
    if (await theory.count()) { await theory.scrollIntoViewIfNeeded(); await glide(p, ...(await center(theory)), 900); }
    await wait(p, 2500);
  },
  async '7-proof'(p) {
    await click(p, p.locator('#menuBtn'), { after: 700 });
    await click(p, p.getByRole('menuitem', { name: /Show me how it works/ }), { after: 0 });
    await p.waitForLoadState('networkidle');
    await wait(p, 2000);
    await say(p, 'I bought 2 more cans of beans');
    await reply(p);
    const approve = p.locator('.chat-log').getByRole('button', { name: /Approve/ }).last();
    await need(approve, 'no proposal in Advanced');
    await wait(p, 1500);
    await click(p, approve, { after: 2500 });
    const pre = p.locator('.chat-log details.hood').last();
    if (await pre.count()) {
      await pre.scrollIntoViewIfNeeded();
      await glide(p, ...(await center(pre)), 900);
      for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 160); await wait(p, 500); }
      await wait(p, 1500);
    }
    await click(p, p.locator('.nav-btn[data-mode="settings"]'), { after: 1500 });
    const log = p.getByText(/Tool call log/).first();
    await log.scrollIntoViewIfNeeded();
    await glide(p, ...(await center(log)), 900);
    await wait(p, 5000);
  },
};

async function center(loc) { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }

async function freshDemo(p) {
  try { await p.evaluate(() => localStorage.clear()); } catch {}
  await p.goto(BASE + '/');
  await wait(p, 1200);
  const w = p.getByRole('button', { name: 'Try the demo family' }).first();
  if (await w.isVisible().catch(() => false)) await w.click();
  else { await p.locator('#menuBtn').click(); await p.getByRole('menuitem', { name: 'Try the demo family' }).click(); }
  await wait(p, 9500); // let the "demo loaded" toast go
  await p.mouse.move(mouse.x, mouse.y);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  await ctx.addInitScript(CURSOR);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  for (const [name, fn] of Object.entries(scenes)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    for (let take = 1; take <= 4; take++) {
      await freshDemo(p);
      const clip = new Clip(p, name);
      await clip.start();
      let ok = true;
      try { await fn(p); } catch (e) { ok = false; console.log(`scene ${name} take ${take} failed:`, e.message.split('\n')[0]); }
      await p.screenshot({ path: path.join(OUT, name + '-end.png') });
      await clip.stop();
      if (ok) break;
    }
  }
  await b.close();
})();
