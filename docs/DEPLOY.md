# Deployment strategy for judging

Judges need a working URL from submission (Oct 30) through the end of judging (around Dec 15). Requirements:
- An always-on HTTP service running the Docker image in this repo.
- A **persistent volume** mounted at `/data`, which holds the SQLite file `/data/prometheus.db`.
- `NEBIUS_API_KEY` set as a **runtime secret** (never baked into the image).
- Rate limits (`PROMETHEUS_DAILY_TURNS_*`) kept on, to protect your Token Factory credits.

Each browser automatically gets its own isolated household (cookie). Judges click **Load demo household** to get synthetic data. No accounts or passwords are needed.

## Option 0 (chosen, free): Hugging Face Spaces (Docker)
No credit card needed. The model still runs on Nebius Token Factory, which satisfies the hackathon's "runs on Nebius" rule. The `README.md` front matter (`sdk: docker`, `app_port: 8000`) tells Hugging Face how to run the image.

1. Create a free account at huggingface.co, then **New Space** → SDK **Docker** → template **Blank** → hardware **CPU basic (free)** → visibility **Public**.
2. In the Space: **Settings → Variables and secrets → New secret**, name `NEBIUS_API_KEY`, paste your key.
3. Create a Hugging Face **write** access token (Settings → Access Tokens).
4. In the GitHub repo: **Settings → Secrets and variables → Actions**:
   - Secret `HF_TOKEN` = the Hugging Face token.
   - Variable `HF_SPACE` = `your-hf-username/your-space-name`.
5. Run **Actions → Deploy to Hugging Face Space → Run workflow** (it also runs on every push to `main`). It leaves out `docs/screenshots`, since Hugging Face rejects plain binary files.
6. Give judges the direct URL `https://<user>-<space>.hf.space`, not the `huggingface.co/spaces/...` page. The page shows the app in an iframe, where the browser may block the household cookie.

Limits: free Spaces sleep after about 48 hours with no visitors (the first visit then takes about a minute) and the disk is not persistent, so a restart wipes saved households. Judges load the demo household anyway.

## Option A (paid): Nebius AI Cloud: Nebius AI Cloud
Running on Nebius compute strengthens the "built on Nebius" submission. Nebius's container services change often, so **check the current Nebius AI Cloud docs** for the exact commands. The shape is:
1. Build and push the image to a registry Nebius can pull from (e.g. Nebius Container Registry):
   `docker build -t <registry>/prometheus:1 . && docker push <registry>/prometheus:1`
2. Create a small CPU VM (or container service) with a persistent disk. Run:
   `docker run -d --restart unless-stopped -p 80:8000 -v /mnt/data:/data -e NEBIUS_API_KEY=*** <registry>/prometheus:1`
3. Put HTTPS in front of it (a Caddy or nginx reverse proxy, or the platform's endpoint) and confirm `/api/status`.
4. **Cost check before you start:** a small CPU VM for about 7 weeks. Stop it after judging.

> ⚠️ This step creates paid infrastructure. It is **not done** and waits for your approval.

## Option B (fallback): Render / Railway / Fly.io
Any host that runs a Dockerfile with a persistent disk works. Avoid platforms without persistent storage (for example plain serverless functions): SQLite data would vanish.

## Checklist before submitting
- [ ] `python scripts/verify_nebius.py` passes on the server (prints the model, response ID and a tool call).
- [ ] `/api/ai/verify` returns `"ok": true`.
- [ ] A full demo run on the hosted URL, followed by a reload, keeps its data.
- [ ] The repo is public, the LICENSE is visible, and the README covers NVIDIA + Nebius usage.
- [ ] Test instructions in Devpost: "Open the URL → Load demo household → try the suggested prompts."
