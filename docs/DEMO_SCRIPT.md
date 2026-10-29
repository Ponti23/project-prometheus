# Demo script (target 2:45, under the 3:00 limit)

Every step uses a working feature. Before recording: set `NEBIUS_API_KEY`, start the server, open **Settings → Load demo household** (this resets the conversation and loads a synthetic family of five with a partial inventory), and turn **Under the hood: on**. Model wording varies run to run, so don't script exact replies. Rehearse once and keep the takes that show the tool pills.

| Time | Scene | Do / say |
|---|---|---|
| 0:00–0:20 | **1 · Meet Prometheus** | "What if the grid went down tomorrow?" Open the app: emblem, three modes, the honest "Cloud AI configured" chip. Type: *"Hi Prometheus! I'm preparing my family of five for a 30-day emergency."* It calls `get_household_profile` and replies with what it already knows (2 adults, 3 children, a dog, medication). If you correct something ("we actually have two dogs"), it proposes a profile update for you to **Approve**. |
| 0:20–1:05 | **2 · Prepare** | Ask: *"How ready are we for 30 days? What are we short of? Propose restock tasks."* Point at the tool pills (`calculate_readiness`, `get_missing_supplies`, `propose_restock_tasks`) and the proposal card. **Approve**, and the tasks appear in Prepare and the context panel. Click **Done + add to inventory** on the water task: water goes to "Met" and coverage recalculates. Mention "coverage of planning targets, never a survival probability". |
| 1:05–1:45 | **3 · Survive** | Ask: *"The power grid has collapsed. We don't have electricity anymore. What should we do?"* Show the triage questions first (CO, medical, fallen lines), then the household-specific plan (5 people, 30 days of water, wind-up radio, the medication). Show the **Sources** footer under the reply: real links from the vault's sources. **Approve** the plan, then tick a step in Survive. |
| 1:45–2:20 | **4 · Rebuild** | Ask: *"Prometheus, can you teach me how electricity works so we can eventually restore power?"* The Rebuild tree opens on the node, with the learning path highlighted and materials checked against the inventory (the solar charger is ✓, a power station is ✕). Mention the safety gating: mains wiring is professional only. |
| 2:20–2:35 | **5 · Persistence** | Reload the page. The household, inventory, tasks, plan, topic and conversation are all still there. |
| 2:35–2:50 | **6 · Technical proof** | Expand **Under the hood**: model `nvidia/nemotron-3-super-120b-a12b` as reported by Nebius, the response ID, latency, tokens, and the tool calls with their arguments. Open **Settings → Tool call log**: `pending_action`, then `state_changed_after_approval`. Close on: "Prepare today. Survive tomorrow. Rebuild the future." |

### Simple-mode version (same features, friendlier look)
Before recording: open `/`, then **≡ → Try the demo family**. Keep the chat in **Ask first**.

1. **Prepare.** Say *"I bought 5 L of water"*. The flame flies to the Water card and pencils in **60 L → 65 L** ("7 left for 3 days"). Tap **Save**: it stamps the number and the stages card ticks down. Tap **Why?** for the cited working.
2. **Auto.** Switch the chip to **Auto** (or Shift+Tab) and say *"I just bought 2 LED torches"*. It saves straight away with an Undo chip. Then *"I bought a slab of water"* still asks, because Prometheus had to guess the number.
3. **Survive.** Say *"The power just went out across the whole street."* The flame flies to the Survive tab; the scenario and a drafted plan appear in pencil. **Save** it and tick a step.
4. **SOS.** Tap **SOS**: Is anyone hurt? → Power out → one safety question per screen → steps with **Done ✓**. No AI involved.
5. **Rebuild.** *"Teach me how electricity works."* Lesson 1 opens with "Try this safely".
6. **Proof.** **≡ → Show me how it works** opens Advanced with Under the hood on.

Fallback if the network fails during recording: show the offline data views and say plainly that chat needs the cloud. Never splice in fake replies.
