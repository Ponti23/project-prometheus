# Devpost submission draft

Copy each section into the matching field on the Devpost project page. Gallery images are in [screenshots/redesign/](screenshots/redesign/).

## Project name
Project Prometheus: Humanity's Backup Brain

## Elevator pitch (200 characters max)
An AI apocalypse buddy on NVIDIA Nemotron + Nebius. Tell it "I bought 5 L of water" and it pencils the change onto your plan for you to save. Prepare. Survive. Rebuild.

## About the project

```markdown
## Inspiration
Most of us are one blackout, bushfire or supply disruption away from realising we have no plan. Preparedness advice is scattered across government sites and PDFs, it's generic, and nobody reads it until the power is already out. I wanted a *personal* AI that already knows your family, your pets, your medication and what's in your cupboard, and that stays useful from the calm "prepare" phase all the way to "how do we restore power ourselves?"

## What it does
Prometheus is one continuous AI companion, a little fire spirit whose face reacts as it listens, thinks and answers. You talk to it in a chat beside a canvas of cards, and the chat drives the canvas.

Say "I bought 5 L of water" and the flame flies out of the chat to your Water card, pencils in **60 L → 65 L** and "7 left for 3 days", and waits. Tap **Save** and it stamps the number. Nothing changes until you do.

- **Prepare:** readiness in stages (3 days → 1 week → 2 weeks → your goal) instead of a scary percentage, with a short **Next up** list for the stage you're on. One card per supply area, in human units ("2 of 5 torches", "3.9 days of food for everyone"), each with a **Why?** that shows the cited working.
- **Survive:** scenario guides (extended blackout, supply disruption, isolation, plus a clearly labelled *fictional* zombie drill), your household's real resource picture, and a drafted response plan you save and tick off.
- **SOS:** a red button on every screen opens a full-screen emergency flow that needs no AI and works offline: is anyone hurt (call 000), what's happening, one safety question per screen, then the steps one at a time.
- **Rebuild:** the electricity technology tree as a numbered path of lessons, from "Energy & power" to "Small off-grid DC power", with materials checked against your inventory and mains wiring kept theory-only.
- **Knowledge Vault:** 20 curated offline entries, linked to sources such as the Australian Red Cross, Emergency WA, Ready.gov, CDC, FoodSafety.gov, OpenStax and PhET.

**Permission modes, like Claude Code:** *Ask first* shows every change and waits. *Auto* saves small supply changes itself, but only when the number is in your own message ("I bought 5 L" saves; "I bought a slab of water" asks), and every automatic save can be undone. *Plan* drafts everything and offers **Save all**.

Prometheus drives all of it through **16 real tools** that read and write your saved data, and it remembers you across sessions. For anyone who wants the details, **Advanced mode** keeps the full workspace: every table, the tool log, and Under the hood.

## How I built it
- **Model:** NVIDIA Nemotron served by **Nebius Token Factory** through its OpenAI-compatible chat completions API with tool calling.
- **Agent loop:** a bounded loop: model → Pydantic-validated tool calls → execute → feed results back → final answer, with a cap on tool rounds.
- **Backend:** FastAPI + SQLite. Each browser gets its own isolated household, keyed by a cookie. The database holds memory notes, inventory, tasks, pending actions, plans, a tool-call log and rate-limit usage.
- **Deterministic engines:** the supply calculator, readiness and shortage logic, BM25 search over the knowledge base, and a validated tech-tree graph (acyclic, with safety prerequisites).
- **Canvas:** an infinite canvas of real DOM cards (pan, zoom, drag; zoomed out, cards turn into a map of how ready you are). Each tool says which card its result belongs to, deterministically in code, and the app places it; the model never moves things around.
- **Honest previews:** a pencil value comes from a preview endpoint that runs the calculator on a copy of your data and saves nothing. You can edit a proposal before saving it, and undo any saved change.
- **Frontend:** vanilla HTML/CSS/JS with no build step, a dark and a light look, and an offline service worker. Prometheus's animated fire-spirit face uses the eye expressions from my Notch Face Kit: it blinks at idle, burns violet while thinking, sparkles when happy, flares red on errors and dims to an ember when offline.
- **Transparency:** an "Under the hood" panel shows the model ID Nebius reported, the response ID, latency, token usage, and every tool call with its arguments and effect.
- **AI coding tools:** I built this with help from Claude Code, an AI coding assistant.

## Challenges I ran into
- **Keeping an LLM honest in a safety-critical domain.** I moved every number out of the model. Water, food (counted in kcal, not cans) and shortfalls come from a deterministic calculator and a cited assumptions file. The model can only cite sources returned by its own tools, and plan steps that reference unknown sources are rejected.
- **Agency without surprises.** Write tools never change state directly. They create *pending actions*, and only the user's Approve click executes them.
- **Reliable tool calling.** I had to handle malformed tool calls, multi-round tool use and provider failures, and show those failures to the user instead of hiding them.
- **Working offline.** If the cloud AI is unreachable, the app says so plainly, and every data view still works. SOS and the guides keep working with no internet at all.
- **Making it feel calm, not like an IT hub.** My first version showed four panels at once and an unweighted 33% "coverage" score where a can opener counted as much as water. I rebuilt it around stages ("8 left for 3 days"), human units and one card per thing, and kept the dense view as Advanced mode.

## Accomplishments that I'm proud of
- An agent that feels like one companion, yet every action it takes is auditable and needs your approval. Watching the flame pencil a change onto the exact number it affects makes approval feel natural instead of like a form.
- An emergency mode that works with no AI and no internet, quoting only curated guidance.
- No survival probabilities. Prometheus reports "coverage of planning targets", and AI guesses stay marked *suggested* until you confirm them.
- A Rebuild mode that turns "the grid is gone" into a learning path tied to what's actually in your inventory.
- Automated tests covering the calculator, readiness, tool validation, the approval flow, the agent loop, the tech tree, and persistence across restarts.

## What I learned
Tool calling is only as trustworthy as the tools around it. The more I pushed into deterministic code (calculations, citations, state changes), the better and safer the model's answers got. I also learned that being upfront about limits ("Cloud AI unavailable", "planning default", "suggested") builds more trust than a polished but opaque answer.

## What's next for Project Prometheus
- A **local AI mode** (llama.cpp + GGUF behind the same client interface), so the companion works when the internet doesn't.
- More Rebuild trees: water purification, food preservation, first aid and radio communications.
- Fully worked guides for more scenarios, plus localised guidance by region.
- Shared household plans for families and neighbourhoods.
```

## Feedback on Nebius and NVIDIA tools
- **Token Factory:** the OpenAI-compatible API meant I could call it with plain `httpx`, no SDK needed. The returned model ID and token usage made the "Under the hood" panel easy to build.
- **Nemotron 3 Super 120B:** chained tools reliably through the full demo conversation, with no failures in 2 runs.
- **Nemotron 3.5 Lightning:** fast, but in long conversations (~15k prompt tokens) it sometimes replied with the literal text `[ERROR: Max turns (10) exceeded]` instead of calling tools (2 of 3 demo runs). A proper API error, or docs on the limit, would help.

## Built with
python, fastapi, uvicorn, sqlite, pydantic, httpx, javascript, html5, css3, nvidia-nemotron, nebius-token-factory, docker, render, pytest

## Try it out
- GitHub: https://github.com/Ponti23/project-prometheus
- Live demo: https://project-prometheus-tp0i.onrender.com (hosted free on Render; the model runs on Nebius Token Factory)

## Testing instructions for judges
Open the URL (if it was idle, the first load can take about a minute) → **≡ → Try the demo family** → in the chat, try "I bought 5 L of water" and tap **Save** on the card → "The power just went out across the whole street." → tap **SOS** → "Teach me how electricity works." To see the Nemotron tool calls, open **≡ → Show me how it works** (Advanced mode with Under the hood on).

If there is no live URL, point judges to the "Run it on Windows" steps in the README instead.

## Gallery images
| File | Shows |
|---|---|
| [1-prepare-desktop.png](screenshots/redesign/1-prepare-desktop.png) | The Prepare canvas: ready in stages, Next up, Water |
| [2-pencil-desktop.png](screenshots/redesign/2-pencil-desktop.png) | "I bought 5 L of water": the change pencilled in, waiting for Save |
| [3-auto-desktop.png](screenshots/redesign/3-auto-desktop.png) | Auto mode saving a small change, with Undo |
| [4-survive-desktop.png](screenshots/redesign/4-survive-desktop.png) | Survive: the scenario and a drafted plan |
| [5-sos-phone.png](screenshots/redesign/5-sos-phone.png) | SOS on a phone, no AI needed |
| [1-prepare-desktop-light.png](screenshots/redesign/1-prepare-desktop-light.png) | The light look |
| [face-states.png](screenshots/face-states.png) | The face's moods: idle, thinking, listening, speaking, happy, wink, error, sad, sleeping |

Some redesign screenshots were taken before the dark look became the default, so they show the light look.

A screenshot of a real Nemotron conversation with **Under the hood** open would be a strong extra image; take it while recording the demo.

## Check before submitting
- Confirm the real model ID with `python scripts/verify_nebius.py` and use it wherever the model is named.
- Add the demo video link (YouTube or Vimeo, under 3 minutes). The narration is in [VOICEOVER.md](VOICEOVER.md).
- Paste the license (Apache 2.0) and the feedback section into the matching Devpost fields if the form asks for them.
