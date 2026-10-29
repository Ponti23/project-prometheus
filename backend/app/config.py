"""Runtime configuration, read from environment variables (and a local .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
FRONTEND_DIR = ROOT_DIR / "frontend"

load_dotenv(ROOT_DIR / ".env")

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
# Confirm against GET /v1/models for your account (see scripts/verify_nebius.py).
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b"


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    nebius_api_key: str | None
    nebius_base_url: str
    nebius_model: str
    db_path: Path
    daily_turns_per_household: int
    daily_turns_global: int
    max_tool_rounds: int
    request_timeout_s: int
    history_messages: int

    @property
    def ai_configured(self) -> bool:
        return bool(self.nebius_api_key)


def get_settings() -> Settings:
    key = (os.environ.get("NEBIUS_API_KEY") or "").strip() or None
    return Settings(
        nebius_api_key=key,
        nebius_base_url=os.environ.get("NEBIUS_BASE_URL", DEFAULT_BASE_URL).rstrip("/") + "/",
        nebius_model=os.environ.get("NEBIUS_MODEL", DEFAULT_MODEL),
        db_path=Path(os.environ.get("PROMETHEUS_DB", ROOT_DIR / "var" / "prometheus.db")),
        daily_turns_per_household=_int("PROMETHEUS_DAILY_TURNS_PER_HOUSEHOLD", 80),
        daily_turns_global=_int("PROMETHEUS_DAILY_TURNS_GLOBAL", 2000),
        max_tool_rounds=_int("PROMETHEUS_MAX_TOOL_ROUNDS", 6),
        request_timeout_s=_int("PROMETHEUS_REQUEST_TIMEOUT", 90),
        history_messages=_int("PROMETHEUS_HISTORY_MESSAGES", 40),
    )
