"""Check that every URL in data/sources.json resolves, and record the result ("checked": true/false).

Usage: python scripts/check_sources.py [--write]
Without --write it only reports. Run it on a machine with normal internet access before submitting.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

PATH = Path(__file__).resolve().parents[1] / "data" / "sources.json"


def main() -> int:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    bad = 0
    with httpx.Client(follow_redirects=True, timeout=20, headers={"User-Agent": "Mozilla/5.0 Prometheus-link-check"}) as c:
        for s in data["sources"]:
            try:
                r = c.get(s["url"])
                ok = r.status_code < 400
                status = r.status_code
            except httpx.HTTPError as e:
                ok, status = False, type(e).__name__
            s["checked"] = ok
            bad += not ok
            print(f"{'OK ' if ok else 'BAD'} {status} {s['id']:<24} {s['url']}")
    if "--write" in sys.argv:
        PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Updated {PATH}")
    print(f"{bad} broken link(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
