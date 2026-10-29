# Demo video recorder

Records the real app talking to the real Nemotron model (no scripted replies), then cuts it into an MP4.

1. Start the server with `NEBIUS_API_KEY` set: `uvicorn backend.app.main:app --port 8000`
2. `node scripts/demo_video/record.js` writes `raw.webm` and `marks.json` next to the script.
3. `cd scripts/demo_video && python3 cut.py` speeds up the model-wait segments (each one is captioned "sped up") and writes `demo.mp4` at 1920x1200.

Needs Playwright (Chromium) and ffmpeg.
