# Deployment strategy for judging

Judges need a working URL from submission (Oct 30) through the end of judging (around Dec 15). Requirements:
- An always-on HTTP service running the Docker image in this repo.
- A **persistent volume** mounted at `/data`, which holds the SQLite file `/data/prometheus.db`.
- `NEBIUS_API_KEY` set as a **runtime secret** (never baked into the image).
- Rate limits (`PROMETHEUS_DAILY_TURNS_*`) kept on, to protect your Token Factory credits.

Each browser automatically gets its own isolated household (cookie). Judges click **Load demo household** to get synthetic data. No accounts or passwords are needed.

## Option 0 (chosen, free): Render
No credit card needed. The model still runs on Nebius Token Factory, which satisfies the hackathon's "runs on Nebius" rule. (Hugging Face Spaces was tried first, but Docker Spaces now need a paid PRO subscription.)

1. Sign up at render.com with your GitHub account.
2. **New → Blueprint**, pick `Ponti23/project-prometheus`. Render reads `render.yaml` (free plan, Docker, auto-deploy from `main`).
3. When asked for `NEBIUS_API_KEY`, paste your key, then click **Deploy Blueprint**. The first build takes a few minutes.
4. Live URL: https://project-prometheus-tp0i.onrender.com. It is the default in the keep-awake and smoke-test workflows; set the repo variable `APP_URL` only if it changes.
5. Run **Actions → Smoke test live app** to check the page, Nebius, the demo household and one real chat turn.

Limits: free services sleep after 15 minutes without traffic, so **Keep app awake** visits the page every 10 minutes (no model calls). One always-on service fits in Render's 750 free hours a month. The disk is not persistent, so a restart or redeploy wipes saved households; judges load the demo household anyway.

## Option A (paid): Nebius AI Cloud: Nebius AI Cloud
Running on Nebius compute strengthens the "built on Nebius" submission. Nebius's container services change often, so **check the current Nebius AI Cloud docs** for the exact commands. The shape is:
1. Build and push the image to a registry Nebius can pull from (e.g. Nebius Container Registry):
   `docker build -t <registry>/prometheus:1 . && docker push <registry>/prometheus:1`
2. Create a small CPU VM (or container service) with a persistent disk. Run:
   `docker run -d --restart unless-stopped -p 80:8000 -v /mnt/data:/data -e NEBIUS_API_KEY=*** <registry>/prometheus:1`
3. Put HTTPS in front of it (a Caddy or nginx reverse proxy, or the platform's endpoint) and confirm `/api/status`.
4. **Cost check before you start:** a small CPU VM for about 7 weeks. Stop it after judging.

> ⚠️ This step creates paid infrastructure. It is **not done** and waits for your approval.

## Option B (fallback): Railway / Fly.io / Koyeb
Any host that runs a Dockerfile with a persistent disk works. Avoid platforms without persistent storage (for example plain serverless functions): SQLite data would vanish.

## Checklist before submitting
- [ ] `python scripts/verify_nebius.py` passes on the server (prints the model, response ID and a tool call).
- [ ] `/api/ai/verify` returns `"ok": true`.
- [ ] A full demo run on the hosted URL, followed by a reload, keeps its data.
- [ ] The repo is public, the LICENSE is visible, and the README covers NVIDIA + Nebius usage.
- [ ] Test instructions in Devpost: "Open the URL → Load demo household → try the suggested prompts."
