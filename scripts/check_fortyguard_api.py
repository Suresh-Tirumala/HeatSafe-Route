"""
FortyGuard Temperature API — connectivity & authentication checker.

Usage:
    python scripts/check_fortyguard_api.py
    FORTYGUARD_API_KEY=your_key python scripts/check_fortyguard_api.py
    python scripts/check_fortyguard_api.py --key your_key --lat 40.7128 --lng -74.0060

Checks (in order):
  1. DNS / TLS reachability of api.fortyguard.com
  2. Unauthenticated probe of /v1 root          -> expect 401/403/404 (proves server alive)
  3. Unauthenticated POST /v1/temperature/batch -> expect 401 (proves endpoint exists, auth enforced)
  4. Authenticated POST /v1/temperature/batch   -> only if a key is provided

Exit codes: 0 = reachable (+ auth OK if key given), 1 = unreachable or auth failed.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

BASE_URL = "https://api.fortyguard.com/v1"
BATCH_URL = f"{BASE_URL}/temperature/batch"
TIMEOUT_S = 15

SAMPLE_LOCATIONS = [
    {"lng": -74.0060, "lat": 40.7128},  # New York
    {"lng": 35.2036, "lat": 31.7800},   # Jerusalem (project demo area)
]


def _request(
    method: str,
    url: str,
    *,
    body: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None,
) -> Tuple[int, str]:
    """Perform one HTTP request; returns (status_code, body_text).

    Non-2xx responses are captured instead of raising.
    """
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["api-key"] = api_key

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        try:
            text = exc.read().decode("utf-8", errors="replace")
        except Exception:
            text = ""
        return exc.code, text


def check_dns_tls() -> bool:
    print("\n[1/4] DNS + TLS reachability")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(f"{BASE_URL.rsplit('/', 1)[0]}", timeout=TIMEOUT_S) as _:
            pass
    except urllib.error.HTTPError:
        print("      OK — host resolved and TLS handshake succeeded.")
        return True
    except Exception as exc:  # noqa: BLE001 — diagnostic must survive anything
        print(f"      FAIL — {type(exc).__name__}: {exc}")
        return False
    print("      OK — host resolved and TLS handshake succeeded.")
    _ = ctx
    return True


def check_root() -> bool:
    print("\n[2/4] GET https://api.fortyguard.com/v1  (unauthenticated)")
    t0 = time.perf_counter()
    status, body = _request("GET", BASE_URL)
    ms = (time.perf_counter() - t0) * 1000
    snippet = body.strip().replace("\n", " ")[:120]
    print(f"      -> HTTP {status} ({ms:.0f} ms)  {snippet}")
    if status in (200, 401, 403, 404):
        print("      OK — server is responding.")
        return True
    print("      WARN — unexpected status, server may be misbehaving.")
    return True


def check_batch_unauthenticated() -> bool:
    print(f"\n[3/4] POST {BATCH_URL}  (no API key)")
    payload = {"locations": SAMPLE_LOCATIONS, "hour": 12}
    t0 = time.perf_counter()
    status, body = _request("POST", BATCH_URL, body=payload)
    ms = (time.perf_counter() - t0) * 1000
    snippet = body.strip().replace("\n", " ")[:160]
    print(f"      -> HTTP {status} ({ms:.0f} ms)  {snippet}")
    if status == 401:
        print("      OK — endpoint exists and requires authentication (expected).")
        return True
    if status == 200:
        print("      NOTE — returned 200 WITHOUT a key; verify this is intended.")
        return True
    if status in (403, 422):
        print("      OK — endpoint exists; auth/validation responded.")
        return True
    print(f"      WARN — unexpected status {status}.")
    return status < 500


def check_batch_authenticated(api_key: str) -> bool:
    print(f"\n[4/4] POST {BATCH_URL}  (with FORTYGUARD_API_KEY)")
    payload = {"locations": SAMPLE_LOCATIONS, "hour": 12}
    t0 = time.perf_counter()
    status, body = _request("POST", BATCH_URL, body=payload, api_key=api_key)
    ms = (time.perf_counter() - t0) * 1000
    print(f"      -> HTTP {status} ({ms:.0f} ms)")

    if status != 200:
        detail = body.strip().replace("\n", " ")[:200]
        print(f"      FAIL — {detail}")
        if status == 401:
            print("             The API rejected this key. Check that it is valid and active.")
        return False

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print(f"      FAIL — 200 but body is not JSON: {body[:160]}")
        return False

    readings: List[Dict[str, Any]] = data.get("readings") or []
    print(f"      OK — received {len(readings)} reading(s) for {len(SAMPLE_LOCATIONS)} location(s):")
    for r in readings[:5]:
        print(
            f"         lng={r.get('lng')} lat={r.get('lat')} "
            f"t_ambient={r.get('t_ambient')}°C t_surface={r.get('t_surface')}°C "
            f"shade={r.get('shade_fraction')}"
        )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Check FortyGuard Temperature API availability.")
    parser.add_argument("--key", default=None, help="API key (or set FORTYGUARD_API_KEY env var).")
    args = parser.parse_args()

    api_key: Optional[str] = args.key or os.environ.get("FORTYGUARD_API_KEY")

    print("=" * 64)
    print("FortyGuard Temperature API — diagnostic")
    print("=" * 64)
    if not api_key:
        print("(no API key provided — authenticated test will be skipped)")

    results: List[Tuple[str, bool]] = []

    ok = check_dns_tls()
    results.append(("DNS/TLS", ok))
    if not ok:
        print("\nVERDICT: UNREACHABLE — network/DNS problem or service down.")
        return 1

    results.append(("Server responds", check_root()))
    results.append(("Batch endpoint + auth enforced", check_batch_unauthenticated()))

    if api_key:
        results.append(("Authenticated data fetch", check_batch_authenticated(api_key)))
    else:
        print("\n[4/4] SKIPPED — no API key. Set FORTYGUARD_API_KEY to fully validate.")

    print("\n" + "=" * 64)
    print("SUMMARY")
    all_ok = True
    for name, passed in results:
        mark = "PASS" if passed else "FAIL"
        all_ok &= passed
        print(f"  [{mark}] {name}")
    if not api_key:
        print("\nVERDICT: API IS UP AND REACHABLE. Authentication required for real data;")
        print("provide FORTYGUARD_API_KEY to confirm your subscription works end-to-end.")
    else:
        verdict = "WORKING" if all_ok else "NOT WORKING"
        print(f"\nVERDICT: FortyGuard API is {verdict}.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
