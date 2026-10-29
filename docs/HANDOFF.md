# Handoff: where the project stands

Use this to resume work in a fresh session. _Updated: 2026-10-29._

**Hackathon:** Nebius × NVIDIA Global AI Hackathon, Personal AI track. **Deadline: Oct 30, 2026, 10:00 AM PDT.**
**Branch:** `main` (the default branch; renamed from `prometheus-mvp`). The repo is public.

## UI redesign: built, on a branch
A friendlier **Simple mode** (an AI-native canvas), with today's UI kept as **Advanced mode**. All seven phases in [REDESIGN.md](REDESIGN.md) are built and pushed to `claude/charming-bell-9gytjt` (not merged to `main`, no PR). The defaults picked while the owner was away are listed at the end of REDESIGN.md. Screenshots are in `docs/screenshots/redesign/`. To ship it, merge the branch to `main` (Render redeploys).

## Done
- The full MVP is built and committed. See [FEATURES.md](FEATURES.md) for the status of each feature.
- `pytest`: 56 passed, including the 3 live Nebius tests (they skip without `NEBIUS_API_KEY`).
- Real Nebius verified: `scripts/verify_nebius.py` and the live tests pass on both `nvidia/Nemotron-3_5-Lightning` and `nvidia/nemotron-3-super-120b-a12b`.
- The full demo was run in the browser against the real model. It found and fixed duplicate restock tasks (two overlapping proposals both approved) and `search_knowledge` returning nothing when the model passed a scenario id as the topic.
- The browser flow was checked with Playwright: demo household → chat → approve restock tasks → "Done + add to inventory" → shortage recalculates → chat opens the Rebuild node → reload keeps all state. That run used a scripted stand-in model (UI test only, not in the repo).
- **Deployed (free):** https://project-prometheus-tp0i.onrender.com on Render's free plan from `render.yaml`. `NEBIUS_API_KEY` is set in Render. Render redeploys on every push to `main`. **Smoke test live app** (`scripts/smoke_test.py --chat`) passed with 0 failures, including a real Nemotron chat turn.
- Hugging Face Spaces was tried first and dropped: Docker Spaces now need a PRO subscription (402). The `HF_TOKEN` repo secret is unused and can be deleted.
- Citation links: the **Check source links** workflow got 200 for 16 of 21 sources, now `checked: true`. Ready.gov (4) and esfi.org returned 403 to the script (likely bot blocking) and stay `false` until checked in a browser.
- Prometheus has a face: a fire spirit (`frontend/js/face.js`) with Notch Face Kit eyes that reacts to chat state. It's also the sidebar logo and favicon (`frontend/assets/emblem.svg`).

## Key decisions
- Stack: FastAPI + stdlib SQLite + vanilla JS (no build step). Each household is isolated by the `prometheus_household` cookie.
- LLM: plain `httpx` to `https://api.tokenfactory.nebius.com/v1/chat/completions` with OpenAI-style `tools`. Default model `nvidia/nemotron-3-super-120b-a12b`.
  - **Why not the brief's `nvidia/Nemotron-3_5-Lightning`:** with long conversations (~15k prompt tokens, e.g. the 4th demo scene) Lightning sometimes replies with the literal text `[ERROR: Max turns (10) exceeded]` and calls no tools (2 of 3 demo runs). Super 120B didn't do this in 2 runs. To try Lightning anyway, set `NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning`.
- Citations in the chat come from tool results, not the model's text: `collect_sources()` in `backend/app/agent/loop.py`.
- Write tools only create `pending_actions`. `POST /api/actions/{id}/approve` → `execute_action()` in `backend/app/agent/tools.py` is the only path that changes state.
- Planning numbers live in `data/assumptions.json`. Citable links live only in `data/sources.json`.
- Hosting: free Render web service from `render.yaml` (Blueprint, `NEBIUS_API_KEY` entered in Render). Kept awake by `.github/workflows/keep-awake.yml` (visits every 10 minutes; the URL is built in, `APP_URL` overrides it). The disk is not persistent, so redeploys wipe households. See [DEPLOY.md](DEPLOY.md).

## Next steps (in order)
1. ~~Verify the Nebius key and model~~ (done).
2. ~~Run the live tests~~ (done).
3. Rehearse with [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Source links and the survival plan are now reliable: every reply shows a **Sources** footer built from what its tools returned (`meta.sources`), and if the model answers an emergency without proposing a plan, the loop gives it one extra round to propose it (3/3 live runs proposed a plan).
4. ~~Check source links~~ (16/21 done). Open the 4 Ready.gov pages and esfi.org in a browser and mark them `checked: true` if they load.
5. ~~Deploy~~ (done, free on Render; smoke test passed).
6. Record the video (under 3 minutes) on the live URL, add its link to [DEVPOST.md](DEVPOST.md), check the Devpost rules on disclosing AI coding tools, paste DEVPOST.md into Devpost with the images in `docs/screenshots/` and submit.

## Keeping the demo up after submission
- **Don't push to `main` during judging.** Every push redeploys on Render and wipes saved households (judges just click **Load demo household** again, but a broken build would take the site down).
- **Keep-awake** pings the site every 10 minutes from GitHub Actions. GitHub turns off scheduled workflows after 60 days with no repo activity, which is well past judging.
- **Render free plan:** 750 hours a month covers one always-on service. Render doesn't delete idle free web services.
- **Nebius credits:** chat stops working if the Token Factory balance runs out. Check the balance before leaving, and top it up if it's low. The app's per-household rate limit keeps usage small.
- Render emails the account owner if a deploy fails. GitHub emails you if keep-awake starts failing.

