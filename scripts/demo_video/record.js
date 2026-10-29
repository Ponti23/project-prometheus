// Records the Prometheus demo against the real app + real Nemotron.
// Writes raw.webm and marks.json (timeline used to speed up model waits).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const W = 1440, H = 900;

const OVERLAY = `
(() => {
  const css = \`
  #demo-cursor{position:fixed;z-index:99999;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform .08s}
  #demo-cursor.down{transform:scale(.8)}
  .demo-ripple{position:fixed;z-index:99998;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #ffb347;pointer-events:none;animation:demoRip .55s ease-out forwards}
  @keyframes demoRip{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.6)}}
  #demo-cap{position:fixed;z-index:99997;left:836px;bottom:58px;transform:translateX(-50%);max-width:600px;width:max-content;
    background:rgba(10,12,11,.92);color:#f4efe6;border:1px solid rgba(255,179,71,.55);border-radius:14px;padding:12px 20px;
    font:600 19px/1.35 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5);transition:opacity .35s;opacity:0}
  #demo-cap small{display:block;font-weight:500;font-size:14px;color:#ffb347;margin-top:4px;letter-spacing:.02em}
  #demo-card{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    background:radial-gradient(circle at 50% 40%,#2a1608 0,#0b0d0c 60%);color:#f4efe6;font-family:Inter,system-ui,sans-serif;transition:opacity .7s;text-align:center}
  #demo-card img{width:150px;height:150px}
  #demo-card h1{font-size:54px;letter-spacing:.06em;margin:6px 0 0}
  #demo-card h2{font-size:26px;font-weight:500;color:#ffb347;margin:0}
  #demo-card p{font-size:20px;color:#b8b2a6;margin:6px 0 0;max-width:900px;line-height:1.5}
  #demo-card code{font-size:20px;color:#7fe0c4}\`;
  const add = () => {
    if (document.getElementById('demo-cursor')) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'demo-cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.9L20.5 10z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.left = (window.__cx || 720) + 'px'; c.style.top = (window.__cy || 450) + 'px';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.appendChild(cap);
    addEventListener('mousemove', e => { window.__cx = e.clientX; window.__cy = e.clientY; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => { c.classList.add('down'); const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  window.__demoCaption = (html) => { add(); const cap = document.getElementById('demo-cap'); if (!html) { cap.style.opacity = 0; return; } cap.innerHTML = html; cap.style.opacity = 1; };
  window.__demoCard = (html) => { add(); let d = document.getElementById('demo-card'); if (!html) { if (d) { d.style.opacity = 0; setTimeout(() => d.remove(), 800); } return; }
    if (!d) { d = document.createElement('div'); d.id = 'demo-card'; document.body.appendChild(d); } d.innerHTML = html; d.style.opacity = 1; };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = [];
  const now = () => (Date.now() - t0) / 1000;
  const mark = (type, extra = {}) => { marks.push({ t: now(), type, ...extra }); console.log(now().toFixed(1), type, JSON.stringify(extra)); };
  const wait = (ms) => page.waitForTimeout(ms);
  await page.addInitScript(OVERLAY);

  let cx = 720, cy = 450;
  async function moveTo(loc) {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const steps = Math.max(12, Math.round(Math.hypot(x - cx, y - cy) / 25));
    await page.mouse.move(x, y, { steps });
    cx = x; cy = y;
    await wait(250);
  }
  async function click(loc) { await moveTo(loc); await page.mouse.down(); await wait(90); await page.mouse.up(); await wait(450); }
  const caption = (text, sub) => page.evaluate(([t, s]) => window.__demoCaption(t ? t + (s ? `<small>${s}</small>` : '') : null), [text, sub]);
  const card = (html) => page.evaluate((h) => window.__demoCard(h), html);
  const chatScroll = (to) => page.evaluate((to) => new Promise((res) => {
    const log = document.getElementById('chatLog');
    let target = to === 'bottom' ? log.scrollHeight : to;
    if (to === 'lastReply') { const msgs = [...log.querySelectorAll('.msg.user')]; const u = msgs.at(-1); target = u ? u.offsetTop - 12 : 0; }
    log.scrollTo({ top: target, behavior: 'smooth' }); setTimeout(res, 900);
  }), to);
  // Slowly scroll the chat log from the last question down through the reply.
  async function readReply(ms) {
    await chatScroll('lastReply');
    await wait(1200);
    const max = await page.evaluate(() => { const l = document.getElementById('chatLog'); return l.scrollHeight - l.clientHeight; });
    const start = await page.evaluate(() => document.getElementById('chatLog').scrollTop);
    const n = Math.max(1, Math.round(ms / 120));
    await page.evaluate(() => { document.getElementById('chatLog').style.scrollBehavior = 'auto'; });
    for (let i = 1; i <= n; i++) {
      await page.evaluate((y) => { document.getElementById('chatLog').scrollTop = y; }, start + (max - start) * i / n);
      await wait(120);
    }
    await page.evaluate(() => { document.getElementById('chatLog').style.scrollBehavior = ''; });
  }
  async function ask(text) {
    const input = page.locator('#chatInput');
    await click(input);
    await input.pressSequentially(text, { delay: 28 });
    await wait(400);
    await click(page.locator('#sendBtn'));
    await caption('Nemotron is reading your household data through tools…', '⏩ sped up while the model works');
    mark('fast_start');
    const t = Date.now();
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled && !document.querySelector('.bubble.typing'), null, { timeout: 180000 });
    await wait(700);
    mark('fast_end', { real: (Date.now() - t) / 1000 });
    const err = await page.locator('.msg.error').count();
    if (err) throw new Error('model error shown in chat');
  }
  const ws = (sel) => page.locator('#workspace ' + sel);

  // Setup (trimmed from the final video)
  await page.goto('http://localhost:8000');
  await page.waitForSelector('.nav-btn');
  await page.click('[data-mode=settings]');
  await page.click('text=Load demo household');
  await wait(1200);
  await page.click('[data-mode=companion]');
  await wait(1000);
  await card(`<img src="assets/emblem.svg"><h1>PROMETHEUS</h1><h2>Humanity's Backup Brain</h2>
    <p>A personal AI apocalypse buddy. Prepare today. Survive tomorrow. Rebuild the future.</p>
    <p style="font-size:17px">Running live on <b style="color:#76b900">NVIDIA Nemotron</b> via <b style="color:#f4efe6">Nebius Token Factory</b> · real screen recording, no scripted replies</p>`);
  await wait(400);
  mark('start');
  await wait(5500);
  await card(null);
  await wait(800);

  // 1 · Meet Prometheus
  await caption('One companion that already knows your household', 'Demo family: 2 adults, 3 children, a dog, daily medication');
  await moveTo(page.locator('.context'));
  await wait(2200);
  await ask("Hi Prometheus! I'm preparing my family of five for a 30-day emergency.");
  await caption('It looked up the saved profile with a real tool call', 'Tool pills under each reply show what it called');
  await readReply(5000);
  await wait(800);

  // 2 · Prepare
  await ask('How ready are we for 30 days? What are we short of? Propose restock tasks.');
  await caption('Numbers come from a deterministic calculator, not the model', '"Coverage of planning targets", never a survival probability');
  await readReply(6500);
  await caption('Changes are only proposals until you approve them');
  const approve1 = page.locator('.action-card:not(.resolved) button', { hasText: 'Approve' }).last();
  await click(approve1);
  await wait(1500);
  await caption('Approved tasks are saved to the household');
  await click(page.locator('[data-mode=prepare]'));
  await wait(800);
  const doneAdd = ws('button', { hasText: 'Done + add to inventory' }).first();
  await page.evaluate(() => { const b = [...document.querySelectorAll('#workspace button')].find((x) => x.textContent.includes('Done + add')); b && b.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  await wait(1500);
  await caption('Complete a task and the inventory and coverage recalculate');
  await click(page.locator('#workspace button', { hasText: 'Done + add to inventory' }).first());
  await wait(1200);
  await page.evaluate(() => document.getElementById('workspace').scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(1200);
  await page.evaluate(() => { const k = [...document.querySelectorAll('#workspace h2')].find((x) => x.textContent.includes('Smart survival kit')); k && k.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  await wait(3000);

  // 3 · Survive
  await click(page.locator('[data-mode=companion]'));
  await ask("The power grid has collapsed. We don't have electricity anymore. What should we do?");
  await caption('Triage first, then a plan built from this household’s real resources');
  await readReply(9000);
  await caption('Every source link comes from the tools, so it can’t be invented', 'The Sources footer is built from what the tools returned');
  await page.evaluate(() => { const s = [...document.querySelectorAll('#chatLog .sources')].at(-1); s && s.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  await wait(3200);
  const approvePlan = page.locator('.action-card:not(.resolved) button', { hasText: 'Approve' }).last();
  if (await approvePlan.count()) {
    await caption('Approve the response plan and it becomes a checklist');
    await click(approvePlan);
    await wait(1500);
    await click(page.locator('[data-mode=survive]'));
    await wait(900);
    await page.evaluate(() => { const c = document.querySelector('#workspace .steps input[type=checkbox]'); c && c.closest('.panel, section, div').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    await wait(1500);
    const box = page.locator('#workspace .steps input[type=checkbox]').first();
    if (await box.count()) await click(box);
    await wait(2200);
  } else mark('no_plan');

  // 4 · Rebuild
  await click(page.locator('[data-mode=companion]'));
  await ask('Prometheus, can you teach me how electricity works so we can eventually restore power?');
  await caption('Rebuild: it opens the electricity technology tree', 'Learning path, materials checked against your inventory, safety gating');
  await wait(3500);
  await page.evaluate(() => document.getElementById('workspace').scrollTo({ top: 400, behavior: 'smooth' }));
  await wait(3000);
  await page.evaluate(() => document.getElementById('workspace').scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(1500);
  await caption('…and explains it in plain language');
  await readReply(5000);

  // 5 · Persistence
  await caption('Everything is saved: reload the page and it is all still there');
  await wait(1200);
  await page.reload();
  await page.waitForSelector('.nav-btn');
  await wait(2500);

  // 6 · Under the hood
  await caption('Under the hood: the real model, response ID, latency, tokens and every tool call');
  await click(page.locator('#hoodToggle'));
  await wait(1200);
  await page.evaluate(() => { const d = [...document.querySelectorAll('#chatLog details.hood')].at(-1); d && d.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  await wait(4500);
  await page.evaluate(() => { const p = [...document.querySelectorAll('#chatLog details.hood pre')].at(-1); p && p.scrollTo({ top: 600, behavior: 'smooth' }); });
  await wait(3000);
  await click(page.locator('[data-mode=settings]'));
  await page.evaluate(() => { const h = [...document.querySelectorAll('#workspace h2')].find((x) => x.textContent.includes('Tool call log')); h && h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  await caption('Tool call log: proposals change data only after approval');
  await wait(4500);
  await caption(null);

  await card(`<img src="assets/emblem.svg"><h1>PROMETHEUS</h1><h2>Prepare today. Survive tomorrow. Rebuild the future.</h2>
    <p>NVIDIA Nemotron · Nebius Token Factory · 15 real tools · you approve every change</p>
    <p><code>github.com/Ponti23/project-prometheus</code></p>`);
  await wait(5000);
  mark('end');
  await page.close();
  const v = await page.video().path();
  await ctx.close(); await browser.close();
  fs.renameSync(v, path.join(OUT, 'raw.webm'));
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
