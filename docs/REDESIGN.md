# UI redesign: Simple mode (an AI-native canvas)

_Status: design agreed with the owner on 2026-10-29. **All seven phases are built** on `claude/charming-bell-9gytjt` (not merged, no PR). The defaults chosen along the way are listed at the end._

> **Resuming in a fresh session?** Read this whole file first. The owner asked you to work on your own (they're driving). Don't stop to ask questions: use the defaults written here, write down anything new under [Decisions made while the owner was away](#decisions-made-while-the-owner-was-away), and keep going.

## Why

In the owner's words: *"it's kinda too overwhelming… this was meant to help out a normal person, it looks like an IT hub."* Keep today's UI as **Advanced mode**, unchanged, and build a friendlier **Simple mode** that stays just as robust and useful.

What's wrong with today's UI (from the audit):
- Four panels are on screen at once: nav rail, chat, workspace and context sidebar.
- The same facts (household, water days, shortages) appear three times.
- It uses engineer language: "coverage of planning targets", "229,800 kcal", "GUIDELINE", "Cloud AI configured · Nebius", monospace text and letter-spaced capitals.
- The headline **33% is an unweighted mean of 14 targets**, so a can opener counts as much as water.
- The 30-day goal is discouraging (555 L of water short). At 3 days the demo family is almost there (see [stages](#9-readiness-in-stages-replaces-the--in-simple-mode)).
- Food only counts if kcal per unit is entered. Normal people don't know that, so the demo's "Canned beans" count for nothing.
- The emergency flow depends on the chat and the server.
- The teal terminal look clashes with the orange flame mascot, which is the friendliest thing in the app.

## Ground rules (don't break these)

- **Advanced mode is the current UI and must keep working exactly as it does today**: every view, the chat, approvals, Under the hood, the tool log.
- **The honesty rules from the README stay:**
  - Numbers come only from the deterministic calculator.
  - Write tools only *propose*. `execute_action()` (or a path that calls it) is the only thing that changes state.
  - Citations come only from `data/sources.json` via tool results.
  - Coverage is never presented as a survival probability.
  - Memory notes stay "suggested" until the user confirms them.
  - Without AI the app shows an honest "unavailable" state.
- **Stack:** vanilla JS ES modules, no build step, no framework. Reuse `h()`, `icon()`, `clear()` from `frontend/js/ui.js`, plus `frontend/js/api.js` and `frontend/js/face.js`. Match the surrounding style: compact code, short comments.
- **Simple-mode copy is short.** The owner said: *"I don't want to be too wordy."* No subtitles and no explanatory paragraphs.
- **Branch and deploy:** work on `claude/charming-bell-9gytjt` and push there. **Don't merge to `main` or open a PR unless the owner asks.** Render redeploys on every push to `main`, and the hackathon deadline is **Oct 30, 2026, 10:00 AM PDT** (see [HANDOFF.md](HANDOFF.md)).

## The design

### 1. Simple vs Advanced
- `/` (`frontend/index.html`) becomes **Simple**. Move the current page verbatim to `frontend/advanced.html`; it keeps using `js/app.js` and `styles.css`. `StaticFiles(html=True)` in `backend/app/main.py` serves both.
- Toggles both ways: Simple's menu has "Advanced mode", and Advanced's Settings has "Simple mode". Store the choice in `localStorage["prometheus.ui"]`, wrapped in try/catch like the existing code. If Advanced was chosen, a tiny inline script on `index.html` redirects to `advanced.html`.
- "Load demo household" in Simple also offers **"Show me how it works"**. It opens `advanced.html` with Under the hood on (`localStorage["prometheus.hood"] = "1"`), so judges still see the tool calls.

### 2. Layout
The owner's hand sketch is in [redesign/sketch.webp](redesign/sketch.webp). The line with 4 circles near the bottom of the sketch only separates text, so ignore it.

Desktop: a top bar, then a free canvas on the left and the chat panel on the right (about 360px).

```
┌──────────────────────────────────────────────────────────────────┐
│ PROMETHEUS   [Prepare]  Survive  Rebuild  Vault      SOS  ≡      │
├──────────────────────────────────────────────┬───────────────────┤
│  ┌ Ready in stages ───┐  ┌ Water ───── NEW ┐ │ You: I bought 5 L │
│  │ ●━━━━○────○────○   │  │ 60 L  →  65 L   │ │ of water          │
│  │ 3d  1wk  2wk  30d  │  │ covers 3 days ✓ │ │                   │
│  │ 8 left for 3 days  │  │ [Save]  [Edit]  │ │ Nice, that covers │
│  └────────────────────┘  └─────────────────┘ │ your first 3 days │
│  ┌ Next up ───────────┐                      │ of water. Save it │
│  │ ☐ 1.5 L water      │          (flame)     │ on the card.      │
│  │ ☐ Can opener       │                      │                   │
│  │ ☐ 15 bin bags      │                      │ [Ask first ▾]     │
│  └────────────────────┘         + Add card   │ [Message…]     ➤  │
└──────────────────────────────────────────────┴───────────────────┘
```

Phone (≤ 760px): the canvas fills the screen. Switch canvases with the tab row or by swiping. The chat is a bar at the bottom that pulls up into a sheet, and the flame flies up out of it.

```
┌──────────────────────────┐
│ Prepare  ● ○ ○ ○     SOS │
│ ┌ Water ─────────── NEW ┐│
│ │ 60 L  →  65 L         ││
│ │ covers 3 days ✓       ││
│ │ [Save]  [Edit]        ││
│ └───────────────────────┘│
│ ┌ Ready in stages ──────┐│
│ │ ●━━━━○────○────○      ││
│ └───────────────────────┘│
├──────────────────────────┤
│ Nice, that covers your   │
│ first 3 days of water.   │
│ [Message…]            ➤  │
└──────────────────────────┘
```

Tabs: **Prepare · Survive · Rebuild · Vault**, each an icon plus its name. No subtitles. "Knowledge Vault" is shortened to "Vault".

### 3. The canvas (like Excalidraw, but no drawing or pasting)
- **An infinite world.**
  - Pan: drag empty space, Space+drag, or scroll on a trackpad.
  - Zoom: Ctrl/⌘ + wheel, trackpad pinch, touch pinch, or the + and − buttons. Limits are about 25% to 200%.
  - Background: a faint dot grid that scales with zoom.
- **Cards are real DOM elements** inside one world layer moved with `transform: translate() scale()`, not `<canvas>` drawing. That keeps text sharp, clickable and readable by screen readers.
- **Moving and removing cards:** drag a card by its header. Pin keeps a card. ✕ removes it, with an Undo toast.
- **Semantic zoom:** below about 60%, cards switch to a compact form (icon, title, one number, status colour), so zooming out gives a map of how ready you are. Zoomed in, cards show full detail and buttons.
- **Floating controls, bottom left:** `−  100%  +` · Fit · Tidy (auto-arrange) · Clear (removes unpinned cards).
- **No permanent left strip.** A **"+" button** (top left of the canvas) slides out a **card drawer** from the left, listing the cards available on this canvas. Tap one to place it or drag it out. The drawer only shows while it's open.
- **Edge pointers:** if a card off-screen changes, a chip at the viewport edge points to it ("Water changed →"). Clicking it glides there.
- **One card per thing:** a card's identity is `type:key` (e.g. `category:water`). Spawning a card that already exists focuses and updates it instead of making a duplicate. This is what stops clutter.
- **The app decides placement, never the model.** A new card goes into free space near the centre of the viewport, then the camera glides to it.
- **Default cards:** each canvas opens with 2–3 cards (never empty, never full). On Prepare that's Ready in stages, Next up and Water.
- **Saving:** each canvas's layout and camera are saved in `localStorage`, keyed by canvas. A household is one per browser through its cookie. Clear saved layouts when the demo is loaded or the household is reset.
- **Accessibility:**
  - Tab moves through cards in reading order (top to bottom, left to right). Arrow keys move the focused card, and Shift makes bigger steps.
  - Shortcuts: Shift+1 fits everything (as in Excalidraw), and + / − zoom.
  - An `aria-live` region announces changes ("Prometheus updated Water").
  - With `prefers-reduced-motion`, there are no glides and no flight.

### 4. Cards

| Card (`type:key`) | Canvas | Shows | Data | Spawned by tool |
|---|---|---|---|---|
| `stages` | Prepare | Ladder 3d · 1wk · 2wk · goal, plus "N left for 3 days" | `/api/summary` | `calculate_readiness` |
| `next` | Prepare | Shopping list for the current stage. Ticking an item completes the task and adds it to supplies (existing `POST /api/tasks/{id}/complete` with `add_to_inventory`) | `/api/summary`, `/api/tasks` | `get_missing_supplies`, `propose_restock_tasks` |
| `category:<key>` | Prepare | One card each for Water, Food, Medicine, Pet food, Light & power, Radio, Hygiene, Tools, Documents. Have vs need in human units, items with − / + steppers, a "Why?" link, and "Broken or used up" | `/api/summary`, `/api/inventory` | `get_inventory`, `add_inventory_item`, `update_inventory_item` |
| `household` | Prepare | People, pets, goal, needs | `/api/household` | `get_household_profile`, `update_household_profile` |
| `expiring` | Prepare | Expiring, expired and broken items | `/api/readiness` | (default when non-empty) |
| `scenario:<id>`, `safety:<id>`, `resources`, `plan:<id>` | Survive | Scenario, safety check (triage), what you've got, response plan checklist | `/api/scenarios/{id}`, `/api/plans` | `get_scenario_guide`, `create_survival_plan`, `get_tasks_and_plans` |
| `path`, `lesson:<node>` | Rebuild | The tree as a numbered **path of lessons** (not the SVG graph), with branches shown as "Choose next: A or B". A lesson has what & why, "Try this safely", "Ask Prometheus to teach me" and materials you have or need. Professional-only nodes say "Theory only. Leave wiring to a licensed electrician." | `/api/techtree`, `/api/techtree/{id}` | `get_technology_node`, `get_prerequisites` |
| `guide:<kb-id>`, `search` | Vault | Guide entries with their sources, and search results | `/api/knowledge` | `search_knowledge` |
| `why:<target>` | any | "How do we know?": the working, the basis (guideline or planning default) and the source link | `/api/readiness` (`targets[].working/explain/source`), `/api/sources` | the "Why?" link on any number |
| `memory` | any | "I'll remember that" (shown as suggested) | `/api/memory` | `remember_note` |

Each card renders from API data. The model only picks which card to show and what it filters on.

### 5. How the chat drives the canvas
- Today, tools append `ui_hints` such as `{"open": "prepare"}` or `{"open": "rebuild", "node": id}` (`backend/app/agent/tools.py`), and `chat.js` navigates.
- Extend these hints in a backward-compatible way, keeping `open` so Advanced still works:
  `{"open": "prepare", "card": {"type": "category", "key": "water"}, "focus": "have", "action_id": "<pending action id or null>"}`
- Hints are derived **deterministically in each tool function**, never from model text.
- Optional: a read tool `show_card(type, key)` so the model can show something without calling another tool, e.g. "show me my profile".
- The chat request body gains `canvas` (the current canvas), `cards` (ids of visible cards) and `focused_card` (set when the user tapped a card and then typed). Add these to the per-turn context in `backend/app/agent/persona.py`, so Prometheus knows what's on screen and what "this" means.

### 6. Pencil previews (an honest before → after)
- New endpoint `GET /api/actions/{id}/preview`. It applies the pending action to an in-memory copy of the profile and inventory, recomputes readiness and the summary, and returns before/after values for every affected number: target `have`, days, and the stage "left" count. It's deterministic and makes no AI call.
- Cards show a pending action as a dashed amber **pencil value** next to the real value, with **Save / Edit / No**. Save calls the existing `POST /api/actions/{id}/approve`.

### 7. The flame's choreography
Owner's idea: *"it's on the chat first, then he flies once there's stuff it needs to do on the canvas, then flies back… when we change a figure or number it goes to that number (on top of it) and once it leaves it's changed!"*

```
In chat:   thinking…
Flies out: ⤴  the camera glides so the Water card is visible
Hovers:    sits on top of "60 L" while "65 L?" appears in pencil   [Save] [No]
           (in Ask-first mode it then flies back to the chat to wait, so it doesn't block anything)
You tap Save: it flies to the number again, settles on it ✨, lifts off → "65 L"
Ripple:    every other card whose numbers changed glows briefly (Next up ticks ✓, stages says "7 left")
Flies home: ⤵  back to the chat
```

- **Its home is the chat-panel avatar.** While it's away, the avatar spot shows an empty seat and "on Prepare…".
- **The real value only changes when it lifts off**, after the approve request succeeds. If the request fails, it shows the error face and the value stays the same. On **No**, the pencil value fades and it shows the sad face.
- **Read-only answers:** it flies to the number, hovers over it as if pointing, then flies back.
- **Other canvases:** it flies to that tab first, the canvas switches, then it continues.
- **Many changes at once:** it visits at most 3 numbers, then lands on the card as a whole.
- **About 0.7 s per flight. Any click or key press skips to the end state.** With reduced motion, there's no flight, just a highlight and a crossfade.
- **Face presets in `face.js`:**
  - flying: `look-right`
  - hovering: `look-down`
  - waiting for approval: `wink`
  - stamping: `glee`
  - rejected: `sad`
  - failed: `error`
- **Implementation:**
  - Use one `position: fixed` `.face` element. Check that `face.js` also mounts `.face` elements added after the page loads; today it mirrors one live face onto every `.face`.
  - Animate with the Web Animations API along points sampled from a curved path, from the avatar's rect to the target number's rect.
  - Pan the camera first.
  - Mark numbers with something like `data-num="water.have"` so the flame can find them.

### 8. Permission modes (like Claude Code)
A chip at the bottom left of the chat composer: tap it for the menu, or press **Shift+Tab** to cycle. It's remembered per household in `localStorage`. **The owner chose exactly 3 modes:**

| Mode | Prometheus | Flame | Look |
|---|---|---|---|
| **Ask first** (default) | Shows every change as a pencil preview and waits | Hovers and pencils it in; you Save; it stamps and leaves | neutral |
| **Auto** | Saves small, undoable changes itself and still asks for big ones | Stamps straight away; an **Undo** chip stays on the card for a few seconds | orange glow on the chip |
| **Plan** | Only looks and drafts; changes nothing until you approve the plan | Flies around pencilling in every change, then returns with "N changes ready" **[Approve all] [Review]**. Approve all is a stamping tour | the canvas turns into a **blueprint** (blue tint, dashed outlines) |

- **What counts as small in Auto:** supply amounts, broken/used up, ticking tasks and plan steps, adding to the shopping list. It still asks for household profile changes and saving survival plans.
- **Number check:** in Auto, a quantity change saves automatically only if **the number appears literally in the user's latest message**. "I bought 5 L of water" saves straight away. "I bought a slab of water" asks first, because Prometheus had to guess.
- **Always asks, in every mode:** deleting anything, resetting the household, clearing memory. Memory notes about the user stay "suggested".
- **What changed + Undo:** every automatic save is listed under "What changed" in the Simple menu (Advanced keeps the raw tool log). Before applying an action, store a `before` snapshot so a new `POST /api/actions/{id}/undo` can restore it.
- **Server side:**
  - The chat request sends `permission_mode`.
  - After a propose tool creates a pending action, the loop auto-approves eligible ones through the same `execute_action()` path, logging the effect as `auto_approved`.
  - Plan mode adds an instruction to the persona to draft every change as proposals in one go. The frontend shows that turn's pending actions as pencils, with Approve all.
- **Emergency mode isn't affected.** Ticking off steps is always instant.

### 9. Readiness in stages (replaces the % in Simple mode)
- **Stages:** 3 days, 1 week, 2 weeks and the goal (`profile.duration_days`), deduplicated and capped at the goal.
- **Each stage** is `calculate_readiness()` with `duration_days` overridden. A stage is reached when every target's status is `met`.
- **The current stage** is the first one not reached. **Next up** is `missing_supplies()` for that stage, in its existing priority order.
- **New `GET /api/summary`**, roughly: `{stages: [{days, label, reached, left}], current, next_up: [{title, target_key, quantity, unit}], categories: [{key, label, have_text, need_text, days, status}], water_days, food_days, expiring: [...]}`.
- **Human units:**
  - Water: "60 L · about 3 days"
  - Food: kcal ÷ the household's daily kcal → "about 4 days of food for everyone"
  - Medicine and pet food: days
  - Gear: counts, like "2 of 5 torches"
- **Write tests** for it with the demo household. Numbers to check against, computed on 2026-10-29 with the demo inventory:
  - The 3-day stage is short of: water 1.5 L, manual can opener 1, bin bags 15, copies of documents 1 set, torches 3, power bank 1, battery sets 2, soap 1. That's **8 left**.
  - Adding 5 L of water (60 → 65 L) meets 3-day water, leaving **7**.
  - Water days 2.9, food days 3.9.
  - The 7-day stage is short 27,400 kcal of food, about 3.1 days for everyone (daily need 8,800 kcal).
- Advanced keeps the % and the full table.

### 10. Emergency (SOS) takeover
A red **SOS** button sits in the top bar on every canvas. It opens a full-screen view: high-contrast dark, no animation, big buttons.
1. **"Is anyone hurt or in danger?"** Yes → a big **Call 000** button (a `tel:` link) and first-aid basics.
2. **"What's happening?"** Power out (blackout) · Can't get supplies · Storm, flood or fire cut us off. The zombie drill lives only on the Survive canvas, clearly labelled as fiction.
3. **Safety check, one question per screen**, using the scenario's `triage_questions`. A dangerous answer shows the urgent instruction from the existing vault entries first. This needs a small mapping in `scenarios.json` to kb ids; use only vault text, never invented text.
4. **Steps one card at a time:** Right now → Today → Keep doing (step priority `immediate` / `today` / `ongoing`). Each card shows "You have: …" from the guide's `household` data, a "Why?" link to the vault entry, and **Done ✓**.
5. **"Back to normal"** → "Restock what you used?" → back to Prepare.

It works without AI. Later: make it a PWA (a manifest, plus a service worker caching the app shell, scenarios, knowledge and the last household snapshot) and add a **printable one-page emergency card**. For the emergency number, show the existing "000 (AU) · 911 (US) · 112" text unless a sourced country table gets added.

### 11. First-run setup
- With an empty household, the flame sits in the middle of the Prepare canvas and the chat says "Tell me who lives with you."
- The **Household card fills in live** with pencil values (from `update_household_profile` proposals), then the user taps Save.
- The card also has **"Fill in myself"**: inline steppers for adults, children, pets, medicine, and a 3/7/14/30-day goal.
- Then a **Quick check** card: tap the common items you already have.
- Also offer "Try the demo family".

### 12. Look and words
- **Brand colours** from `frontend/assets/emblem.svg`: orange `#ff8a1f`, yellow `#ffd23f`, core pink `#d61f5f`. Use a warm palette, not teal.
- **Status colours** are for status only and always come with an icon and a word.
- **Type:** one sans-serif font, 17px body text on phones, no monospace or letter-spaced capitals in Simple.
- **Theme:** follow the device, designed light-first (a warm off-white) with a warm charcoal dark theme. SOS is always high-contrast dark. Plan mode uses a blueprint tint.
- **Put Simple's styles in `frontend/simple.css`** so Advanced's `styles.css` stays untouched.
- **Copy rules:** start with a verb, use human units, write in sentence case, keep it short.

| Today | Simple |
|---|---|
| Proposal: needs your approval / Approve / Reject | Save / Edit / No (on the card) |
| Thinking with Nemotron… (reading your data via tools) | Checking your supplies… |
| Triage: answer these first | Quick safety check |
| Smart survival kit · 5 PEOPLE · 1 PETS · 30 DAYS | Your kit |
| Condition: Unavailable | Broken or used up |
| Cloud AI configured · Offline data ready | (hidden; show "No internet. Your plan and guides still work." only when offline) |
| Tier 3 · technology | Lesson 5 |

### 13. Not now / open items
- **A quick-add catalogue** (common items with kcal pre-filled) needs real, cited sourcing. **Don't invent nutrition numbers.** Skip it, or let the user or AI provide kcal.
- **A country → emergency-number table** also needs sourcing.
- Household sharing across devices, reminders and notifications, voice.

## Build plan

Work top to bottom. After each phase:
1. Run `python3 -m pytest -q --ignore=tests/test_nebius_live.py`. The baseline on 2026-10-29 was **53 passed**.
2. Take Playwright screenshots at desktop 1440×900 and phone 390×844 into `docs/screenshots/redesign/`.
3. Check that `advanced.html` still works: each nav mode renders and there are no console errors.
4. Commit, push, and tick the boxes below.

**Phase 1: Shell and the Prepare canvas**
- [x] Move the current UI to `advanced.html`, add the new Simple `index.html` shell, and the toggles both ways
- [x] `simple.css`: tokens, light and dark themes, phone layout
- [x] Canvas engine: pan/zoom, dot grid, card drag, semantic zoom, controls, the "+" drawer, saving layouts, keyboard support
- [x] `GET /api/summary` with tests
- [x] Prepare cards: `stages`, `next`, `category:*`, `household`, `expiring`
- [x] Simple chat panel: history, send, approvals as Save / No

**Phase 2: The chat drives the canvas**
- [x] Card ops in `ui_hints` (with tests); visible cards sent in the chat context
- [x] `GET /api/actions/{id}/preview` and pencil values on cards
- [x] Flame flight choreography, ripple, edge pointers, switching canvases

**Phase 3: Permission modes**
- [x] Chip + Shift+Tab: Ask first / Auto / Plan
- [x] Auto: what counts as small, the number check, the undo endpoint, "What changed"
- [x] Plan: blueprint look, Approve all, stamping tour

**Phase 4: The other canvases**
- [x] Survive, Rebuild (path + lesson) and Vault (search + guide) cards

**Phase 5: SOS**
- [x] Takeover flow
- [x] PWA offline + printable emergency card

**Phase 6: First-run setup**
- [x] Household card filling in live, "Fill in myself", Quick check

**Phase 7: Polish**
- [x] Phone pass, accessibility pass, reduced motion; update README, FEATURES.md and screenshots

## Testing notes
- **Running it:** `pip install -r requirements.txt`, then `uvicorn backend.app.main:app --port 8000`. Node Playwright is preinstalled in the cloud container (`require('playwright')`, `chromium.launch()`). Python Playwright isn't.
- **Live AI:** `NEBIUS_API_KEY` is set in the cloud container's environment, so live chat can be tried there. Never print the key. Unit tests use `FakeClient` in `tests/conftest.py`.
- **Demo data:** `POST /api/household/demo` loads the demo household (Settings → Load demo household in Advanced).

## Decisions made while the owner was away
_(Append each default you had to pick, with a one-line reason.)_

- **Phone canvas is a stack.** At ≤ 760px the cards sit in one column with normal scrolling (no free pan or zoom), which matches the phone sketch and lets a sideways swipe switch canvases without fighting a pan.
- **Food in Next up opens the Food card** instead of a tick box. Ticking would add raw kcal, which isn't something a person buys.
- **Ticking a Next up item uses the stage's amount.** It completes an open task only if that task has the same amount; otherwise it creates one for the stage. An old 30-day restock task (say 555 L) would otherwise add the wrong amount.
- **Days are shown as calculated** ("60 L · 2.9 days"), not rounded to "about 3 days", because 2.9 is short of the 3-day stage and the card says so.
- **Uncounted food asks for kcal from the label** ("kcal per can? (on the label)") and nothing is guessed, per the "don't invent nutrition numbers" rule.
- **Compact cards keep their full-size footprint**, so zooming out gives a readable map without the layout jumping.
- **Cards use the current stage.** Category cards show have vs need for the stage you're working on (the goal once every stage is reached); the Stages card shows the rest.
- **Summary data lives in `backend/app/prepare/summary.py`**; Simple's JS lives in `frontend/js/simple/` (cards in `cards/`).
- **Hint priority.** Each card hint has `priority`: 2 = a change waits on this card, 1 = what the turn was about, 0 = background reading (e.g. the profile, which the model reads on most turns). Simple shows at most 3 cards per turn, and priority-0 cards only when nothing else came up and they belong on the current canvas. This keeps the canvas from filling up.
- **`open` stays exactly where it was.** New hints only add `card` (and `focus`, `action_id`, `filter`), so Advanced mode, which reads `open`, behaves as before.
- **Pencils compare rendered cards.** The frontend renders each card a second time with the preview data (`GET /api/actions/preview?ids=…`, which applies all pending changes in order) and shows a pencil wherever a `data-num` text differs. Card formatting stays in one place.
- **Edit is real.** `POST /api/actions/{id}/edit` changes a pending proposal (re-validated with the tool's own models) and marks it "(edited by you)". On approve, the event the model sees says the user edited it.
- **The prompt gets card names, not ids** ("Cards on screen: Ready in stages, Water"). With ids, the model repeated "light_power" to the user.
- **A tool-result instruction changed.** It used to say "Approve or Reject"; it now says the change is "saved only when they approve it in the app", which fits both modes' buttons.
- **Cards that grow push the cards below them down** (`settle()`), so a pencil line or form never overlaps a neighbour.
- **Shift+Tab only cycles modes inside the message box.** Everywhere else it still moves focus backwards, so keyboard users aren't stuck; Tab still leaves the box.
- **"Save all", not "Approve all"**, following the copy rule (Save / Edit / No). It appears under any reply that left two or more changes waiting, not only in Plan mode.
- **Auto's number check accepts the new amount or the difference.** "We drank 2 L" may become quantity 60 → 58; 2 is in the message, so it saves. Thousands separators are understood ("20,000"); words like "a dozen" always ask.
- **Undo works for any saved change** (`POST /api/actions/{id}/undo`, from a snapshot taken just before applying). The chat offers it after every save; "What changed" lists only Auto's saves, as designed.
- **Auto saves aren't written into the chat as events during the turn.** The model learns from its own tool result (`status: saved_automatically`), which keeps tool calls and results next to each other in the history. Undo does add an event, so the model knows.
- **New columns `before_json` and `resolved_by`** on `pending_actions`, added on startup to older database files.
- **A "What's happening?" card picks the scenario** on Survive (the zombie drill is listed as "Zombie drill · Fiction"). The table had no picker, and something has to choose.
- **Guides, "How do we know?" and Memory open on the canvas you're on**, because they're reference cards. A "Why?" on a Survive step shouldn't throw you over to the Vault tab. Guides are still listed in the Vault's drawer.
- **Scenario cards fold "Today" and "Keep doing"** behind a tap; "Right now" is always open. Unfolded, the blackout card was over 1,100px tall.
- **Lesson numbers follow tier order**, and a tier with several nodes shows "Choose next" (3 · 4 · 5).
- **Fixed a material match in `electricity.json`.** "Notebook & pencil" matched "paper" and "pen", so toilet paper and a can opener counted as a notebook and a pen (in Advanced too). It now matches notebook, pencil and notepad, with a test.
- **Each card type declares its width** in the registry, so the first layout is right even while a card is still loading.
- **SOS triage mapping** lives in `scenarios.json` as `triage[i]` next to `triage_questions[i]`: `danger` (which answer is dangerous), `kb` (vault entries to show, using only their own text), `call` (add the Call 000 button), or `show: supplies` for the "how many days do you have" question, which shows the household's numbers instead of yes/no. A test checks that every id exists. "Gas, smoke or fallen power lines" has no vault entry of its own, so it shows first aid basics ("Check for danger…", "Call emergency services…") with Call 000, not invented text.
- **SOS steps come from your saved plan** for that scenario if there is one (Done ticks the real plan step, instantly), otherwise from the scenario's guideline steps (Done is remembered for the browser session).
- **"You have: …" on a step** is matched by keywords in the step text (radio, torch, water, food, phone/charger, first aid) against the scenario guide's household data.
- **Offline is network-first** (`frontend/sw.js`): online you always get fresh code and data; offline you get the last copy of the app shell, scenarios, guides, the tech tree and the household snapshot. Chat and changes need the server and say so.
- **The emergency card** ("Print emergency card" in the menu) prints who lives here, what you have, the emergency numbers and the saved plan (or the blackout steps). It's built from saved data only.
- **First run** means the profile isn't confirmed and nothing is recorded. Prepare then opens with the Household and Quick check cards, the flame waits at the bottom middle ("Tell me who lives with you." · Fill in myself · Try the demo family) so it doesn't cover them, and the chat suggests "It's just me" and similar. Once the household is saved, Ready in stages and Next up appear.
- **Quick check covers counted gear only** (torch, radio, first aid kit, can opener, power bank, batteries, bin bags, toilet paper, soap, documents). Tapping one asks "how many?" (default 1) and adds it. Water and food need amounts, so they link to their own cards.
- **Every Household line has a `data-num`** (people, pets, goal, medicine), so a profile proposal from the chat shows up in pencil on the card.
- **Edge pointers only point at cards you can't see at all.** A card that's half on screen doesn't get a "changed →" chip on top of it.
- **Accessibility pass with axe-core**: no violations on any canvas or SOS, in light and dark. Cards are `div role="group"` with `h2` titles, the page has a visually hidden `h1` ("Prometheus: Prepare"), the brand text colour got darker (`#9c4700`) to pass contrast on the selected tab, and everything behind SOS is `inert` while it's open.
- **Phone first run**: the welcome is the first item in the card stack, not floating over the cards.
- **Tool count is now 16** (`show_card`), updated in README and DEVPOST.md. DEMO_SCRIPT.md has a Simple-mode version of the demo next to the original.
- **Checks run for each phase**: pytest (81 passed, plus the 3 live Nemotron tests), Playwright at 1440×900 and 390×844, and Advanced mode (each nav view renders, no console errors).
- **Owner change (2026-10-29): Simple mode uses the original look.** The owner said the warm light palette didn't look like the app. `simple.css` now uses Advanced's tokens (dark `#121513` panels, teal `#4fd1b5` accent, amber for pencils, same font), dark only. Only the layout is simpler. This replaces the "warm palette, not teal" and "light-first" points in [Look and words](#12-look-and-words). Some older screenshots in `docs/screenshots/redesign/` still show the warm palette.
- **Owner change: both looks, with a toggle.** Dark (the original look) is the default. The sun/moon button in the top bar (or "Light look" in the ≡ menu on phones) switches to the warm light look, remembered in this browser (`localStorage["prometheus.theme"]`) and applied before the page draws.
- **Owner change: Next up also shows saved tasks** under "Your list" (open tasks from approved restock lists or your own), replacing Advanced's "Active tasks" sidebar section. Ticking one completes it and, if it names an amount, adds that to supplies. Tasks that match a stage item exactly aren't listed twice.
- **Owner change: `/` always opens Simple mode, in the light look.** The remembered "Advanced" redirect is gone (it sent returning visitors to the old UI); Advanced is one tap away in the ≡ menu. Light is now the default look; the moon button switches to dark, and only a tap is remembered (`localStorage["prometheus.look"]`).

