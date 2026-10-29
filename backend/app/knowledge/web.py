"""Live web search through Tavily, limited to the publishers in the source registry.

The registry (data/sources.json) is the set of sites Prometheus may cite. Web search only looks
inside those sites, and any result from another host is dropped, so a fresher page from Ready.gov
or the Red Cross can be cited but an arbitrary blog cannot.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

import httpx

from .search import load_sources

TAVILY_URL = "https://api.tavily.com/search"


class WebSearchUnavailable(Exception):
    """Web search is not available (no key, network error, provider error)."""


def _host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


@lru_cache(maxsize=1)
def trusted_domains() -> dict[str, str]:
    """Registry domain (without "www.") -> publisher name."""
    out: dict[str, str] = {}
    for s in load_sources().values():
        out.setdefault(_host(s["url"]), s["publisher"])
    return out


def publisher_for(url: str) -> str | None:
    """The registry publisher for a URL on a trusted domain or one of its subdomains, else None."""
    host = _host(url)
    for domain, publisher in trusted_domains().items():
        if host == domain or host.endswith("." + domain):
            return publisher
    return None


def search(query: str, api_key: str, limit: int = 5, timeout_s: float = 20) -> list[dict[str, Any]]:
    payload = {
        "query": query,
        "max_results": limit,
        "search_depth": "basic",
        "include_domains": sorted(trusted_domains()),
    }
    try:
        r = httpx.post(TAVILY_URL, json=payload, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout_s)
    except httpx.HTTPError as e:
        raise WebSearchUnavailable(f"web search failed: {type(e).__name__}") from e
    if r.status_code != 200:
        raise WebSearchUnavailable(f"web search failed: HTTP {r.status_code}")
    results = []
    for item in r.json().get("results", []):
        url = item.get("url") or ""
        publisher = publisher_for(url)
        if publisher is None:
            continue
        results.append({
            "title": (item.get("title") or url)[:200],
            "url": url,
            "publisher": publisher,
            "content": (item.get("content") or "")[:800],
        })
    return results
