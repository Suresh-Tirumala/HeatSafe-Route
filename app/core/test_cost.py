"""
Unit tests for app.core.cost
─────────────────────────────
Validates:
  1. calculate_heat_strain_index returns correct WBGT proxy bounds and monotonicity.
  2. assign_edge_weights correctly penalises sun-exposed asphalt vs shaded paths.
  3. User profiles ("coolest", "fastest", "balanced") produce expected ordering.
  4. Edge cases: extreme temps, full shade, zero distance.
"""

from __future__ import annotations

import math

import networkx as nx
import pytest

from app.core.cost import (
    EdgeWeightResult,
    HeatStrainResult,
    assign_edge_weights,
    calculate_heat_strain_index,
)


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def sunny_asphalt_edge() -> tuple[nx.DiGraph, dict]:
    """200 m of asphalt in full sun, 45 °C surface, 35 °C ambient."""
    G = nx.DiGraph()
    G.add_edge("A", "B", length=200.0)
    shade = {("A", "B"): 0.0}
    heat = {("A", "B"): {"t_ambient": 35.0, "t_surface": 45.0}}
    return G, heat, shade


@pytest.fixture
def shaded_path_edge() -> tuple[nx.DiGraph, dict]:
    """260 m of tree-lined path, 31 °C surface, 34 °C ambient, 80 % shade."""
    G = nx.DiGraph()
    G.add_edge("A", "C", length=260.0)
    shade = {("A", "C"): 0.80}
    heat = {("A", "C"): {"t_ambient": 34.0, "t_surface": 31.0}}
    return G, heat, shade


@pytest.fixture
def mixed_graph() -> nx.MultiDiGraph:
    """Graph with three edges for profile comparison tests."""
    G = nx.MultiDiGraph()
    # Edge 1: short, hot, no shade
    G.add_edge("X", "Y", key=0, length=150.0)
    # Edge 2: medium, moderate heat, partial shade
    G.add_edge("X", "Y", key=1, length=220.0)
    # Edge 3: long, cool, heavy shade
    G.add_edge("X", "Y", key=2, length=300.0)
    return G


# ═══════════════════════════════════════════════════════════════════════
# Tests: calculate_heat_strain_index
# ═══════════════════════════════════════════════════════════════════════

class TestHeatStrainIndex:

    def test_returns_dataclass(self):
        result = calculate_heat_strain_index(
            t_ambient=35.0, t_surface=50.0, shade_fraction=0.0
        )
        assert isinstance(result, HeatStrainResult)

    def test_wbgt_range_reasonable(self):
        """WBGT proxy should stay within physically plausible bounds."""
        result = calculate_heat_strain_index(35.0, 55.0, 0.0)
        assert 20.0 <= result.wbgt_proxy <= 50.0

    def test_full_sun_hotter_than_full_shade(self):
        """Same conditions, but shade=0 vs shade=1 must yield WBGT difference."""
        no_shade = calculate_heat_strain_index(38.0, 52.0, 0.0)
        full_shade = calculate_heat_strain_index(38.0, 52.0, 1.0)
        assert no_shade.wbgt_proxy > full_shade.wbgt_proxy

    def test_delta_t_clamped_at_baseline(self):
        """Below 25 °C baseline, delta_t must be 0."""
        result = calculate_heat_strain_index(20.0, 22.0, 1.0)
        assert result.delta_t == 0.0

    def test_higher_surface_temp_increases_wbgt(self):
        """Increasing surface temperature with everything else constant must raise WBGT."""
        low = calculate_heat_strain_index(35.0, 35.0, 0.0)
        med = calculate_heat_strain_index(35.0, 45.0, 0.0)
        high = calculate_heat_strain_index(35.0, 55.0, 0.0)
        assert low.wbgt_proxy < med.wbgt_proxy < high.wbgt_proxy

    def test_shade_fraction_monotonicity(self):
        """Increasing shade must monotonically reduce WBGT proxy."""
        wbgts = []
        for s in [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]:
            r = calculate_heat_strain_index(37.0, 50.0, s)
            wbgts.append(r.wbgt_proxy)
        # Each must be ≤ the previous
        for i in range(1, len(wbgts)):
            assert wbgts[i] <= wbgts[i - 1] + 0.01  # small tolerance for float

    def test_humidity_effect(self):
        """Higher humidity should increase heat index."""
        low_rh = calculate_heat_strain_index(35.0, 45.0, 0.0, humidity=0.20)
        high_rh = calculate_heat_strain_index(35.0, 45.0, 0.0, humidity=0.90)
        assert high_rh.heat_index > low_rh.heat_index


# ═══════════════════════════════════════════════════════════════════════
# Tests: assign_edge_weights  — THE KEY VALIDATION
# ═══════════════════════════════════════════════════════════════════════

class TestAssignEdgeWeights:

    def test_sunny_asphalt_higher_weight_than_shaded_path(self):
        """
        ┌─────────────────────────────────────────────────────────────┐
        │  VALIDATES THE CORE REQUIREMENT:                           │
        │  A 200 m sun-exposed asphalt edge MUST have a higher       │
        │  composite weight than a 260 m heavily-shaded edge,        │
        │  so the router prefers the longer shaded detour.            │
        └─────────────────────────────────────────────────────────────┘
        """
        # ── Build combined graph ──────────────────────────────────────
        G = nx.DiGraph()
        G.add_edge("A", "B", length=200.0)  # sunny asphalt
        G.add_edge("A", "C", length=260.0)  # shaded path

        heat = {
            ("A", "B"): {"t_ambient": 35.0, "t_surface": 45.0},
            ("A", "C"): {"t_ambient": 34.0, "t_surface": 31.0},
        }
        shade = {
            ("A", "B"): 0.0,    # full sun
            ("A", "C"): 0.80,   # heavy tree canopy
        }

        results = assign_edge_weights(G, heat, shade, user_profile="coolest")

        sunny = results[("A", "B", 0)]
        shaded = results[("A", "C", 0)]

        # The 200 m sunny edge should cost MORE than the 260 m shaded edge
        assert sunny.final_weight > shaded.final_weight, (
            f"Sunny 200 m edge (weight={sunny.final_weight}) should cost MORE "
            f"than shaded 260 m edge (weight={shaded.final_weight}). "
            f"The router would incorrectly prefer the hot exposed path!"
        )

        print(f"\n  ✓ Sunny  200 m → weight = {sunny.final_weight}")
        print(f"  ✓ Shaded 260 m → weight = {shaded.final_weight}")
        print(f"  ✓ Shaded path is cheaper by {sunny.final_weight - shaded.final_weight:.2f}")

    def test_fastest_profile_ignores_heat(self):
        """With 'fastest' profile, heat should not affect weight at all."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=200.0)
        heat = {("A", "B"): {"t_ambient": 50.0, "t_surface": 60.0}}
        shade = {("A", "B"): 0.0}

        results = assign_edge_weights(G, heat, shade, user_profile="fastest")
        edge = results[("A", "B", 0)]

        # Weight must equal raw distance (floored at 0.01)
        assert edge.final_weight == 200.0, (
            f"fastest profile returned {edge.final_weight}, expected 200.0"
        )

    def test_balanced_between_coolest_and_fastest(self):
        """'balanced' should land between 'fastest' and 'coolest'."""
        heat = {("A", "B"): {"t_ambient": 38.0, "t_surface": 50.0}}
        shade = {("A", "B"): 0.0}

        def weight_for(profile):
            G = nx.DiGraph()
            G.add_edge("A", "B", length=200.0)
            r = assign_edge_weights(G, heat, shade, user_profile=profile)
            return r[("A", "B", 0)].final_weight

        w_fast = weight_for("fastest")
        w_bal = weight_for("balanced")
        w_cool = weight_for("coolest")

        assert w_fast <= w_bal <= w_cool, (
            f"Expected fastest({w_fast}) ≤ balanced({w_bal}) ≤ coolest({w_cool})"
        )

    def test_weight_floor_at_001(self):
        """Negative heat penalty (cool shade) must not produce ≤ 0 weight."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=1.0)  # 1 metre edge
        heat = {("A", "B"): {"t_ambient": 20.0, "t_surface": 20.0}}
        shade = {("A", "B"): 1.0}

        results = assign_edge_weights(G, heat, shade, user_profile="coolest")
        assert results[("A", "B", 0)].final_weight >= 0.01

    def test_heat_data_fallback_to_defaults(self):
        """When heat_data is None, default t_ambient/t_surface are used."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=100.0)

        results = assign_edge_weights(
            G, heat_data=None, shade_data=None,
            t_ambient=40.0, t_surface=55.0,
        )
        edge = results[("A", "B", 0)]
        assert edge.wbgt_proxy > 25.0  # should be well above baseline

    def test_multigraph_edge_keys_preserved(self):
        """MultiDiGraph with parallel edges should handle each key separately."""
        G = nx.MultiDiGraph()
        G.add_edge("A", "B", key="sun", length=100.0)
        G.add_edge("A", "B", key="shade", length=100.0)

        shade = {
            ("A", "B", "sun"): 0.0,
            ("A", "B", "shade"): 0.90,
        }
        heat = {
            ("A", "B", "sun"): {"t_ambient": 38.0, "t_surface": 50.0},
            ("A", "B", "shade"): {"t_ambient": 34.0, "t_surface": 32.0},
        }

        results = assign_edge_weights(G, heat, shade)
        sun_w = results[("A", "B", "sun")].final_weight
        shade_w = results[("A", "B", "shade")].final_weight
        assert sun_w > shade_w

    def test_results_mutate_graph_weight(self):
        """assign_edge_weights must set 'weight' attribute on graph edges."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=100.0)
        assign_edge_weights(G, t_ambient=40.0, t_surface=50.0)
        assert "weight" in G["A"]["B"]
        assert G["A"]["B"]["weight"] > 0


# ═══════════════════════════════════════════════════════════════════════
# Tests: route preference integration
# ═══════════════════════════════════════════════════════════════════════

class TestRoutePreference:

    def test_dijkstra_prefers_shaded_detour(self):
        """
        Integration test: Dijkstra on a two-path graph should choose
        the longer shaded path over the shorter sun-exposed one.

        Graph:
            A ──200 m (full sun, 45 °C surface)──▶ B
            A ──260 m (80% shade, 31 °C surface)──▶ C
            B ──10 m ──▶ C

        Shortest-distance route: A→B→C = 210 m
        Heat-aware route:         A→C   = 260 m  (should be cheaper)
        """
        G = nx.DiGraph()
        G.add_edge("A", "B", length=200.0)
        G.add_edge("B", "C", length=10.0)
        G.add_edge("A", "C", length=260.0)

        heat = {
            ("A", "B"): {"t_ambient": 35.0, "t_surface": 45.0},
            ("B", "C"): {"t_ambient": 35.0, "t_surface": 40.0},
            ("A", "C"): {"t_ambient": 34.0, "t_surface": 31.0},
        }
        shade = {
            ("A", "B"): 0.0,   # full sun
            ("B", "C"): 0.10,  # barely shaded
            ("A", "C"): 0.80,  # heavily shaded
        }

        assign_edge_weights(G, heat, shade, user_profile="coolest")

        # Verify the route A→C is chosen over A→B→C
        path = nx.shortest_path(G, "A", "C", weight="weight")
        cost_direct = nx.shortest_path_length(G, "A", "C", weight="weight")
        cost_via_b = (
            G["A"]["B"]["weight"] + G["B"]["C"]["weight"]
        )

        assert path == ["A", "C"], (
            f"Dijkstra chose {path} (cost={cost_direct}) instead of ['A','C']. "
            f"Via B would cost {cost_via_b}. "
            f"The shaded detour should win!"
        )
        assert cost_direct < cost_via_b


# ═══════════════════════════════════════════════════════════════════════
# Tests: Edge Cases — Extreme Heat / Zero Shade / Thermal Spikes
# ═══════════════════════════════════════════════════════════════════════

class TestExtremeHeatEdgeCases:

    def test_extreme_heat_no_shade_weight_finite(self):
        """
        T_surf = 70 °C, T_amb = 55 °C, shade = 0.
        Weight must remain finite and not explode to infinity.
        """
        G = nx.DiGraph()
        G.add_edge("A", "B", length=200.0)
        heat = {("A", "B"): {"t_ambient": 55.0, "t_surface": 70.0}}
        shade = {("A", "B"): 0.0}

        results = assign_edge_weights(G, heat, shade, user_profile="coolest")
        w = results[("A", "B", 0)].final_weight

        assert math.isfinite(w), f"Weight {w} is not finite!"
        assert w > 0, f"Weight {w} must be positive"
        assert w < 1_000_000, f"Weight {w} is unreasonably large"

    def test_extreme_heat_weight_bounded_by_formula(self):
        """
        Even with T_surf = 80 °C (max plausible), the weight should be
        bounded by distance × (1 + γ × max_delta_t).
        """
        G = nx.DiGraph()
        G.add_edge("A", "B", length=100.0)
        heat = {("A", "B"): {"t_ambient": 60.0, "t_surface": 80.0}}
        shade = {("A", "B"): 0.0}

        results = assign_edge_weights(G, heat, shade, user_profile="coolest")
        w = results[("A", "B", 0)].final_weight

        # WBGT proxy at these extremes is bounded, so weight is bounded
        assert w < 50_000, f"Weight {w} exceeds reasonable bound"

    def test_zero_shade_all_profiles_finite(self):
        """Zero shade with high heat must produce finite weights for all profiles."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=150.0)
        heat = {("A", "B"): {"t_ambient": 42.0, "t_surface": 60.0}}
        shade = {("A", "B"): 0.0}

        for profile in ["coolest", "fastest", "balanced"]:
            G2 = nx.DiGraph()
            G2.add_edge("A", "B", length=150.0)
            results = assign_edge_weights(G2, heat, shade, user_profile=profile)
            w = results[("A", "B", 0)].final_weight
            assert math.isfinite(w), f"Profile {profile}: weight {w} is not finite"
            assert w >= 0.01, f"Profile {profile}: weight {w} below floor"

    def test_weight_floor_prevents_zero(self):
        """Tiny edge with strong shade must still have weight >= 0.01."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=0.1)  # 10 cm edge
        heat = {("A", "B"): {"t_ambient": 20.0, "t_surface": 20.0}}
        shade = {("A", "B"): 1.0}  # full shade

        results = assign_edge_weights(G, heat, shade, user_profile="coolest")
        assert results[("A", "B", 0)].final_weight >= 0.01

    def test_no_infinite_loops_in_dijkstra(self):
        """
        Graph with extreme heat on one edge must not cause Dijkstra to
        loop infinitely or produce overflow.
        """
        G = nx.DiGraph()
        G.add_node("S", x=0.0, y=0.0)
        G.add_node("M", x=0.01, y=0.0)
        G.add_node("T", x=0.02, y=0.0)

        G.add_edge("S", "M", length=100.0)
        G.add_edge("M", "T", length=100.0)
        G.add_edge("S", "T", length=500.0)  # direct but extreme heat

        heat = {
            ("S", "M"): {"t_ambient": 30.0, "t_surface": 32.0},
            ("M", "T"): {"t_ambient": 30.0, "t_surface": 32.0},
            ("S", "T"): {"t_ambient": 55.0, "t_surface": 75.0},  # extreme
        }
        shade = {
            ("S", "M"): 0.8,
            ("M", "T"): 0.8,
            ("S", "T"): 0.0,
        }

        assign_edge_weights(G, heat, shade, user_profile="coolest")

        # Dijkstra must complete without error
        path = nx.shortest_path(G, "S", "T", weight="weight")
        assert path is not None
        assert path[0] == "S" and path[-1] == "T"

    def test_all_same_heat_produces_distance_ordering(self):
        """When all edges have identical heat, routing should match distance."""
        G = nx.DiGraph()
        G.add_edge("A", "B", length=100.0)
        G.add_edge("A", "C", length=200.0)
        G.add_edge("C", "B", length=10.0)

        heat = {
            ("A", "B"): {"t_ambient": 35.0, "t_surface": 45.0},
            ("A", "C"): {"t_ambient": 35.0, "t_surface": 45.0},
            ("C", "B"): {"t_ambient": 35.0, "t_surface": 45.0},
        }
        shade = {
            ("A", "B"): 0.0,
            ("A", "C"): 0.0,
            ("C", "B"): 0.0,
        }

        assign_edge_weights(G, heat, shade, user_profile="coolest")

        # All edges have same heat → weight ∝ distance → shortest wins
        path = nx.shortest_path(G, "A", "B", weight="weight")
        assert path == ["A", "B"]
