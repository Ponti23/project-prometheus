"""Nebius Token Factory client (OpenAI-compatible chat completions with tool calling).

Uses plain httpx so the raw response metadata (model, id, usage, latency) is visible for the
"Under the hood" panel. No responses are ever fabricated: on failure we raise LLMUnavailable.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from ..config import Settings

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMUnavailable(Exception):
    """Cloud inference is not available (no key, network error, provider error)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass
class Completion:
    message: dict[str, Any]
    model: str
    response_id: str | None
    usage: dict[str, Any] = field(default_factory=dict)
    latency_ms: int = 0
    provider: str = "nebius-token-factory"
    finish_reason: str | None = None


class ChatClient(Protocol):
    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Completion: ...


def clean_content(text: str | None) -> str:
    if not text:
        return ""
    return _THINK.sub("", text).strip()


class NebiusClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        if not settings.nebius_api_key:
            raise LLMUnavailable("NEBIUS_API_KEY is not configured")
        self.settings = settings
        self._http = httpx.Client(
            base_url=settings.nebius_base_url,
            headers={"Authorization": f"Bearer {settings.nebius_api_key}"},
            timeout=settings.request_timeout_s,
            transport=transport,
        )

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Completion:
        body: dict[str, Any] = {
            "model": self.settings.nebius_model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 1500,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        start = time.perf_counter()
        try:
            resp = self._http.post("chat/completions", json=body)
        except httpx.HTTPError as e:
            raise LLMUnavailable(f"Could not reach Nebius Token Factory: {type(e).__name__}") from e
        latency = int((time.perf_counter() - start) * 1000)
        if resp.status_code != 200:
            detail = resp.text[:300]
            raise LLMUnavailable(f"Nebius returned HTTP {resp.status_code}: {detail}", status=resp.status_code)
        data = resp.json()
        choice = data["choices"][0]
        return Completion(
            message=choice["message"],
            model=data.get("model", self.settings.nebius_model),
            response_id=data.get("id") or resp.headers.get("x-request-id"),
            usage=data.get("usage") or {},
            latency_ms=latency,
            finish_reason=choice.get("finish_reason"),
        )

    def list_models(self) -> list[str]:
        try:
            resp = self._http.get("models")
        except httpx.HTTPError as e:
            raise LLMUnavailable(f"Could not reach Nebius Token Factory: {type(e).__name__}") from e
        if resp.status_code != 200:
            raise LLMUnavailable(f"Nebius returned HTTP {resp.status_code}: {resp.text[:300]}", status=resp.status_code)
        return sorted(m["id"] for m in resp.json().get("data", []))
