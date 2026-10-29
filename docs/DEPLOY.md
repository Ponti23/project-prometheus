# Deployment strategy for judging

Judges need a working URL from submission (Oct 30) through the end of judging (around Dec 15). Requirements:
- An always-on HTTP service running the Docker image in this repo.
- A **persistent volume** mounted at `/data`, which holds the SQLite file `/data/prometheus.db`.
- `NEBIUS_API_KEY` set as a **runtime secret** (never baked into the image).
- Rate limits (`PROMETHEUS_DAILY_TURNS_*`) kept on, to protect your Token Factory credits.

Each browser automatically gets its own isolated household (cookie). Judges click **Load demo household** to get synthetic data. No accounts or passwords are needed.

## Option A (preferred story): Nebius AI Cloud
`scripts/deploy_nebius.sh` does the whole thing from your machine: it creates a small CPU VM with a 30 GiB disk, installs Docker through cloud-init, ships the current commit over SSH, writes the server `.env`, and starts the app behind Caddy. Caddy gets a free HTTPS certificate for `<ip-with-dashes>.sslip.io`, so no domain is needed. SQLite lives at `/srv/prometheus/data` on the VM's disk and survives restarts and redeploys.

One-time setup:
```bash
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash   # nebius CLI
nebius profile create                                                    # log in, pick your project
```
You also need `jq`, an SSH key (`~/.ssh/id_ed25519.pub` or `id_rsa.pub`) and a `.env` with `NEBIUS_API_KEY`.

Deploy (and redeploy after any new commit; it reuses the VM recorded in `var/nebius-deploy.env`):
```bash
bash scripts/deploy_nebius.sh
```
It finishes by calling `/api/ai/verify` on the public HTTPS URL and printing the link.

Overrides: `PLATFORM=cpu-e2` if your region has no `cpu-d3`, `PRESET`, `NB_PROJECT_ID` (otherwise the profile's project), `SSH_PUBKEY`, `DOMAIN`. If a `nebius` command rejects a flag, your CLI version differs: check `nebius compute instance create --help`. If the URL doesn't answer, make sure the VPC's security rules allow inbound TCP 80 and 443.

Tear down after judging (around Dec 15) so billing stops:
```bash
source var/nebius-deploy.env && nebius compute instance delete --id "$INSTANCE_ID" && nebius compute disk delete --id "$DISK_ID"
```

> ⚠️ This creates paid infrastructure (one small CPU VM plus a disk, for about 7 weeks).

## Option B (fallback): Render / Railway / Fly.io
Any host that runs a Dockerfile with a persistent disk works. Avoid platforms without persistent storage (for example plain serverless functions): SQLite data would vanish.

## Checklist before submitting
- [ ] `python scripts/verify_nebius.py` passes on the server (prints the model, response ID and a tool call).
- [ ] `/api/ai/verify` returns `"ok": true`.
- [ ] A full demo run on the hosted URL, followed by a reload, keeps its data.
- [ ] The repo is public, the LICENSE is visible, and the README covers NVIDIA + Nebius usage.
- [ ] Test instructions in Devpost: "Open the URL → Load demo household → try the suggested prompts."
