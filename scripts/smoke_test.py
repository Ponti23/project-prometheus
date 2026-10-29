"""Smoke-test a running Prometheus deployment.

Usage: python scripts/smoke_test.py https://your-app.onrender.com [--chat] [--wait SECONDS]
--wait keeps retrying /api/status until the server is up (useful right after a deploy).
--chat sends one real message to the model (uses a few Token Factory credits).
"""

from __future__ import annotations

import sys
import time

import httpx


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    base = args[0].rstrip("/")
    wait = int(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 0
    failures = 0

    with httpx.Client(base_url=base, timeout=120, follow_redirects=True) as c:
        deadline = time.time() + wait
        while True:
            try:
                if c.get("/api/status").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.time() >= deadline:
                print(f"BAD server did not come up at {base}")
                return 1
            time.sleep(15)

        def check(name: str, ok: bool, detail: str = "") -> None:
            nonlocal failures
            failures += not ok
            print(f"{'OK ' if ok else 'BAD'} {name} {detail}".rstrip())

        r = c.get("/")
        check("frontend", r.status_code == 200 and "<html" in r.text.lower(), str(r.status_code))
        status = c.get("/api/status").json()
        check("ai configured", status["ai"]["configured"], status["ai"]["model"])
        verify = c.get("/api/ai/verify").json()
        check("nebius verify", verify.get("ok") is True, str(verify.get("reason") or verify.get("configured_model")))
        r = c.post("/api/household/demo")
        check("load demo household", r.status_code == 200, str(r.status_code))
        r = c.get("/api/readiness")
        check("readiness", r.status_code == 200, str(r.status_code))
        r = c.get("/api/household")
        check("cookie keeps household", r.status_code == 200 and r.json()["profile"] is not None)
        if "--chat" in sys.argv:
            r = c.post("/api/chat", json={"message": "How ready are we for 3 days? One sentence."})
            check("chat turn", r.status_code == 200, str(r.status_code))
            if r.status_code == 200:
                print("    reply:", str(r.json())[:300])

    print(f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
