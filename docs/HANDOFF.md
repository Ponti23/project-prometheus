# Handoff: where the project stands

Use this to resume work in a fresh session. _Updated: 2026-10-29._

**Hackathon:** Nebius × NVIDIA Global AI Hackathon, Personal AI track. **Deadline: Oct 30, 2026, 10:00 AM PDT.**
**Branch:** `prometheus-mvp` (the first and only branch; there's no `main` yet).

## Done
- The full MVP is built and committed. See [FEATURES.md](FEATURES.md) for the status of each feature.
- `pytest`: 47 passed, 3 skipped. The skipped ones are the live Nebius tests, which need `NEBIUS_API_KEY`.
- The browser flow was checked with Playwright: demo household → chat → approve restock tasks → "Done + add to inventory" → shortage recalculates → chat opens the Rebuild node → reload keeps all state. That run used a scripted stand-in model (UI test only, not in the repo).

## Key decisions
- Stack: FastAPI + stdlib SQLite + vanilla JS (no build step). Each household is isolated by the `prometheus_household` cookie.
- LLM: plain `httpx` to `https://api.tokenfactory.nebius.com/v1/chat/completions` with OpenAI-style `tools`. Default model `nvidia/nemotron-3-super-120b-a12b` (**unverified**). The brief's `nvidia/Nemotron-3_5-Lightning` wasn't found.
- Write tools only create `pending_actions`. `POST /api/actions/{id}/approve` → `execute_action()` in `backend/app/agent/tools.py` is the only path that changes state.
- Planning numbers live in `data/assumptions.json`. Citable links live only in `data/sources.json` (all `checked: false` for now).
- Hosting choice: Nebius AI Cloud (Docker + persistent `/data` volume). Not deployed yet: it needs the user's approval because it costs money.

## Next steps (in order)
1. Get a Nebius key, put it in `.env`, then run `python scripts/verify_nebius.py`. Set `NEBIUS_MODEL` to a real Nemotron ID from its output.
2. Run `pytest tests/test_nebius_live.py -v -s`. If the model skips tools, tune `backend/app/agent/persona.py`.
   - In a Claude cloud session, `api.tokenfactory.nebius.com` must first be added to the environment's Allowed domains, and the key added as `NEBIUS_API_KEY`.
3. Do a real demo run using [DEMO_SCRIPT.md](DEMO_SCRIPT.md) and fix anything rough.
4. Run `python scripts/check_sources.py --write` on a normally connected machine and commit the result.
5. Deploy following [DEPLOY.md](DEPLOY.md) (after the user approves). Confirm `/api/ai/verify` returns `ok: true` on the hosted URL.
6. Make the repo public, merge into a default branch, record the video (under 3 minutes), and submit on Devpost.
