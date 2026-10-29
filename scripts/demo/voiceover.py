"""Reads docs/VOICEOVER.md aloud, one WAV per scene, with Kokoro (an offline voice)."""
import json
from pathlib import Path
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
D = Path(__file__).parent
(D / "vo").mkdir(exist_ok=True)
# Model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0).
k = Kokoro(str(D / "voices/kokoro-v1.0.onnx"), str(D / "voices/voices-v1.0.bin"))
# Text from docs/VOICEOVER.md, one list of sentences per scene (the italic sentences are marked optional).
S = {
 "1-meet": ["What if the grid went down tomorrow?", "Most of us have no plan.",
   "This is Prometheus, a personal AI companion running on NVIDIA Nemotron through Nebius Token Factory.",
   "It knows my household, and instead of a scary percentage it tells me what's next: eight things left to be ready for three days."],
 "2-prepare": ["I just tell it what I did. I bought five litres of water.",
   "Watch the flame: it flies to my water card and pencils in the change.",
   "Sixty litres becomes sixty-five, and seven things are left.",
   "Nothing is saved until I tap Save. Then it stamps the number and flies home.",
   "*And every number has a Why: it comes from a calculator built on cited guidelines, not from the model."],
 "3-auto": ["Like Claude Code, Prometheus has permission modes.",
   "In Auto, small changes save themselves, but only when the number came from me.",
   "A slab of water? It had to guess, so it asks first.", "Anything automatic can be undone."],
 "4-survive": ["Now the bad day. The power's out across the street.",
   "Prometheus switches to Survive, pulls up the blackout guide, and drafts a plan for my family, in pencil, with sources from its tools.",
   "I save it and tick off steps as I go."],
 "5-sos": ["And if things get serious, there's SOS. No AI, no internet needed.",
   "Is anyone hurt? What's happening?", "One safety question at a time, then one step at a time.",
   "*Every word comes from curated guidance."],
 "6-rebuild": ["Survival isn't the end. I ask it to teach me how electricity works.",
   "Rebuild opens lesson one of a path toward a small off-grid power system, checked against what I own.",
   "*Mains wiring stays theory only. Safety comes first."],
 "7-proof": ["Under the hood: the model ID Nebius reported, the response ID, latency, tokens, and every tool call with its arguments.",
   "Each change sits pending until I approve it.",
   "Prometheus. Prepare today. Survive tomorrow. Rebuild the future."],
}
out = {}
for name, sents in S.items():
    parts = []
    for t in sents:
        a, sr = k.create(t.lstrip("*"), voice="am_michael", speed=1.0, lang="en-us")
        parts += [a, np.zeros(int(sr * 0.45), dtype=a.dtype)]
    a = np.concatenate(parts)
    sf.write(D / "vo" / f"{name}.wav", a, sr)
    out[name] = round(len(a) / sr, 2)
print(json.dumps(out), sum(out.values()))
