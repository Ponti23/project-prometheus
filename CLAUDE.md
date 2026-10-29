# Project Prometheus

An AI preparedness companion: FastAPI + stdlib SQLite + vanilla JS with no build step. See [README.md](README.md) and [docs/HANDOFF.md](docs/HANDOFF.md).

## Active work: UI redesign
Read [docs/REDESIGN.md](docs/REDESIGN.md) first and follow it. It holds the agreed design, the owner's decisions, the build plan with checkboxes and the ground rules:
- Don't break Advanced mode.
- Keep the honesty rules.
- Push to `claude/charming-bell-9gytjt` only.
- No merge to `main` and no PR unless the owner asks.

## Commands
- `pip install -r requirements.txt`
- `python3 -m pytest -q --ignore=tests/test_nebius_live.py` (the live tests call the real API)
- `uvicorn backend.app.main:app --port 8000`
