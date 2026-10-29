# Implementation plan & checklist

Deadline: **Oct 30, 2026, 10:00 AM PDT**. The priority is a reliable, honest demo over breadth.

## Phase 0: Audit & setup
- [x] Repo was empty, so we started fresh: FastAPI + SQLite + vanilla JS.
- [x] `.env.example`, `.gitignore`, Apache-2.0 license, Windows instructions.
- [x] Nebius endpoint confirmed as `https://api.tokenfactory.nebius.com/v1/` (OpenAI-compatible).
- [x] Confirm the Nemotron model ID with a real key (`scripts/verify_nebius.py`). Default is the brief's `nvidia/Nemotron-3_5-Lightning`.

## Phase 1: Core AI companion
- [x] SQLite store, typed schemas, per-browser household.
- [x] Tool registry (read / propose / note) with Pydantic validation and inlined JSON schemas.
- [x] Agent loop: bounded rounds, malformed-call handling, a trace for every round.
- [x] Approval flow: pending actions → approve/reject → app event fed back to the model.
- [x] Persona + context snapshot; persistent history; memory notes with provenance.
- [ ] **Live test with a key**: `pytest tests/test_nebius_live.py -v -s`. Tune the prompt if the model skips tools.

## Phase 2: Prepare
- [x] Profile, calculator, inventory, readiness, shortages, restock tasks, task completion → inventory.

## Phase 3: Survive
- [x] Blackout scenario, knowledge vault, plan creation with validated references, progress tracking.

## Phase 4: Rebuild
- [x] Electricity DAG with validation, SVG tree UI, companion integration.

## Phase 5: Polish & submission
- [x] Dark lab UI, emblem activity states, status labels + icons (not colour alone), responsive layout.
- [ ] Run `scripts/check_sources.py --write` on a normally connected machine.
- [ ] Deploy to Nebius AI Cloud (see DEPLOY.md). **Needs your approval.**
- [ ] Record the < 3 min video (DEMO_SCRIPT.md), push the repo public, fill in Devpost.

## Known risks
- The model may answer without calling tools. Mitigation: the persona instructs it to use tools, and the live test asserts tool use. If needed, use a larger Nemotron or lower the temperature.
- Reasoning models may emit `<think>` blocks. These are stripped in `clean_content`.
- Hosting persistence: SQLite needs a persistent volume. A serverless platform without disks will lose data.
