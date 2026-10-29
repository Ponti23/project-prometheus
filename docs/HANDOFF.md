# Handoff: where the project stands

Use this to resume work in a fresh session. _Updated: 2026-10-29._

**Hackathon:** Nebius × NVIDIA Global AI Hackathon, Personal AI track. **Deadline: Oct 30, 2026, 10:00 AM PDT.**
**Branch:** `prometheus-mvp` (the first and only branch; there's no `main` yet).

## Done
- The full MVP is built and committed. See [FEATURES.md](FEATURES.md) for the status of each feature.
- `pytest`: 50 passed, including the 3 live Nebius tests (run with `NEBIUS_API_KEY` set).
- `scripts/verify_nebius.py` confirmed real Nemotron tool calling through Token Factory (~1 s latency).
- The browser flow was checked with Playwright: demo household → chat → approve restock tasks → "Done + add to inventory" → shortage recalculates → chat opens the Rebuild node → reload keeps all state. That run used a scripted stand-in model (UI test only, not in the repo).

## Key decisions
- Stack: FastAPI + stdlib SQLite + vanilla JS (no build step). Each household is isolated by the `prometheus_household` cookie.
- LLM: plain `httpx` to `https://api.tokenfactory.nebius.com/v1/chat/completions` with OpenAI-style `tools`. Default model `nvidia/nemotron-3-super-120b-a12b` (verified: it returns `tool_calls`). `nvidia/Nemotron-3_5-Lightning` (the brief's model) is now listed too, but hasn't been tested.
- Write tools only create `pending_actions`. `POST /api/actions/{id}/approve` → `execute_action()` in `backend/app/agent/tools.py` is the only path that changes state.
- Planning numbers live in `data/assumptions.json`. Citable links live only in `data/sources.json` (all `checked: false` for now).
- Hosting choice: Nebius AI Cloud (Docker + persistent `/data` volume). Not deployed yet: it needs the user's approval because it costs money.

## Next steps (in order)
1. ~~Verify Nebius + live tests~~ (done). Note: in a cloud session, `pip install -r requirements.txt` can hang on the `uvicorn[standard]` extras; install the packages individually.
2. ~~Live demo rehearsal via the API~~ (done: every scene triggers the scripted tools and proposals). Still worth one rehearsal in the browser before recording.
3. Run `python scripts/check_sources.py --write` on a normally connected machine and commit the result.
4. Deploy: the user runs `bash scripts/deploy_nebius.sh` on their machine (approved; this session has no Nebius Cloud credentials and nebius.cloud is blocked). It ends by checking `/api/ai/verify` on the HTTPS URL. See [DEPLOY.md](DEPLOY.md).
5. Make the repo public, merge into a default branch, record the video (under 3 minutes), and submit on Devpost.
