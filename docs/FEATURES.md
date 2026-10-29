# Feature status

Legend:
- ✅ **implemented & tested**: covered by automated tests.
- 🟡 **implemented, needs live verification**: built, but not yet confirmed with real credentials or a real browser on your machine.
- ⏳ **planned**: not built yet.

_Last updated: 2026-10-27._

## AI companion
| Feature | Status | Evidence |
|---|---|---|
| Nebius Token Factory client (OpenAI-compatible chat + tools) | ✅ | `backend/app/agent/llm.py`. Verified against the live API with `scripts/verify_nebius.py` and `tests/test_nebius_live.py` (3 passed). |
| Nemotron model ID confirmed for the account | ✅ | Default `nvidia/Nemotron-3_5-Lightning` (the brief's model), confirmed live with tool calling. `nvidia/nemotron-3-super-120b-a12b` also works. |
| Agent loop with multi-round tool calling | ✅ | `tests/test_agent_loop.py` (scripted client) |
| 15 validated tools on real state | ✅ | `tests/test_tools.py` |
| Write tools only propose; approval executes | ✅ | `test_propose_tools_never_mutate_until_approved`, `test_full_prepare_flow_with_approval_and_recalculation` |
| Persistent conversation, restored after restart | ✅ | `test_history_is_replayable_after_restart`, `test_persistence_across_restart` |
| Memory notes: suggested vs. confirmed; inspect, edit, delete | ✅ | `test_remember_note_is_only_suggested`, Settings → Memory |
| Context awareness (household, inventory, mode, topic, plans) | ✅ | `test_system_prompt_contains_household_context` |
| Under-the-hood trace (model, response ID, latency, tokens, tool calls) | ✅ | Chat UI toggle + Settings → Tool call log |
| Honest unavailable state without a key or on provider errors | ✅ | `test_chat_without_key_is_honest_503`, `test_provider_failure_is_surfaced_not_faked` |
| Rate limiting / cost guard | ✅ | `test_rate_limit` |

## Prepare
| Feature | Status |
|---|---|
| Household profile (adults, children, pets, duration 3/7/14/30, hot climate, medication, diet, special needs) | ✅ |
| Deterministic, cited planning targets (14 categories) | ✅ `test_calculator.py` |
| Food planned in kcal / meal-equivalents, not cans | ✅ |
| Inventory CRUD: units, categories, expiry, working/unavailable, "counts toward" | ✅ |
| Readiness: coverage, shortfalls, days of water/food, expired/expiring/unavailable/uncounted | ✅ `test_readiness.py` |
| Restock tasks proposed → approved → shown → completed (optionally added to inventory) → recalculated | ✅ |

## Survive
| Feature | Status |
|---|---|
| Extended blackout scenario: triage, household situation, sourced steps | ✅ |
| Supply disruption, isolation, and fictional zombie scenarios (lighter content) | ✅ |
| Fiction clearly labelled (UI banner, plan flag, tool output) | ✅ |
| AI-created survival plan (validated citations) → approval → checkable progress | ✅ |

## Rebuild
| Feature | Status |
|---|---|
| Electricity tech tree: 12-node validated DAG (no cycles; hands-on nodes require Electrical safety) | ✅ `test_techtree.py` |
| Node detail: what, why, learning path, unlocks, materials vs inventory, safety, sources, goals, activity | ✅ |
| Companion opens nodes (`get_technology_node`) and updates the current topic | ✅ |

## Knowledge Vault
| Feature | Status |
|---|---|
| 20 curated entries, 21 registered sources, offline BM25 search, topic filters | ✅ |
| Source links verified to resolve | 🟡 The build sandbox couldn't reach these sites. Run `scripts/check_sources.py --write`. |

## Offline / deployment
| Feature | Status |
|---|---|
| Offline data mode (all non-chat features work without AI) | ✅ |
| Dockerfile with a persistent `/data` volume | 🟡 Not yet built or run |
| Hosted judging URL (Nebius AI Cloud) | ⏳ Needs your approval and credentials. See DEPLOY.md |
| Local llama.cpp inference | ⏳ Planned (same `ChatClient` interface) |
| Voice, images, GPS, multiplayer, auto-purchasing | ⏳ Out of scope for the MVP |
