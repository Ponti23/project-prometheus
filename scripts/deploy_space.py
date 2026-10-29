"""Create (if needed) and update the Hugging Face Docker Space, then print its URL.

Env: HF_TOKEN (write token, required), HF_SPACE (optional, default "<hf user>/project-prometheus"),
NEBIUS_API_KEY (optional; stored as a Space secret when given).
Writes the app URL to $GITHUB_OUTPUT as `url` when run in GitHub Actions.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    api = HfApi(token=os.environ["HF_TOKEN"])
    user = api.whoami()["name"]
    repo = os.environ.get("HF_SPACE") or f"{user}/project-prometheus"
    api.create_repo(repo, repo_type="space", space_sdk="docker", exist_ok=True)
    if os.environ.get("NEBIUS_API_KEY"):
        api.add_space_secret(repo, "NEBIUS_API_KEY", os.environ["NEBIUS_API_KEY"])
    api.upload_folder(
        repo_id=repo,
        repo_type="space",
        folder_path=ROOT,
        commit_message=f"Deploy {os.environ.get('GITHUB_SHA', 'local')[:7]}",
        # The Space only needs the app; the screenshots are Devpost material.
        ignore_patterns=[".git/*", ".github/*", "docs/screenshots/*", "var/*", "*.db", ".venv/*", "**/__pycache__/*"],
        delete_patterns=["*"],
    )
    url = "https://" + re.sub(r"[^a-z0-9]+", "-", repo.lower().replace("/", "-")).strip("-") + ".hf.space"
    print(f"Space: https://huggingface.co/spaces/{repo}\nApp:   {url}")
    if out := os.environ.get("GITHUB_OUTPUT"):
        with open(out, "a") as f:
            f.write(f"url={url}\n")


if __name__ == "__main__":
    main()
