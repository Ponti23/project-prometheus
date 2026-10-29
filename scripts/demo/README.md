# Demo video

[docs/video/prometheus-demo.mp4](../../docs/video/prometheus-demo.mp4) (1920×1080, 2:46) was recorded from the live app and the live model with these scripts. The scenes follow [docs/DEMO_SCRIPT.md](../../docs/DEMO_SCRIPT.md). The narration is [docs/VOICEOVER.md](../../docs/VOICEOVER.md), read by a synthetic voice (Kokoro, `am_michael`).

1. Start the app with `NEBIUS_API_KEY` set: `uvicorn backend.app.main:app --port 8000`.
2. `node record.js` (Playwright) reloads the demo family before each scene. It writes `clips/<scene>.mp4` and a JSON file that marks when it waited on the model. A scene is retaken, up to 4 times, when the model doesn't propose the change or leaks raw JSON into its reply. No replies are faked.
3. `python3 voiceover.py` writes `vo/<scene>.wav`. It needs `pip install kokoro-onnx soundfile` and the two model files in `voices/`.
4. `python3 assemble.py` lays the voice over each clip and joins them into `out/prometheus-demo.mp4`. Waits on the model play at 4× under a "Waiting for the model · sped up 4x" label. Where a scene would overrun its narration, the rest of the footage plays up to 1.35× faster.

`clips/`, `vo/`, `voices/` and `out/` are build output and are git-ignored.
