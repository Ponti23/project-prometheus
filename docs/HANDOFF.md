# Handoff: where the project stands

Use this to resume work in a fresh session. _Updated: 2026-10-29._

**Hackathon:** Nebius × NVIDIA Global AI Hackathon, Personal AI track. **Deadline: Oct 30, 2026, 10:00 AM PDT.**
**Branch:** `main` (the default branch; renamed from `prometheus-mvp`). The repo is public.

## Done
- The full MVP is built and committed. See [FEATURES.md](FEATURES.md) for the status of each feature.
- `pytest`: 53 passed, including the 3 live Nebius tests (they skip without `NEBIUS_API_KEY`).
- Real Nebius verified: `scripts/verify_nebius.py` and the live tests pass on both `nvidia/Nemotron-3_5-Lightning` and `nvidia/nemotron-3-super-120b-a12b`.
- The full demo was run in the browser against the real model. It found and fixed duplicate restock tasks (two overlapping proposals both approved) and `search_knowledge` returning nothing when the model passed a scenario id as the topic.
- The browser flow was checked with Playwright: demo household → chat → approve restock tasks → "Done + add to inventory" → shortage recalculates → chat opens the Rebuild node → reload keeps all state. That run used a scripted stand-in model (UI test only, not in the repo).
- Prometheus has a face: a fire spirit (`frontend/js/face.js`) with Notch Face Kit eyes that reacts to chat state. It's also the sidebar logo and favicon (`frontend/assets/emblem.svg`).

## Key decisions
- Stack: FastAPI + stdlib SQLite + vanilla JS (no build step). Each household is isolated by the `prometheus_household` cookie.
- LLM: plain `httpx` to `https://api.tokenfactory.nebius.com/v1/chat/completions` with OpenAI-style `tools`. Default model is the brief's `nvidia/Nemotron-3_5-Lightning`.
  - **Known issue:** with long conversations (~15k prompt tokens, e.g. the 4th demo scene) Lightning sometimes replies with the literal text `[ERROR: Max turns (10) exceeded]` and calls no tools (2 of 3 demo runs). Super 120B didn't do this in 2 runs. To switch, set `NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b`.
- Write tools only create `pending_actions`. `POST /api/actions/{id}/approve` → `execute_action()` in `backend/app/agent/tools.py` is the only path that changes state.
- Planning numbers live in `data/assumptions.json`. Citable links live only in `data/sources.json` (all `checked: false` for now).
- Hosting choice: Nebius AI Cloud (Docker + persistent `/data` volume). Not deployed yet: it needs the user's approval because it costs money.

## Next steps (in order)
1. ~~Verify the Nebius key and model~~ (done).
2. ~~Run the live tests~~ (done).
3. Demo polish still open: decide on the model (see the known issue above); the model rarely puts source links in replies, and sometimes asks before proposing the survival plan. Rehearse with [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
4. Run `python scripts/check_sources.py --write` on a normally connected machine and commit the result.
5. Deploy following [DEPLOY.md](DEPLOY.md) (after the user approves). Confirm `/api/ai/verify` returns `ok: true` on the hosted URL.
6. Record the video (under 3 minutes), and submit on Devpost.
