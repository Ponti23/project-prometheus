# Braindump: future ideas

Rough ideas to come back to later. None of these are built yet, and none are commitments.

_Added: 2026-10-29._

## 1. "Where is my household?" check-in
- Works like an "R U OK?" daily check-in app: each household member taps "I'm OK" once a day, or during an emergency.
- Shows a simple board of who has checked in, when, and from roughly where (location is opt-in).
- If someone misses a check-in, it escalates: first a reminder, then a nudge to the rest of the household or an emergency contact.
- The companion could say things like "Sam hasn't checked in for 26 hours" and offer to help draft a message.
- Open questions: what happens offline, privacy and consent for location, and how members join a household (it's one household per browser today).

## 2. Panic button
- One large, obvious button that works from any screen.
- Pressing it opens the matching Survive guide, or a triage flow, straight away.
- It could also alert household members and emergency contacts, sharing status and location if they opted in.
- It must say clearly that it does **not** replace calling 000 / 911 / 112. Show the local emergency number prominently.
- Open questions: avoiding accidental presses (hold to confirm?), and what "send alert" means without SMS or push infrastructure.

## 3. Live monitoring (for the Tavily award)
- Use Tavily search to watch live sources: weather warnings, bushfire and flood alerts (e.g. Emergency WA), power outages, boil-water notices and supply disruptions near the household.
- Prometheus flags anything relevant ("A severe storm warning was issued for your area") and suggests a Prepare or Survive action, which the user still approves.
- Live results must be cited and kept separate from the curated offline Knowledge Vault, so the "no invented citations" rule still holds.
- Open questions: polling frequency and cost, how the household's location/region is stored, and how to behave honestly when offline or when the API is unavailable.
