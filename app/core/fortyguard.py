"""
HeatSafe Route — FortyGuard Temperature API Client

Fetches real-time street-segment thermal data from FortyGuard's
Temperature API and integrates it into the edge-weighting pipeline.

Features:
  - Exponential backoff with jitter on transient failures
  - Graceful fallback to standard OSM distances when the API is
    unreachable, times out, or returns out-of-bounds metrics
  - Pluggable transport (default: urllib; swap for httpx/aiohttp)
"""

from __future__ import annotations

import json
import logging
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────

_DEFAULT_BASE_URL = "https://api.fortyguard.com/v1"
_DEFAULT_TIMEOUT_S = 10
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_BACKOFF_BASE_S = 1.0
_DEFAULT_BACKOFF_MAX_S = 16.0

# Valid WBGT proxy bounds — readings outside these are flagged
_WBGT_MIN_C = -10.0
_WBGT_MAX_C = 65.0

# Valid surface temperature bounds
_SURFACE_TEMP_MIN_C = -20.0
_SURFACE_TEMP_MAX_C = 80.0

# Valid shade fraction bounds
_SHADE_MIN = 0.0
_SHADE_MAX = 1.0


# ─── Data Classes ─────────────────────────────────────────────────────

@dataclass
class ThermalReading:
    """A single edge's thermal data from FortyGuard."""
    edge_key: Tuple[Any, ...]
    t_ambient: float          # °C
    t_surface: float          # °C
    shade_fraction: float     # 0.0 – 1.0
    humidity: float = 0.40    # 0.0 – 1.0 (default when unavailable)
    wind_speed: float = 1.0   # m/s
    source: str = "fortyguard"  # or "fallback" / "default"


@dataclass
class FortyGuardResponse:
    """Response from the FortyGuard API."""
    readings: List[ThermalReading]
    success: bool
    error: Optional[str] = None
    latency_ms: float = 0.0
    from_cache: bool = False


# ─── Exception Types ──────────────────────────────────────────────────

class FortyGuardError(Exception):
    """Base exception for FortyGuard client errors."""
    pass


class FortyGuardTimeoutError(FortyGuardError):
    """API request timed out."""
    pass


class FortyGuardRateLimitError(FortyGuardError):
    """API rate limit exceeded (429)."""
    pass


class FortyGuardOutOfBoundsError(FortyGuardError):
    """API returned metrics outside valid physical bounds."""
    pass


# ─── HTTP Transport ───────────────────────────────────────────────────

def _http_get(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout_s: float = _DEFAULT_TIMEOUT_S,
) -> Tuple[int, str]:
    """
    Minimal HTTP GET using urllib.  Returns (status_code, body_text).

    Raises urllib.error.URLError on network failures.
    """
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, body


# ─── Exponential Backoff ──────────────────────────────────────────────

def _backoff_delay(
    attempt: int,
    base_s: float = _DEFAULT_BACKOFF_BASE_S,
    max_s: float = _DEFAULT_BACKOFF_MAX_S,
    jitter: bool = True,
) -> float:
    """
    Compute exponential backoff delay with optional jitter.

    delay = min(base * 2^attempt, max) + random_jitter
    """
    delay = min(base_s * (2 ** attempt), max_s)
    if jitter:
        import random
        delay += random.uniform(0, delay * 0.5)
    return delay


def _is_retryable(status_code: int) -> bool:
    """Return True if the HTTP status indicates a transient failure."""
    return status_code in (429, 500, 502, 503, 504)


def _validate_reading(reading: ThermalReading) -> bool:
    """Return True if a reading is within physically plausible bounds."""
    if not (_WBGT_MIN_C <= reading.t_ambient <= _WBGT_MAX_C):
        return False
    if not (_SURFACE_TEMP_MIN_C <= reading.t_surface <= _SURFACE_TEMP_MAX_C):
        return False
    if not (_SHADE_MIN <= reading.shade_fraction <= _SHADE_MAX):
        return False
    return True


# ─── FortyGuard Client ───────────────────────────────────────────────

class FortyGuardClient:
    """
    Client for FortyGuard's Temperature API.

    Usage::

        client = FortyGuardClient(api_key="fg_...")
        response = client.fetch_thermal_readings(
            edge_keys=[("N1", "N2", 0), ("N2", "N3", 0)],
            coordinates=[(35.200, 31.780), (35.202, 31.780)],
        )
        if response.success:
            heat_data = client.to_heat_data(response.readings)
        else:
            heat_data = {}  # fallback to defaults
    """

    def __init__(
        self,
        api_key: str = "",
        base_url: str = _DEFAULT_BASE_URL,
        timeout_s: float = _DEFAULT_TIMEOUT_S,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        backoff_base_s: float = _DEFAULT_BACKOFF_BASE_S,
        backoff_max_s: float = _DEFAULT_BACKOFF_MAX_S,
        http_get_fn: Any = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.backoff_max_s = backoff_max_s
        self._http_get = http_get_fn or _http_get

    def fetch_thermal_readings(
        self,
        edge_keys: List[Tuple[Any, ...]],
        coordinates: List[Tuple[float, float]],
        hour: Optional[int] = None,
    ) -> FortyGuardResponse:
        """
        Fetch thermal readings for a batch of edges.

        Parameters
        ----------
        edge_keys : list of tuples
            Graph edge identifiers, one per coordinate pair.
        coordinates : list of (lng, lat)
            Midpoint coordinates for each edge.
        hour : int, optional
            Hour of day (0–23). If None, uses server-side current time.

        Returns
        -------
        FortyGuardResponse
            Contains readings, success flag, and error info.
        """
        if not edge_keys or not coordinates:
            return FortyGuardResponse(readings=[], success=True)

        if len(edge_keys) != len(coordinates):
            return FortyGuardResponse(
                readings=[],
                success=False,
                error="edge_keys and coordinates must have same length",
            )

        t_start = time.monotonic()

        # ── Build request payload ──────────────────────────────────────
        payload = {
            "locations": [
                {"lng": lng, "lat": lat}
                for lng, lat in coordinates
            ],
        }
        if hour is not None:
            payload["hour"] = hour

        # ── Retry loop with exponential backoff ────────────────────────
        last_error: Optional[str] = None
        for attempt in range(self.max_retries + 1):
            try:
                readings = self._do_fetch(edge_keys, payload)
                latency = (time.monotonic() - t_start) * 1000

                # Validate bounds
                invalid = [r for r in readings if not _validate_reading(r)]
                if invalid:
                    logger.warning(
                        "FortyGuard returned %d out-of-bounds readings; "
                        "falling back to defaults for those edges",
                        len(invalid),
                    )
                    # Mark invalid readings as fallback
                    for r in invalid:
                        r.source = "fallback"

                return FortyGuardResponse(
                    readings=readings,
                    success=True,
                    latency_ms=round(latency, 1),
                )

            except FortyGuardTimeoutError:
                last_error = "timeout"
                logger.warning(
                    "FortyGuard API timeout (attempt %d/%d)",
                    attempt + 1, self.max_retries + 1,
                )
            except FortyGuardRateLimitError:
                last_error = "rate_limited"
                logger.warning(
                    "FortyGuard API rate limited (attempt %d/%d)",
                    attempt + 1, self.max_retries + 1,
                )
            except FortyGuardError as e:
                last_error = str(e)
                logger.warning(
                    "FortyGuard API error: %s (attempt %d/%d)",
                    e, attempt + 1, self.max_retries + 1,
                )
            except Exception as e:
                last_error = f"unexpected: {e}"
                logger.error(
                    "FortyGuard API unexpected error: %s (attempt %d/%d)",
                    e, attempt + 1, self.max_retries + 1,
                )

            # Backoff before retry (skip on last attempt)
            if attempt < self.max_retries:
                delay = _backoff_delay(
                    attempt, self.backoff_base_s, self.backoff_max_s
                )
                logger.info("Retrying in %.1f s...", delay)
                time.sleep(delay)

        # ── All retries exhausted — return failure ─────────────────────
        latency = (time.monotonic() - t_start) * 1000
        return FortyGuardResponse(
            readings=[],
            success=False,
            error=f"All {self.max_retries + 1} attempts failed: {last_error}",
            latency_ms=round(latency, 1),
        )

    def _do_fetch(
        self,
        edge_keys: List[Tuple[Any, ...]],
        payload: Dict[str, Any],
    ) -> List[ThermalReading]:
        """
        Execute a single HTTP request and parse the response.

        Raises FortyGuardTimeoutError, FortyGuardRateLimitError, etc.
        """
        url = f"{self.base_url}/temperature/batch"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        # NOTE: verified against live API (2026-08): FortyGuard expects a
        # custom "api-key" request header, NOT an Authorization bearer token.
        if self.api_key:
            headers["api-key"] = self.api_key

        body = json.dumps(payload)

        try:
            status, response_text = self._http_get_with_body(
                url, body, headers
            )
        except urllib.error.URLError as e:
            if "timed out" in str(e).lower():
                raise FortyGuardTimeoutError(str(e))
            raise FortyGuardError(f"Network error: {e}")

        if status == 429:
            raise FortyGuardRateLimitError("Rate limit exceeded")
        if status == 408:
            raise FortyGuardTimeoutError("Request timeout (408)")
        if status >= 400:
            raise FortyGuardError(f"HTTP {status}: {response_text[:200]}")

        # Parse response
        try:
            data = json.loads(response_text)
        except json.JSONDecodeError as e:
            raise FortyGuardError(f"Invalid JSON response: {e}")

        return self._parse_readings(edge_keys, data)

    def _http_get_with_body(
        self,
        url: str,
        body: str,
        headers: Dict[str, str],
    ) -> Tuple[int, str]:
        """
        HTTP POST (using urllib with POST method) for batch requests.

        Returns (status_code, body_text).
        """
        req = urllib.request.Request(
            url,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
            response_body = resp.read().decode("utf-8")
            return resp.status, response_body

    def _parse_readings(
        self,
        edge_keys: List[Tuple[Any, ...]],
        api_response: Dict[str, Any],
    ) -> List[ThermalReading]:
        """
        Parse the FortyGuard API response into ThermalReading objects.

        Expected response format::

            {
              "readings": [
                {"t_ambient": 35.2, "t_surface": 48.1, "shade_fraction": 0.1, "humidity": 0.4},
                ...
              ]
            }

        Falls back to defaults for missing or malformed entries.
        """
        raw_readings = api_response.get("readings", [])
        result: List[ThermalReading] = []

        for i, edge_key in enumerate(edge_keys):
            if i < len(raw_readings):
                raw = raw_readings[i]
                if isinstance(raw, dict):
                    result.append(ThermalReading(
                        edge_key=edge_key,
                        t_ambient=float(raw.get("t_ambient", 35.0)),
                        t_surface=float(raw.get("t_surface", 45.0)),
                        shade_fraction=float(raw.get("shade_fraction", 0.0)),
                        humidity=float(raw.get("humidity", 0.40)),
                        wind_speed=float(raw.get("wind_speed", 1.0)),
                        source="fortyguard",
                    ))
                else:
                    # Malformed entry — use defaults
                    result.append(ThermalReading(
                        edge_key=edge_key,
                        t_ambient=35.0,
                        t_surface=45.0,
                        shade_fraction=0.0,
                        source="default",
                    ))
            else:
                # Missing entry — use defaults
                result.append(ThermalReading(
                    edge_key=edge_key,
                    t_ambient=35.0,
                    t_surface=45.0,
                    shade_fraction=0.0,
                    source="default",
                ))

        return result

    # ── Conversion helpers ─────────────────────────────────────────────

    def to_heat_data(
        self, readings: List[ThermalReading]
    ) -> Dict[Tuple[Any, ...], Dict[str, float]]:
        """
        Convert ThermalReadings to the heat_data dict expected by
        ``assign_edge_weights()``.
        """
        return {
            r.edge_key: {
                "t_ambient": r.t_ambient,
                "t_surface": r.t_surface,
            }
            for r in readings
        }

    def to_shade_data(
        self, readings: List[ThermalReading]
    ) -> Dict[Tuple[Any, ...], float]:
        """
        Convert ThermalReadings to the shade_data dict expected by
        ``assign_edge_weights()``.
        """
        return {
            r.edge_key: r.shade_fraction
            for r in readings
        }

    def get_fallback_heat_data(
        self,
        edge_keys: List[Tuple[Any, ...]],
        t_ambient: float = 35.0,
        t_surface: float = 45.0,
    ) -> Dict[Tuple[Any, ...], Dict[str, float]]:
        """
        Generate fallback heat data using standard defaults.

        Used when the FortyGuard API is completely unreachable.
        """
        return {
            key: {"t_ambient": t_ambient, "t_surface": t_surface}
            for key in edge_keys
        }

    def get_fallback_shade_data(
        self,
        edge_keys: List[Tuple[Any, ...]],
        default_shade: float = 0.0,
    ) -> Dict[Tuple[Any, ...], float]:
        """
        Generate fallback shade data using standard OSM defaults.

        Used when the FortyGuard API is completely unreachable.
        """
        return {key: default_shade for key in edge_keys}


# ─── Convenience: fetch and integrate in one call ─────────────────────

def fetch_and_integrate(
    client: FortyGuardClient,
    edge_keys: List[Tuple[Any, ...]],
    coordinates: List[Tuple[float, float]],
    graph: Any = None,
    hour: Optional[int] = None,
) -> Tuple[Dict, Dict, bool]:
    """
    Fetch FortyGuard data and return heat_data + shade_data dicts,
    with automatic fallback on failure.

    Returns
    -------
    (heat_data, shade_data, from_api)
        from_api is True if FortyGuard data was used, False for fallbacks.
    """
    response = client.fetch_thermal_readings(edge_keys, coordinates, hour)

    if response.success and response.readings:
        heat_data = client.to_heat_data(response.readings)
        shade_data = client.to_shade_data(response.readings)

        # Separate fallback readings from real ones
        fallback_keys = [
            r.edge_key for r in response.readings if r.source != "fortyguard"
        ]
        if fallback_keys:
            logger.info(
                "%d/%d edges using default values (out-of-bounds or missing)",
                len(fallback_keys), len(edge_keys),
            )

        return heat_data, shade_data, True

    # ── Fallback: standard OSM distances ───────────────────────────────
    logger.warning(
        "FortyGuard API unavailable (%s); falling back to OSM distances",
        response.error,
    )
    heat_data = client.get_fallback_heat_data(edge_keys)
    shade_data = client.get_fallback_shade_data(edge_keys)
    return heat_data, shade_data, False
