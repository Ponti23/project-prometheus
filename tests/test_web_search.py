from dataclasses import replace

import httpx

from backend.app.agent.tools import run_tool, tool_specs
from backend.app.config import get_settings
from backend.app.knowledge import web


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def fake_post(response, calls):
    def post(url, json, headers, timeout):
        calls.append({"url": url, "json": json, "headers": headers})
        if isinstance(response, Exception):
            raise response
        return response
    return post


def test_web_search_tool_is_offered_only_with_a_key():
    names = lambda s: {t["function"]["name"] for t in tool_specs(s)}  # noqa: E731
    assert "web_search" not in names(replace(get_settings(), tavily_api_key=None))
    assert "web_search" in names(replace(get_settings(), tavily_api_key="tvly-test"))


def test_trusted_domains_come_from_the_source_registry():
    domains = web.trusted_domains()
    assert "ready.gov" in domains and "redcross.org.au" in domains
    assert not any(d.startswith("www.") for d in domains)
    assert web.publisher_for("https://www.ready.gov/power-outages")
    assert web.publisher_for("https://sub.cdc.gov/x")
    assert web.publisher_for("https://evilready.gov/x") is None
    assert web.publisher_for("https://example.com/ready.gov") is None


def test_search_limits_domains_and_drops_untrusted_results(monkeypatch):
    calls = []
    payload = {"results": [
        {"title": "Power Outages", "url": "https://www.ready.gov/power-outages", "content": "Keep freezers closed."},
        {"title": "Random blog", "url": "https://blog.example.com/outage", "content": "Trust me."},
    ]}
    monkeypatch.setattr(web.httpx, "post", fake_post(FakeResponse(200, payload), calls))
    results = web.search("power outage freezer", "tvly-test")
    assert [r["url"] for r in results] == ["https://www.ready.gov/power-outages"]
    assert results[0]["publisher"].startswith("Ready.gov")
    sent = calls[0]
    assert sent["url"] == web.TAVILY_URL
    assert sent["headers"]["Authorization"] == "Bearer tvly-test"
    assert set(sent["json"]["include_domains"]) == set(web.trusted_domains())


def test_web_search_tool_without_key_is_an_error(store, hid, monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    result, ok, _ = run_tool(store, hid, "web_search", {"query": "boil water"})
    assert not ok and "not configured" in result["error"]


def test_web_search_tool_reports_provider_failure(store, hid, monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    monkeypatch.setattr(web.httpx, "post", fake_post(httpx.ConnectError("offline"), []))
    result, ok, _ = run_tool(store, hid, "web_search", {"query": "boil water"})
    assert not ok and "unavailable" in result["note"]


def test_web_search_tool_returns_citable_results(store, hid, monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    payload = {"results": [{"title": "Water", "url": "https://www.ready.gov/water", "content": "Store water."}]}
    monkeypatch.setattr(web.httpx, "post", fake_post(FakeResponse(200, payload), []))
    result, ok, effect = run_tool(store, hid, "web_search", {"query": "store water"})
    assert ok and effect == "none"
    assert result["results"][0]["url"] == "https://www.ready.gov/water"
    assert "knowledge_refs" in result["citation_rule"]
