# Devpost submission draft

Copy each section into the matching field on the Devpost project page. Gallery images are in [screenshots/](screenshots/).

## Project name
Project Prometheus: Humanity's Backup Brain

## Elevator pitch (200 characters max)
An AI apocalypse buddy on NVIDIA Nemotron + Nebius that knows your household, tracks your supplies, guides you through emergencies, and teaches the science to rebuild. Prepare. Survive. Rebuild.

## About the project

```markdown
## Inspiration
Most of us are one blackout, bushfire or supply disruption away from realising we have no plan. Preparedness advice is scattered across government sites and PDFs, it's generic, and nobody reads it until the power is already out. We wanted a *personal* AI that already knows your family, your pets, your medication and what's in your cupboard, and that stays useful from the calm "prepare" phase all the way to "how do we restore power ourselves?"

## What it does
Prometheus is one continuous AI companion, a little fire spirit whose face reacts as it listens, thinks and answers, with three modes:

- **Prepare:** build a household profile (people, pets, medication, a 3/7/14/30-day plan). Prometheus computes supply targets from cited guidelines, tracks your inventory with expiry dates, finds shortages, and proposes restock tasks that **you approve**.
- **Survive:** scenario guides (extended blackout, supply disruption, isolation, plus a clearly labelled *fictional* zombie drill). Each one starts with triage questions, shows your household's real resource picture (days of water and food, lighting, radio), and turns into a saved, checkable response plan with sources.
- **Rebuild:** an interactive electricity technology tree, from "Energy & power" to "Small off-grid DC power". It shows prerequisites, learning paths, the materials you have or lack, and safety gating (mains wiring stays professional-only).
- **Knowledge Vault:** 20 curated offline entries, linked to sources such as the Australian Red Cross, Emergency WA, Ready.gov, CDC, FoodSafety.gov, OpenStax and PhET.

The companion drives all of it through **15 real tools** that read and write your saved data, and it remembers you across sessions.

## How we built it
- **Model:** NVIDIA Nemotron served by **Nebius Token Factory** through its OpenAI-compatible chat completions API with tool calling.
- **Agent loop:** a bounded loop: model → Pydantic-validated tool calls → execute → feed results back → final answer, with a cap on tool rounds.
- **Backend:** FastAPI + SQLite. Each browser gets its own isolated household, keyed by a cookie. The database holds memory notes, inventory, tasks, pending actions, plans, a tool-call log and rate-limit usage.
- **Deterministic engines:** the supply calculator, readiness and shortage logic, BM25 search over the knowledge base, and a validated tech-tree graph (acyclic, with safety prerequisites).
- **Frontend:** vanilla HTML/CSS/JS with no build step. Prometheus's animated fire-spirit face uses the eye expressions from our Notch Face Kit: it blinks at idle, burns violet while thinking, sparkles when happy, flares red on errors and dims to an ember when offline.
- **Transparency:** an "Under the hood" panel shows the model ID Nebius reported, the response ID, latency, token usage, and every tool call with its arguments and effect.

## Challenges we ran into
- **Keeping an LLM honest in a safety-critical domain.** We moved every number out of the model. Water, food (counted in kcal, not cans) and shortfalls come from a deterministic calculator and a cited assumptions file. The model can only cite sources returned by its own tools, and plan steps that reference unknown sources are rejected.
- **Agency without surprises.** Write tools never change state directly. They create *pending actions*, and only the user's Approve click executes them.
- **Reliable tool calling.** We had to handle malformed tool calls, multi-round tool use and provider failures, and show those failures to the user instead of hiding them.
- **Working offline.** If the cloud AI is unreachable, the app says so plainly, and every data view still works.

## Accomplishments that we're proud of
- An agent that feels like one companion, yet every action it takes is auditable and needs your approval.
- No survival probabilities. Prometheus reports "coverage of planning targets", and AI guesses stay marked *suggested* until you confirm them.
- A Rebuild mode that turns "the grid is gone" into a learning path tied to what's actually in your inventory.
- Automated tests covering the calculator, readiness, tool validation, the approval flow, the agent loop, the tech tree, and persistence across restarts.

## What we learned
Tool calling is only as trustworthy as the tools around it. The more we pushed into deterministic code (calculations, citations, state changes), the better and safer the model's answers got. We also learned that being upfront about limits ("Cloud AI unavailable", "planning default", "suggested") builds more trust than a polished but opaque answer.

## What's next for Project Prometheus
- A **local AI mode** (llama.cpp + GGUF behind the same client interface), so the companion works when the internet doesn't.
- More Rebuild trees: water purification, food preservation, first aid and radio communications.
- Fully worked guides for more scenarios, plus localised guidance by region.
- Shared household plans for families and neighbourhoods.
```

## Built with
python, fastapi, uvicorn, sqlite, pydantic, httpx, javascript, html5, css3, nvidia-nemotron, nebius-token-factory, docker, hugging-face-spaces, pytest

## Try it out
- GitHub: https://github.com/Ponti23/project-prometheus
- Live demo: _add the `https://<user>-<space>.hf.space` URL from the deploy run_ (hosted free on Hugging Face Spaces; the model runs on Nebius Token Factory)

## Testing instructions for judges
Open the URL (if it was idle, the first load can take about a minute) → Settings → **Load demo household** → try: "How ready are we for 30 days? Propose restock tasks." → Approve → "The power grid has collapsed. What should we do?" → "Teach me how electricity works." Turn on **Under the hood** to see the Nemotron tool calls.

If there is no live URL, point judges to the "Run it on Windows" steps in the README instead.

## Gallery images
| File | Shows |
|---|---|
| [companion.png](screenshots/companion.png) | Companion home with the fire-spirit face |
| [prepare.png](screenshots/prepare.png) | Household profile and smart survival kit |
| [survive.png](screenshots/survive.png) | Scenario guides |
| [rebuild.png](screenshots/rebuild.png) | Electricity technology tree |
| [vault.png](screenshots/vault.png) | Knowledge Vault |
| [face-states.png](screenshots/face-states.png) | The face's moods: idle, thinking, listening, speaking, happy, wink, error, sad, sleeping |

A screenshot of a real Nemotron conversation with **Under the hood** open would be a strong extra image; take it while recording the demo.

## Check before submitting
- Confirm the real model ID with `python scripts/verify_nebius.py` and use it wherever the model is named.
- Add the demo video link (YouTube or Vimeo, under 3 minutes). See [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
- If submitting solo, switch "we" to "I".
- Check the hackathon rules on disclosing AI coding tools.
