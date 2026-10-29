# Demo script (target 2:50, under the 3:00 limit)

Every step uses a working feature. Before recording: set `NEBIUS_API_KEY`, open the app at `/`, then **≡ → Try the demo family** (a synthetic family of five with a partial inventory). Keep the chat chip on **Ask first**. Model wording varies run to run, so don't script exact replies. Rehearse once and keep the takes where the flame lands cleanly.

| Time | Scene | Do / say |
|---|---|---|
| 0:00–0:20 | **1 · Meet Prometheus** | The Prepare canvas: **Ready in stages** says "8 left for 3 days", **Next up** lists what to get, the flame sits in the chat. Pan and zoom out once so the cards turn into a readiness map, then **Fit**. |
| 0:20–1:00 | **2 · Prepare** | Type *"I bought 5 L of water"*. The flame flies to the Water card and pencils in **60 L → 65 L**, **2.9 → 3.2 days** and **7 left for 3 days**. Tap **Save**: it stamps the number, flies home, and Next up drops the water. Tap **Why?** on Water to show the cited working ("3.8 L × 5 people…, from a guideline, Ready.gov"). |
| 1:00–1:20 | **3 · Auto mode** | Switch the chip to **Auto** (or Shift+Tab). *"I just bought 2 LED torches"* saves straight away with an **Undo** chip. *"I bought a slab of water"* still asks, because Prometheus had to guess the number. Switch back to **Ask first**. |
| 1:20–1:55 | **4 · Survive** | *"The power just went out across the whole street."* The flame flies to the **Survive** tab; the blackout guide and a drafted plan appear in pencil. **Save** the plan and tick the first step. Point at the **Sources** under the reply. |
| 1:55–2:15 | **5 · SOS** | Tap **SOS**: "Is anyone hurt?" No → **Power out** → one safety question per screen (answer Yes to the generator question to show the carbon-monoxide guidance) → a step with **Done ✓**. Say it needs no AI and works offline. Close it. |
| 2:15–2:35 | **6 · Rebuild** | *"Teach me how electricity works."* The **Rebuild** tab opens Lesson 1 with "Try this safely" and the numbered learning path. Point at "Theory only" on the professional lessons. |
| 2:35–2:55 | **7 · Technical proof** | **≡ → Show me how it works** opens Advanced mode with **Under the hood** on: model `nvidia/nemotron-3-super-120b-a12b` as reported by Nebius, response ID, latency, tokens, every tool call. Settings → Tool call log: `pending_action`, then `state_changed_after_approval`. Close on: "Prepare today. Survive tomorrow. Rebuild the future." |

Optional extras if a scene runs short: the **light look** (sun button next to SOS), or reload the page to show everything is still there.

Fallback if the network fails during recording: show SOS and the cards (they work offline) and say plainly that chat needs the cloud. Never splice in fake replies.
