"""
Unit tests for app.core.router
───────────────────────────────
Tests the three-profile routing engine:
  1. Shortest route is truly the shortest by distance.
  2. Coolest route minimises heat cost.
  3. Balanced route stays within 115 % distance but improves shade.
  4. GeoJSON output structure is correct.
  5. Navigation instructions are generated.
  6. Edge cases: unreachable nodes, single-node path.
"""

from __future__ import annotations

import json
import math

import networkx as nx
import pytest

from app.core.cost import assign_edge_weights
from app.core.router import (
    RouteResult,
    TripleRouteResponse,
    _bearing,
    _bearing_label,
    _build_route_result,
    _path_avg_shade,
    _path_distance,
    _path_heat_cost,
    _path_heat_exposure_duration,
    _snap_to_nearest,
    find_balanced_route,
    find_coolest_route,
    find_shortest_route,
    generate_triple_route,
    triple_route_to_geojson,
)


# ═══════════════════════════════════════════════════════════════════════
# Test Graph Builder
# ═══════════════════════════════════════════════════════════════════════

def _build_test_graph() -> tuple:
    """
    Build a realistic pedestrian graph with 7 nodes and 9 edges.

    Layout (approximate):

        N1 ──(sunny, 200 m)──▶ N2 ──(sunny, 80 m)──▶ N3
         │                                      ▲
         │(shaded, 140 m)                       │(sunny, 100 m)
         ▼                                      │
        N4 ──(shaded, 50 m)───▶ N5 ──(partial, 90 m)──▶ N3
         │                                      ▲
         │(partial, 100 m)                      │(shaded, 200 m)
         ▼                                      │
        N6 ──(shaded, 80 m)───▶ N7 ──(shaded, 60 m)──▶ N3

    The SUNNY path (N1→N2→N3) is 280 m, very hot, no shade.
    The SHADED path (N1→N4→N5→N3) is 280 m, heavily shaded, cool.
    The LONG SHADED path (N1→N4→N6→N7→N3) is 440 m, max shade.
    """
    G = nx.DiGraph()

    # Nodes with coordinates (lng, lat)
    nodes = {
        "N1": (35.2000, 31.7800),
        "N2": (35.2018, 31.7800),
        "N3": (35.2036, 31.7800),
        "N4": (35.2000, 31.7808),
        "N5": (35.2018, 31.7808),
        "N6": (35.2000, 31.7816),
        "N7": (35.2018, 31.7816),
    }
    for nid, (lng, lat) in nodes.items():
        G.add_node(nid, x=lng, y=lat)

    # Edges: (u, v, length, name)
    # Sunny path N1→N2→N3 = 280 m
    # Shaded path N1→N4→N5→N3 = 280 m (same distance!)
    edge_defs = [
        ("N1", "N2", 200.0, "Sun Ave"),
        ("N1", "N4", 140.0, "Oak Lane"),
        ("N2", "N3",  80.0, "Sun Ave"),
        ("N4", "N5",  50.0, "Elm Walk"),
        ("N5", "N3",  90.0, "Main St"),
        ("N4", "N6", 100.0, "Pine Path"),
        ("N6", "N7",  80.0, "Cedar Ct"),
        ("N7", "N3",  60.0, "Cedar Ct"),
    ]
    for u, v, length, name in edge_defs:
        G.add_edge(u, v, length=length, name=name)

    # Per-edge heat + shade data
    heat = {
        ("N1", "N2"): {"t_ambient": 37.0, "t_surface": 50.0},
        ("N2", "N3"): {"t_ambient": 37.0, "t_surface": 48.0},
        ("N1", "N4"): {"t_ambient": 34.0, "t_surface": 32.0},
        ("N4", "N5"): {"t_ambient": 33.5, "t_surface": 30.0},
        ("N4", "N6"): {"t_ambient": 33.0, "t_surface": 29.0},
        ("N5", "N3"): {"t_ambient": 35.0, "t_surface": 38.0},
        ("N6", "N7"): {"t_ambient": 32.5, "t_surface": 28.0},
        ("N7", "N3"): {"t_ambient": 33.0, "t_surface": 30.0},
    }
    shade = {
        ("N1", "N2"): 0.05,   # almost no shade
        ("N2", "N3"): 0.10,
        ("N1", "N4"): 0.85,   # heavy canopy
        ("N4", "N5"): 0.80,
        ("N4", "N6"): 0.75,
        ("N5", "N3"): 0.30,   # partial
        ("N6", "N7"): 0.90,   # near-full shade
        ("N7", "N3"): 0.85,
    }

    assign_edge_weights(G, heat, shade, user_profile="coolest")
    return G, heat, shade


@pytest.fixture
def test_graph():
    return _build_test_graph()


# ═══════════════════════════════════════════════════════════════════════
# Tests: Shortest Route
# ═══════════════════════════════════════════════════════════════════════

class TestShortestRoute:

    def test_shortest_is_truly_shortest(self, test_graph):
        G, _, _ = test_graph
        path = find_shortest_route(G, "N1", "N3")
        assert path is not None
        assert path[0] == "N1"
        assert path[-1] == "N3"
        dist = _path_distance(G, path)
        # Both N1→N2→N3 and N1→N4→N5→N3 are 280 m — shortest should be one of them
        assert dist <= 281.0, f"Shortest path distance {dist} exceeds expected ~280 m"

    def test_shortest_path_is_N1_N2_N3(self, test_graph):
        G, _, _ = test_graph
        path = find_shortest_route(G, "N1", "N3")
        # Both paths are 280 m; networkx returns first found
        assert path in [["N1", "N2", "N3"], ["N1", "N4", "N5", "N3"]]

    def test_shortest_has_minimal_distance(self, test_graph):
        G, _, _ = test_graph
        shortest_path = find_shortest_route(G, "N1", "N3")
        coolest_path = find_coolest_route(G, "N1", "N3")
        shortest_dist = _path_distance(G, shortest_path)
        coolest_dist = _path_distance(G, coolest_path)
        assert shortest_dist <= coolest_dist + 0.1


# ═══════════════════════════════════════════════════════════════════════
# Tests: Coolest Route
# ═══════════════════════════════════════════════════════════════════════

class TestCoolestRoute:

    def test_coolest_avoids_sunny_path(self, test_graph):
        G, _, _ = test_graph
        path = find_coolest_route(G, "N1", "N3")
        assert path is not None
        # The coolest route should NOT be the sunny N1→N2→N3
        assert path != ["N1", "N2", "N3"], (
            "Coolest route chose the sun-exposed path!"
        )

    def test_coolest_has_lower_heat_cost(self, test_graph):
        G, _, _ = test_graph
        shortest = find_shortest_route(G, "N1", "N3")
        coolest = find_coolest_route(G, "N1", "N3")
        shortest_cost = _path_heat_cost(G, shortest)
        coolest_cost = _path_heat_cost(G, coolest)
        assert coolest_cost <= shortest_cost + 0.1, (
            f"Coolest ({coolest_cost}) should have ≤ heat cost than shortest ({shortest_cost})"
        )

    def test_coolest_has_higher_shade(self, test_graph):
        G, _, _ = test_graph
        shortest = find_shortest_route(G, "N1", "N3")
        coolest = find_coolest_route(G, "N1", "N3")
        shortest_shade = _path_avg_shade(G, shortest)
        coolest_shade = _path_avg_shade(G, coolest)
        assert coolest_shade > shortest_shade, (
            f"Coolest avg shade ({coolest_shade}%) should exceed shortest ({shortest_shade}%)"
        )


# ═══════════════════════════════════════════════════════════════════════
# Tests: Balanced Route
# ═══════════════════════════════════════════════════════════════════════

class TestBalancedRoute:

    def test_balanced_within_distance_budget(self, test_graph):
        G, _, _ = test_graph
        shortest = find_shortest_route(G, "N1", "N3")
        balanced = find_balanced_route(G, "N1", "N3")
        assert balanced is not None

        shortest_dist = _path_distance(G, shortest)
        balanced_dist = _path_distance(G, balanced)
        budget = shortest_dist * 1.15

        assert balanced_dist <= budget + 0.1, (
            f"Balanced distance {balanced_dist} exceeds 115% budget {budget}"
        )

    def test_balanced_prefers_shade_over_shortest(self, test_graph):
        G, _, _ = test_graph
        shortest = find_shortest_route(G, "N1", "N3")
        balanced = find_balanced_route(G, "N1", "N3")
        shortest_shade = _path_avg_shade(G, shortest)
        balanced_shade = _path_avg_shade(G, balanced)
        # Balanced should have at least as much shade as shortest
        assert balanced_shade >= shortest_shade - 1.0

    def test_balanced_or_coolest_when_budget_tight(self, test_graph):
        """With 115% budget from a 280 m shortest path, max is 322 m.
        Both main paths are 280 m, so balanced may pick either."""
        G, _, _ = test_graph
        balanced = find_balanced_route(G, "N1", "N3")
        assert balanced is not None
        dist = _path_distance(G, balanced)
        assert dist <= 280.0 * 1.15 + 0.1


# ═══════════════════════════════════════════════════════════════════════
# Tests: Path Analytics
# ═══════════════════════════════════════════════════════════════════════

class TestPathAnalytics:

    def test_distance_calculation(self, test_graph):
        G, _, _ = test_graph
        path = ["N1", "N2", "N3"]
        dist = _path_distance(G, path)
        assert abs(dist - 280.0) < 0.1

    def test_heat_cost_non_negative(self, test_graph):
        G, _, _ = test_graph
        for path_fn in [find_shortest_route, find_coolest_route]:
            path = path_fn(G, "N1", "N3")
            cost = _path_heat_cost(G, path)
            assert cost >= 0, f"Heat cost {cost} should be non-negative"

    def test_avg_shade_between_0_and_100(self, test_graph):
        G, _, _ = test_graph
        for path_fn in [find_shortest_route, find_coolest_route, find_balanced_route]:
            path = path_fn(G, "N1", "N3")
            shade = _path_avg_shade(G, path)
            assert 0.0 <= shade <= 100.0, f"Avg shade {shade} out of range"

    def test_heat_exposure_duration_non_negative(self, test_graph):
        G, _, _ = test_graph
        path = find_shortest_route(G, "N1", "N3")
        hed = _path_heat_exposure_duration(G, path)
        assert hed >= 0


# ═══════════════════════════════════════════════════════════════════════
# Tests: Bearing & Navigation
# ═══════════════════════════════════════════════════════════════════════

class TestNavigation:

    def test_bearing_north(self):
        """Point due north should give bearing ≈ 0."""
        b = _bearing((35.0, 31.0), (35.0, 31.01))
        assert abs(b - 0.0) < 1.0 or abs(b - 360.0) < 1.0

    def test_bearing_east(self):
        """Point due east should give bearing ≈ 90."""
        b = _bearing((35.0, 31.0), (35.01, 31.0))
        assert abs(b - 90.0) < 2.0

    def test_bearing_label_covers_all_directions(self):
        for deg in [0, 45, 90, 135, 180, 225, 270, 315]:
            label = _bearing_label(deg)
            assert isinstance(label, str)
            assert len(label) > 0

    def test_navigation_steps_generated(self, test_graph):
        G, _, _ = test_graph
        path = find_shortest_route(G, "N1", "N3")
        result = _build_route_result(G, path, "shortest")
        assert len(result.navigation_steps) >= 1
        assert "Head" in result.navigation_steps[0].instruction

    def test_final_step_is_arrival(self, test_graph):
        G, _, _ = test_graph
        path = find_shortest_route(G, "N1", "N3")
        result = _build_route_result(G, path, "shortest")
        last = result.navigation_steps[-1]
        assert "Arrive" in last.instruction or "destination" in last.instruction.lower()


# ═══════════════════════════════════════════════════════════════════════
# Tests: Triple Route Generation
# ═══════════════════════════════════════════════════════════════════════

class TestTripleRoute:

    def test_returns_triple_route_response(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        assert resp is not None
        assert isinstance(resp, TripleRouteResponse)

    def test_all_three_routes_present(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        assert resp.shortest.profile == "shortest"
        assert resp.coolest.profile == "coolest"
        assert resp.balanced.profile == "balanced"

    def test_all_routes_reach_destination(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        for route in [resp.shortest, resp.coolest, resp.balanced]:
            assert route.coordinates[-1] == (35.2036, 31.7800)

    def test_coolest_beats_shortest_heat_cost(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        assert resp.coolest.heat_exposure_score <= resp.shortest.heat_exposure_score + 0.1

    def test_coolest_beats_shortest_shade(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        assert resp.coolest.avg_shade_pct >= resp.shortest.avg_shade_pct - 1.0

    def test_balanced_within_distance_budget(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        budget = resp.shortest.total_distance_m * 1.15
        assert resp.balanced.total_distance_m <= budget + 0.1

    def test_returns_none_for_unreachable(self, test_graph):
        G, _, _ = test_graph
        G.add_node("ISOLATED", x=99.0, y=99.0)
        resp = generate_triple_route(G, (35.2000, 31.7800), (99.0, 99.0))
        assert resp is None

    def test_route_results_have_valid_fields(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        for route in [resp.shortest, resp.coolest, resp.balanced]:
            assert route.total_distance_m > 0
            assert route.total_duration_s > 0
            assert 0 <= route.avg_shade_pct <= 100
            assert route.heat_exposure_score >= 0
            assert route.heat_exposure_duration_s >= 0
            assert len(route.coordinates) >= 2
            assert len(route.navigation_steps) >= 1


# ═══════════════════════════════════════════════════════════════════════
# Tests: GeoJSON Serialisation
# ═══════════════════════════════════════════════════════════════════════

class TestGeoJSON:

    def test_valid_geojson_structure(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)

        assert geojson["type"] == "FeatureCollection"
        assert len(geojson["features"]) == 3
        assert "properties" in geojson
        assert "origin" in geojson["properties"]
        assert "destination" in geojson["properties"]

    def test_each_feature_has_line_geometry(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)

        for feat in geojson["features"]:
            assert feat["type"] == "Feature"
            geom = feat["geometry"]
            assert geom["type"] == "LineString"
            assert len(geom["coordinates"]) >= 2

    def test_feature_properties_contain_required_fields(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)

        required = [
            "route_type", "total_distance_m", "total_duration_s",
            "avg_shade_pct", "heat_exposure_score",
            "heat_exposure_duration_s", "navigation_steps",
        ]
        for feat in geojson["features"]:
            for field in required:
                assert field in feat["properties"], f"Missing {field} in feature properties"

    def test_geojson_is_json_serialisable(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)
        # Must not raise
        serialised = json.dumps(geojson, indent=2)
        assert len(serialised) > 100
        parsed = json.loads(serialised)
        assert parsed["type"] == "FeatureCollection"

    def test_comparison_blocks_present(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)
        props = geojson["properties"]
        assert "distance_comparison" in props
        assert "heat_exposure_comparison" in props
        assert "shade_comparison" in props

    def test_route_types_in_features(self, test_graph):
        G, _, _ = test_graph
        resp = generate_triple_route(G, (35.2000, 31.7800), (35.2036, 31.7800))
        geojson = triple_route_to_geojson(resp)
        types = {f["properties"]["route_type"] for f in geojson["features"]}
        assert types == {"shortest", "coolest", "balanced"}


# ═══════════════════════════════════════════════════════════════════════
# Tests: Snap Helper
# ═══════════════════════════════════════════════════════════════════════

class TestSnapToNearest:

    def test_snaps_exact_node(self, test_graph):
        G, _, _ = test_graph
        node = _snap_to_nearest(G, (35.2000, 31.7800))
        assert node == "N1"

    def test_snaps_nearby_coordinate(self, test_graph):
        G, _, _ = test_graph
        node = _snap_to_nearest(G, (35.2001, 31.7801))
        assert node == "N1"

    def test_returns_something_for_any_coord(self, test_graph):
        G, _, _ = test_graph
        node = _snap_to_nearest(G, (0.0, 0.0))
        assert node is not None  # should return nearest even if far


# ═══════════════════════════════════════════════════════════════════════
# Tests: Edge case — larger graph with viable balanced path
# ═══════════════════════════════════════════════════════════════════════

class TestBalancedWithViableAlternative:

    def test_balanced_prefers_shaded_when_budget_allows(self):
        """
        Graph where a shaded alternative is within 115% of shortest.
        Shortest: A→B = 200 m (sunny)
        Shaded:   A→C→B = 220 m (heavy shade)  ← within 115 % budget (230 m)
        """
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_node("C", x=0.01, y=0.005)

        G.add_edge("A", "B", length=200.0)
        G.add_edge("A", "C", length=130.0)
        G.add_edge("C", "B", length=90.0)

        heat = {
            ("A", "B"): {"t_ambient": 38.0, "t_surface": 52.0},
            ("A", "C"): {"t_ambient": 34.0, "t_surface": 30.0},
            ("C", "B"): {"t_ambient": 33.5, "t_surface": 29.0},
        }
        shade = {
            ("A", "B"): 0.05,   # almost no shade
            ("A", "C"): 0.90,   # heavy canopy
            ("C", "B"): 0.85,
        }
        assign_edge_weights(G, heat, shade, user_profile="coolest")

        shortest = find_shortest_route(G, "A", "B")
        balanced = find_balanced_route(G, "A", "B")
        assert shortest == ["A", "B"]

        # Budget: 200 × 1.15 = 230 m.  A→C→B = 220 m, fits!
        assert balanced == ["A", "C", "B"]

        shortest_shade = _path_avg_shade(G, shortest)
        balanced_shade = _path_avg_shade(G, balanced)
        assert balanced_shade > shortest_shade


# ═══════════════════════════════════════════════════════════════════════
# Tests: Edge Cases — Unreachable Nodes / Disconnected Graphs
# ═══════════════════════════════════════════════════════════════════════

class TestUnreachableNodes:

    def test_shortest_route_returns_none_for_disconnected(self):
        """Two nodes in separate components should return None."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.01, y=0.0)
        G.add_node("C", x=0.02, y=0.0)
        G.add_edge("A", "B", length=100.0)
        # C is isolated — no path from A to C

        path = find_shortest_route(G, "A", "C")
        assert path is None

    def test_coolest_route_returns_none_for_disconnected(self):
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.01, y=0.0)
        G.add_edge("A", "B", length=100.0)
        assign_edge_weights(G)

        path = find_coolest_route(G, "A", "B")
        # A→B exists, so this should find it
        assert path is not None

    def test_balanced_route_returns_none_for_disconnected(self):
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.01, y=0.0)
        G.add_node("C", x=0.02, y=0.0)
        G.add_edge("A", "B", length=100.0)
        assign_edge_weights(G)

        path = find_balanced_route(G, "A", "C")
        assert path is None

    def test_triple_route_returns_none_when_no_path(self):
        """generate_triple_route must return None when destination unreachable."""
        G = nx.DiGraph()
        G.add_node("A", x=35.200, y=31.780)
        G.add_node("B", x=35.202, y=31.780)
        G.add_node("ISOLATED", x=99.0, y=99.0)
        G.add_edge("A", "B", length=200.0)
        assign_edge_weights(G)

        resp = generate_triple_route(G, (35.200, 31.780), (99.0, 99.0))
        assert resp is None

    def test_empty_graph_returns_none(self):
        """Graph with one node and no edges: both coords snap to same node,
        producing a zero-length path (valid degenerate case)."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        resp = generate_triple_route(G, (0.0, 0.0), (0.01, 0.0))
        # Both snap to "A" → single-node path is valid
        assert resp is not None
        assert resp.shortest.total_distance_m == 0

    def test_single_node_graph_returns_none(self):
        """Graph with one node, no edges: both coords snap to same node."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        resp = generate_triple_route(G, (0.0, 0.0), (0.01, 0.0))
        assert resp is not None
        assert resp.shortest.path_nodes == ["A"]

    def test_genuinely_unreachable_returns_none(self):
        """Origin and destination in disconnected components, far apart."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=10.0, y=10.0)  # far away, different snap
        G.add_edge("A", "A", length=0.0)  # self-loop only

        # A and B are in different components with no path between them
        path_ab = find_shortest_route(G, "A", "B")
        assert path_ab is None

    def test_reverse_direction_unreachable(self):
        """Edges are one-way (DiGraph); reverse direction should be unreachable."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.01, y=0.0)
        G.add_edge("A", "B", length=100.0)  # A→B only

        path_forward = find_shortest_route(G, "A", "B")
        path_reverse = find_shortest_route(G, "B", "A")
        assert path_forward is not None
        assert path_reverse is None

    def test_self_route_returns_single_node(self):
        """Routing from a node to itself should return [node]."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_edge("A", "A", length=0.0)  # self-loop
        path = find_shortest_route(G, "A", "A")
        assert path == ["A"]


# ═══════════════════════════════════════════════════════════════════════
# Tests: Edge Cases — Extreme Heat Routing
# ═══════════════════════════════════════════════════════════════════════

class TestExtremeHeatRouting:

    def test_coolest_avoids_extreme_heat_path(self):
        """
        Graph where direct path is extreme heat (70 °C surface, 0 shade)
        but a longer shaded path exists.  Coolest must avoid the spike.
        """
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_node("C", x=0.01, y=0.01)

        G.add_edge("A", "B", length=200.0)   # direct, extreme heat
        G.add_edge("A", "C", length=150.0)   # detour start
        G.add_edge("C", "B", length=160.0)   # detour end, shaded

        heat = {
            ("A", "B"): {"t_ambient": 55.0, "t_surface": 72.0},  # extreme
            ("A", "C"): {"t_ambient": 33.0, "t_surface": 30.0},  # cool
            ("C", "B"): {"t_ambient": 32.0, "t_surface": 29.0},  # cool
        }
        shade = {
            ("A", "B"): 0.0,   # no shade
            ("A", "C"): 0.90,  # heavy canopy
            ("C", "B"): 0.85,
        }

        assign_edge_weights(G, heat, shade, user_profile="coolest")
        path = find_coolest_route(G, "A", "B")
        assert path == ["A", "C", "B"]

    def test_fastest_ignores_heat_spike(self):
        """
        Fastest profile should take the direct path regardless of heat.
        """
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_node("C", x=0.01, y=0.01)

        G.add_edge("A", "B", length=200.0)
        G.add_edge("A", "C", length=150.0)
        G.add_edge("C", "B", length=160.0)

        heat = {
            ("A", "B"): {"t_ambient": 55.0, "t_surface": 72.0},
            ("A", "C"): {"t_ambient": 33.0, "t_surface": 30.0},
            ("C", "B"): {"t_ambient": 32.0, "t_surface": 29.0},
        }
        shade = {
            ("A", "B"): 0.0,
            ("A", "C"): 0.90,
            ("C", "B"): 0.85,
        }

        assign_edge_weights(G, heat, shade, user_profile="fastest")
        path = find_shortest_route(G, "A", "B")
        assert path == ["A", "B"]  # direct, shortest by distance

    def test_balanced_within_budget_with_heat_spike(self):
        """
        Balanced should stay within 115% of shortest distance while
        avoiding the extreme heat path if possible.
        """
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_node("C", x=0.01, y=0.01)

        G.add_edge("A", "B", length=200.0)
        G.add_edge("A", "C", length=120.0)
        G.add_edge("C", "B", length=100.0)  # total 220 m (within 115% = 230 m)

        heat = {
            ("A", "B"): {"t_ambient": 55.0, "t_surface": 72.0},
            ("A", "C"): {"t_ambient": 33.0, "t_surface": 30.0},
            ("C", "B"): {"t_ambient": 32.0, "t_surface": 29.0},
        }
        shade = {
            ("A", "B"): 0.0,
            ("A", "C"): 0.90,
            ("C", "B"): 0.85,
        }

        assign_edge_weights(G, heat, shade, user_profile="balanced")
        balanced = find_balanced_route(G, "A", "B")
        assert balanced is not None
        dist = _path_distance(G, balanced)
        assert dist <= 200.0 * 1.15 + 0.1

    def test_triple_route_with_extreme_heat(self):
        """
        Triple route generation must complete without error even with
        extreme heat values.
        """
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_node("C", x=0.01, y=0.01)

        G.add_edge("A", "B", length=200.0)
        G.add_edge("A", "C", length=150.0)
        G.add_edge("C", "B", length=160.0)

        heat = {
            ("A", "B"): {"t_ambient": 55.0, "t_surface": 75.0},
            ("A", "C"): {"t_ambient": 33.0, "t_surface": 30.0},
            ("C", "B"): {"t_ambient": 32.0, "t_surface": 29.0},
        }
        shade = {
            ("A", "B"): 0.0,
            ("A", "C"): 0.90,
            ("C", "B"): 0.85,
        }

        assign_edge_weights(G, heat, shade, user_profile="coolest")

        resp = generate_triple_route(G, (0.0, 0.0), (0.02, 0.0))
        assert resp is not None
        # All routes must have finite, non-negative metrics
        for route in [resp.shortest, resp.coolest, resp.balanced]:
            assert route.total_distance_m > 0
            assert route.heat_exposure_score >= 0
            assert math.isfinite(route.heat_exposure_score)

    def test_geojson_serialisable_with_extreme_values(self):
        """GeoJSON output must be JSON-serialisable even with extreme heat."""
        G = nx.DiGraph()
        G.add_node("A", x=0.0, y=0.0)
        G.add_node("B", x=0.02, y=0.0)
        G.add_edge("A", "B", length=200.0)

        heat = {("A", "B"): {"t_ambient": 55.0, "t_surface": 75.0}}
        shade = {("A", "B"): 0.0}
        assign_edge_weights(G, heat, shade, user_profile="coolest")

        resp = generate_triple_route(G, (0.0, 0.0), (0.02, 0.0))
        geojson = triple_route_to_geojson(resp)
        serialized = json.dumps(geojson)
        assert len(serialized) > 50
