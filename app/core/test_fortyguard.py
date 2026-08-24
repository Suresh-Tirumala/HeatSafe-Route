"""
Unit tests for app.core.fortyguard
──────────────────────────────────
Validates:
  1. FortyGuard API client with exponential backoff
  2. Graceful fallback to OSM distances on API failure
  3. Out-of-bounds metric detection
  4. Timeout handling
  5. Rate limit handling
  6. Conversion helpers (to_heat_data, to_shade_data)
"""

from __future__ import annotations

import json
import math

import pytest

from app.core.fortyguard import (
    FortyGuardClient,
    FortyGuardError,
    FortyGuardOutOfBoundsError,
    FortyGuardRateLimitError,
    FortyGuardResponse,
    FortyGuardTimeoutError,
    ThermalReading,
    _backoff_delay,
    _validate_reading,
    fetch_and_integrate,
)


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def valid_reading():
    return ThermalReading(
        edge_key=("N1", "N2", 0),
        t_ambient=35.0,
        t_surface=48.0,
        shade_fraction=0.15,
        humidity=0.40,
        wind_speed=1.0,
    )


@pytest.fixture
def client():
    return FortyGuardClient(
        api_key="test-key",
        base_url="https://api.fortyguard.com/v1",
        timeout_s=5,
        max_retries=2,
        backoff_base_s=0.01,  # fast tests
        backoff_max_s=0.05,
    )


def _mock_http_success(response_body: dict):
    """Create a mock HTTP GET that returns a successful response."""
    status = 200
    body = json.dumps(response_body)

    def mock_get(url, body_data=None, headers=None):
        return status, body

    return mock_get


def _mock_http_timeout():
    """Create a mock HTTP GET that times out."""
    import urllib.error
    def mock_get(url, body_data=None, headers=None):
        raise urllib.error.URLError("timed out")
    return mock_get


def _mock_http_status(status_code: int, message: str = "error"):
    """Create a mock HTTP GET that returns a specific status code."""
    def mock_get(url, body_data=None, headers=None):
        return status_code, message
    return mock_get


def _mock_http_fail_then_succeed(fail_count: int = 2):
    """Create a mock that fails N times then succeeds."""
    import urllib.error
    call_count = [0]

    def mock_get(url, body_data=None, headers=None):
        call_count[0] += 1
        if call_count[0] <= fail_count:
            raise urllib.error.URLError("connection refused")
        return 200, json.dumps({
            "readings": [
                {"t_ambient": 33.0, "t_surface": 38.0, "shade_fraction": 0.5}
            ]
        })

    return mock_get


# ═══════════════════════════════════════════════════════════════════════
# Tests: Backoff calculation
# ═══════════════════════════════════════════════════════════════════════

class TestBackoffDelay:

    def test_base_delay_first_attempt(self):
        delay = _backoff_delay(0, base_s=1.0, max_s=16.0, jitter=False)
        assert delay == 1.0

    def test_exponential_growth(self):
        delays = [_backoff_delay(i, base_s=1.0, max_s=100.0, jitter=False)
                  for i in range(5)]
        assert delays == [1.0, 2.0, 4.0, 8.0, 16.0]

    def test_capped_at_max(self):
        delay = _backoff_delay(10, base_s=1.0, max_s=8.0, jitter=False)
        assert delay == 8.0

    def test_jitter_adds_variance(self):
        delays = [_backoff_delay(0, base_s=1.0, max_s=16.0, jitter=True)
                  for _ in range(20)]
        # All should be >= 1.0 (base) and <= ~1.5 (base + 50% jitter)
        assert all(d >= 1.0 for d in delays)
        assert any(d > 1.0 for d in delays)  # at least some jitter


# ═══════════════════════════════════════════════════════════════════════
# Tests: Reading validation
# ═══════════════════════════════════════════════════════════════════════

class TestValidateReading:

    def test_valid_reading_passes(self, valid_reading):
        assert _validate_reading(valid_reading) is True

    def test_extreme_heat_still_valid(self):
        r = ThermalReading(
            edge_key=("A", "B"),
            t_ambient=55.0,
            t_surface=75.0,
            shade_fraction=0.0,
        )
        assert _validate_reading(r) is True

    def test_out_of_bounds_ambient_rejects(self):
        r = ThermalReading(
            edge_key=("A", "B"),
            t_ambient=100.0,  # way too hot
            t_surface=50.0,
            shade_fraction=0.0,
        )
        assert _validate_reading(r) is False

    def test_negative_surface_rejects(self):
        r = ThermalReading(
            edge_key=("A", "B"),
            t_ambient=20.0,
            t_surface=-30.0,  # impossible
            shade_fraction=0.5,
        )
        assert _validate_reading(r) is False

    def test_shade_out_of_range_rejects(self):
        r = ThermalReading(
            edge_key=("A", "B"),
            t_ambient=35.0,
            t_surface=45.0,
            shade_fraction=1.5,  # > 1.0
        )
        assert _validate_reading(r) is False


# ═══════════════════════════════════════════════════════════════════════
# Tests: Successful API fetch
# ═══════════════════════════════════════════════════════════════════════

class TestSuccessfulFetch:

    def test_fetch_returns_readings(self, client):
        client._http_get_with_body = _mock_http_success({
            "readings": [
                {"t_ambient": 35.0, "t_surface": 48.0, "shade_fraction": 0.15},
                {"t_ambient": 33.0, "t_surface": 31.0, "shade_fraction": 0.85},
            ]
        })
        response = client.fetch_thermal_readings(
            edge_keys=[("N1", "N2", 0), ("N2", "N3", 0)],
            coordinates=[(35.200, 31.780), (35.202, 31.780)],
        )
        assert response.success is True
        assert len(response.readings) == 2
        assert response.readings[0].t_ambient == 35.0
        assert response.readings[1].shade_fraction == 0.85

    def test_fetch_returns_latency(self, client):
        client._http_get_with_body = _mock_http_success({
            "readings": [{"t_ambient": 30.0, "t_surface": 40.0, "shade_fraction": 0.3}]
        })
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.latency_ms >= 0

    def test_empty_input_returns_success(self, client):
        response = client.fetch_thermal_readings(
            edge_keys=[], coordinates=[],
        )
        assert response.success is True
        assert response.readings == []


# ═══════════════════════════════════════════════════════════════════════
# Tests: Exponential backoff on failure
# ═══════════════════════════════════════════════════════════════════════

class TestExponentialBackoff:

    def test_timeout_retries_then_fails(self, client):
        client._http_get_with_body = _mock_http_timeout()
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.success is False
        assert "timeout" in response.error.lower()

    def test_retries_on_server_error(self, client):
        client._http_get_with_body = _mock_http_status(503, "Service Unavailable")
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.success is False

    def test_succeeds_after_retries(self, client):
        client._http_get_with_body = _mock_http_fail_then_succeed(fail_count=2)
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.success is True
        assert len(response.readings) == 1


# ═══════════════════════════════════════════════════════════════════════
# Tests: Rate limit handling
# ═══════════════════════════════════════════════════════════════════════

class TestRateLimit:

    def test_rate_limit_retries(self, client):
        client._http_get_with_body = _mock_http_status(429, "Too Many Requests")
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.success is False
        assert "rate" in response.error.lower() or "attempts" in response.error.lower()


# ═══════════════════════════════════════════════════════════════════════
# Tests: Out-of-bounds detection
# ═══════════════════════════════════════════════════════════════════════

class TestOutOfBounds:

    def test_out_of_bounds_reading_marked_as_fallback(self, client):
        client._http_get_with_body = _mock_http_success({
            "readings": [
                {"t_ambient": 100.0, "t_surface": 50.0, "shade_fraction": 0.5},  # invalid
                {"t_ambient": 35.0, "t_surface": 45.0, "shade_fraction": 0.2},   # valid
            ]
        })
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B"), ("C", "D")],
            coordinates=[(35.2, 31.78), (35.3, 31.8)],
        )
        assert response.success is True
        assert response.readings[0].source == "fallback"
        assert response.readings[1].source == "fortyguard"


# ═══════════════════════════════════════════════════════════════════════
# Tests: Fallback to OSM distances
# ═══════════════════════════════════════════════════════════════════════

class TestFallback:

    def test_fallback_heat_data_uses_defaults(self, client):
        heat = client.get_fallback_heat_data(
            [("A", "B"), ("C", "D")],
            t_ambient=35.0,
            t_surface=45.0,
        )
        assert heat[("A", "B")] == {"t_ambient": 35.0, "t_surface": 45.0}
        assert heat[("C", "D")] == {"t_ambient": 35.0, "t_surface": 45.0}

    def test_fallback_shade_data_zero(self, client):
        shade = client.get_fallback_shade_data(
            [("A", "B"), ("C", "D")],
            default_shade=0.0,
        )
        assert shade[("A", "B")] == 0.0
        assert shade[("C", "D")] == 0.0

    def test_fetch_and_integrate_fallback_on_failure(self, client):
        client._http_get_with_body = _mock_http_timeout()
        heat, shade, from_api = fetch_and_integrate(
            client,
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert from_api is False
        assert ("A", "B") in heat
        assert heat[("A", "B")]["t_ambient"] == 35.0  # default
        assert shade[("A", "B")] == 0.0  # default OSM

    def test_fetch_and_integrate_uses_api_on_success(self, client):
        client._http_get_with_body = _mock_http_success({
            "readings": [
                {"t_ambient": 33.0, "t_surface": 38.0, "shade_fraction": 0.7}
            ]
        })
        heat, shade, from_api = fetch_and_integrate(
            client,
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert from_api is True
        assert heat[("A", "B")]["t_ambient"] == 33.0
        assert shade[("A", "B")] == 0.7


# ═══════════════════════════════════════════════════════════════════════
# Tests: Conversion helpers
# ═══════════════════════════════════════════════════════════════════════

class TestConversionHelpers:

    def test_to_heat_data(self, client):
        readings = [
            ThermalReading(
                edge_key=("A", "B"), t_ambient=35.0,
                t_surface=48.0, shade_fraction=0.1,
            ),
            ThermalReading(
                edge_key=("C", "D"), t_ambient=32.0,
                t_surface=30.0, shade_fraction=0.8,
            ),
        ]
        heat = client.to_heat_data(readings)
        assert heat[("A", "B")] == {"t_ambient": 35.0, "t_surface": 48.0}
        assert heat[("C", "D")] == {"t_ambient": 32.0, "t_surface": 30.0}

    def test_to_shade_data(self, client):
        readings = [
            ThermalReading(
                edge_key=("A", "B"), t_ambient=35.0,
                t_surface=48.0, shade_fraction=0.15,
            ),
        ]
        shade = client.to_shade_data(readings)
        assert shade[("A", "B")] == 0.15


# ═══════════════════════════════════════════════════════════════════════
# Tests: Edge cases — mismatched inputs
# ═══════════════════════════════════════════════════════════════════════

class TestEdgeCases:

    def test_mismatched_keys_and_coords_returns_error(self, client):
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78), (35.3, 31.8)],
        )
        assert response.success is False
        assert "same length" in response.error

    def test_missing_entries_get_defaults(self, client):
        """API returns fewer readings than requested edges."""
        client._http_get_with_body = _mock_http_success({
            "readings": [
                {"t_ambient": 33.0, "t_surface": 38.0, "shade_fraction": 0.5},
                # second reading missing
            ]
        })
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B"), ("C", "D")],
            coordinates=[(35.2, 31.78), (35.3, 31.8)],
        )
        assert response.success is True
        assert len(response.readings) == 2
        assert response.readings[0].source == "fortyguard"
        assert response.readings[1].source == "default"

    def test_malformed_entry_gets_defaults(self, client):
        """API returns a non-dict entry."""
        client._http_get_with_body = _mock_http_success({
            "readings": ["not_a_dict"]
        })
        response = client.fetch_thermal_readings(
            edge_keys=[("A", "B")],
            coordinates=[(35.2, 31.78)],
        )
        assert response.success is True
        assert response.readings[0].source == "default"
        assert response.readings[0].t_ambient == 35.0  # default
