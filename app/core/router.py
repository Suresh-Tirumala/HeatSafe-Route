"""
HeatSafe Route — Multi-Profile Pathfinding Engine

Generates three distinct routes between an origin and destination:

  1. **Shortest**  — minimises physical distance (metres)
  2. **Coolest**   — minimises total Heat Strain Index cost W_i
  3. **Balanced**  — constrains distance ≤ 115 % of shortest, then
                     maximises shade / minimises heat within that budget

Returns a GeoJSON FeatureCollection with per-route coordinates,
step-by-step navigation instructions, total distance, average shade
percentage, and estimated heat exposure duration.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

import networkx as nx
from shapely.geometry import LineString, Point, mapping

from app.core.cost import (
    EdgeWeightResult,
    HeatStrainResult,
    assign_edge_weights,
    calculate_heat_strain_index,
)

# ─── Constants ────────────────────────────────────────────────────────

_WALKING_SPEED_MS = 1.4          # average pedestrian m/s
_BALANCED_DISTANCE_FACTOR = 1.15  # max distance = 115 % of shortest
_TURN_BEARING_THRESHOLD = 35.0   # degrees – when to generate a turn instruction


# ─── Data Classes ─────────────────────────────────────────────────────

@dataclass
class NavigationStep:
    """A single turn-by-turn instruction."""
    instruction: str
    distance_m: float
    duration_s: float
    bearing_deg: float
    street_name: Optional[str] = None


@dataclass
class RouteResult:
    """Complete result for one route profile."""
    profile: str                        # "shortest" | "coolest" | "balanced"
    coordinates: List[Tuple[float, float]]  # [(lng, lat), ...]
    total_distance_m: float
    total_duration_s: float
    avg_shade_pct: float
    heat_exposure_score: float          # sum of W_i along path
    heat_exposure_duration_s: float     # time spent on segments above baseline
    navigation_steps: List[NavigationStep]
    path_nodes: List[Any]               # ordered node IDs


@dataclass
class TripleRouteResponse:
    """All three routes packaged together."""
    origin: Tuple[float, float]
    destination: Tuple[float, float]
    shortest: RouteResult
    coolest: RouteResult
    balanced: RouteResult


# ─── Graph Helpers ────────────────────────────────────────────────────

def _edge_length(graph: nx.Graph, u: Any, v: Any) -> float:
    """Return the raw distance (length attribute) for edge u→v."""
    data = graph[u][v]
    return data.get("length", data.get("distance_m", 1.0))


def _edge_shade(graph: nx.Graph, u: Any, v: Any) -> float:
    """Return shade fraction stored on edge, or 0.0."""
    data = graph[u][v]
    return data.get("shade_fraction", 0.0)


def _edge_wbgt(graph: nx.Graph, u: Any, v: Any) -> float:
    """Return WBGT proxy stored on edge, or 0.0."""
    data = graph[u][v]
    return data.get("wbgt_proxy", 0.0)


def _edge_weight(graph: nx.Graph, u: Any, v: Any) -> float:
    """Return composite weight W_i stored on edge."""
    data = graph[u][v]
    return data.get("weight", _edge_length(graph, u, v))


def _node_coords(graph: nx.Graph, node: Any) -> Tuple[float, float]:
    """Return (lng, lat) for a node."""
    nd = graph.nodes[node]
    return (nd.get("x", nd.get("lng", 0.0)), nd.get("y", nd.get("lat", 0.0)))


def _build_linestring(graph: nx.Graph, path: List[Any]) -> LineString:
    """Construct a LineString from ordered node coordinates."""
    coords = [_node_coords(graph, n) for n in path]
    if len(coords) < 2:
        return LineString(coords + coords)  # degenerate
    return LineString(coords)


# ─── Bearing & Turn Helpers ───────────────────────────────────────────

def _bearing(from_pt: Tuple[float, float], to_pt: Tuple[float, float]) -> float:
    """Initial bearing in degrees from north between two (lng, lat) points."""
    lng1, lat1 = math.radians(from_pt[0]), math.radians(from_pt[1])
    lng2, lat2 = math.radians(to_pt[0]), math.radians(to_pt[1])
    d_lng = lng2 - lng1
    x = math.sin(d_lng) * math.cos(lat2)
    y = (math.cos(lat1) * math.sin(lat2)
         - math.sin(lat1) * math.cos(lat2) * math.cos(d_lng))
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _bearing_label(deg: float) -> str:
    """Convert compass bearing to human-readable label."""
    dirs = ["north", "northeast", "east", "southeast",
            "south", "southwest", "west", "northwest"]
    idx = round(deg / 45.0) % 8
    return dirs[idx]


def _turn_instruction(
    prev_bearing: float, curr_bearing: float, distance_m: float,
    street_name: Optional[str], is_start: bool, is_end: bool
) -> str:
    """Generate a single navigation instruction string."""
    if is_start:
        label = _bearing_label(curr_bearing)
        street = f" on {street_name}" if street_name else ""
        return f"Head {label}{street} for {distance_m:.0f} m"

    if is_end:
        return f"Arrive at destination after {distance_m:.0f} m"

    diff = (curr_bearing - prev_bearing + 360.0) % 360.0
    if diff < 180:
        turn = "turn right"
        detail = f"slightly {turn}" if diff < _TURN_BEARING_THRESHOLD else turn
    else:
        turn = "turn left"
        detail = f"slightly {turn}" if (360.0 - diff) < _TURN_BEARING_THRESHOLD else turn

    street = f" onto {street_name}" if street_name else ""
    return f"{detail.capitalize()}{street} for {distance_m:.0f} m"


# ─── Path Analytics ───────────────────────────────────────────────────

def _path_distance(graph: nx.Graph, path: List[Any]) -> float:
    """Sum of raw distances along path."""
    return sum(_edge_length(graph, path[i], path[i + 1])
               for i in range(len(path) - 1))


def _path_heat_cost(graph: nx.Graph, path: List[Any]) -> float:
    """Sum of composite weights W_i along path."""
    return sum(_edge_weight(graph, path[i], path[i + 1])
               for i in range(len(path) - 1))


def _path_avg_shade(graph: nx.Graph, path: List[Any]) -> float:
    """Distance-weighted average shade fraction along path."""
    total_dist = 0.0
    weighted_shade = 0.0
    for i in range(len(path) - 1):
        d = _edge_length(graph, path[i], path[i + 1])
        s = _edge_shade(graph, path[i], path[i + 1])
        weighted_shade += d * s
        total_dist += d
    return (weighted_shade / total_dist * 100.0) if total_dist > 0 else 0.0


def _path_heat_exposure_duration(graph: nx.Graph, path: List[Any]) -> float:
    """
    Time (seconds) spent on segments where WBGT proxy exceeds the
    baseline threshold (25 °C).  Uses walking speed to convert.
    """
    total = 0.0
    for i in range(len(path) - 1):
        wbgt = _edge_wbgt(graph, path[i], path[i + 1])
        if wbgt > 25.0:
            d = _edge_length(graph, path[i], path[i + 1])
            total += d / _WALKING_SPEED_MS
    return total


def _build_navigation_steps(
    graph: nx.Graph, path: List[Any]
) -> List[NavigationStep]:
    """Produce turn-by-turn instructions from an ordered node path."""
    if len(path) < 2:
        return []

    steps: List[NavigationStep] = []
    seg_start = 0
    bearings: List[float] = []

    for i in range(1, len(path)):
        pt_prev = _node_coords(graph, path[i - 1])
        pt_curr = _node_coords(graph, path[i])
        bearings.append(_bearing(pt_prev, pt_curr))

    for i, b in enumerate(bearings):
        is_first = (i == 0)
        is_last = (i == len(bearings) - 1)

        # Compute bearing change from previous segment
        if is_first:
            diff = 0.0
        else:
            diff = abs(b - bearings[i - 1])
            diff = min(diff, 360.0 - diff)

        should_emit = is_first or is_last or diff >= _TURN_BEARING_THRESHOLD

        if should_emit:
            seg_dist = sum(
                _edge_length(graph, path[j], path[j + 1])
                for j in range(seg_start, i + 1)
            )
            street = graph[path[i]][path[i + 1]].get("name") if i + 1 < len(path) else None
            instruction = _turn_instruction(
                bearings[i - 1] if not is_first else b,
                b, seg_dist, street,
                is_start=is_first, is_end=is_last,
            )
            steps.append(NavigationStep(
                instruction=instruction,
                distance_m=round(seg_dist, 1),
                duration_s=round(seg_dist / _WALKING_SPEED_MS, 1),
                bearing_deg=round(b, 1),
                street_name=street,
            ))
            seg_start = i

    return steps


def _build_route_result(
    graph: nx.Graph, path: List[Any], profile: str
) -> RouteResult:
    """Assemble a complete RouteResult for a given path."""
    coords = [_node_coords(graph, n) for n in path]
    total_dist = _path_distance(graph, path)

    return RouteResult(
        profile=profile,
        coordinates=coords,
        total_distance_m=round(total_dist, 2),
        total_duration_s=round(total_dist / _WALKING_SPEED_MS, 1),
        avg_shade_pct=round(_path_avg_shade(graph, path), 1),
        heat_exposure_score=round(_path_heat_cost(graph, path), 2),
        heat_exposure_duration_s=round(_path_heat_exposure_duration(graph, path), 1),
        navigation_steps=_build_navigation_steps(graph, path),
        path_nodes=list(path),
    )


# ─── Core Routing Functions ───────────────────────────────────────────

def find_shortest_route(
    graph: nx.Graph, origin: Any, destination: Any
) -> Optional[List[Any]]:
    """
    Shortest path by physical distance.

    Uses edge attribute ``length`` (metres) as weight.
    """
    try:
        return nx.shortest_path(graph, origin, destination, weight="length")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def find_coolest_route(
    graph: nx.Graph, origin: Any, destination: Any
) -> Optional[List[Any]]:
    """
    Path minimising total Heat Strain Index cost.

    Uses edge attribute ``weight`` (composite W_i) as weight.
    The graph must already have heat-aware weights assigned.
    """
    try:
        return nx.shortest_path(graph, origin, destination, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def find_balanced_route(
    graph: nx.Graph,
    origin: Any,
    destination: Any,
    distance_factor: float = _BALANCED_DISTANCE_FACTOR,
) -> Optional[List[Any]]:
    """
    Constrained pathfinding: distance ≤ distance_factor × shortest_distance,
    but total heat cost W_i is minimised within that budget.

    Algorithm (label-setting):
      1. Compute shortest distance D* for the budget ceiling.
      2. Enumerate heat-optimal paths via ``shortest_simple_paths``
         ordered by ``weight`` (ascending heat cost).
      3. Return the first path whose physical distance ≤ D* × factor.

    Falls back to the coolest route if no constrained path exists.
    """
    # ── 1. Compute distance budget ────────────────────────────────────
    shortest_dist = None
    try:
        shortest_path = nx.shortest_path(
            graph, origin, destination, weight="length"
        )
        shortest_dist = _path_distance(graph, shortest_path)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None

    max_dist = shortest_dist * distance_factor

    # ── 2. Enumerate paths by ascending heat cost ─────────────────────
    try:
        for path in nx.shortest_simple_paths(graph, origin, destination, weight="weight"):
            path_dist = _path_distance(graph, path)
            if path_dist <= max_dist:
                return path
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None

    # ── 3. Fallback: return coolest route (exceeds budget) ────────────
    return find_coolest_route(graph, origin, destination)


# ─── Main Entry Point ─────────────────────────────────────────────────

def generate_triple_route(
    graph: nx.Graph,
    origin: Tuple[float, float],
    destination: Tuple[float, float],
    nearest_node_fn: Any = None,
) -> Optional[TripleRouteResponse]:
    """
    Compute shortest, coolest, and balanced routes and return a
    structured response ready for GeoJSON serialisation.

    Parameters
    ----------
    graph : nx.Graph
        Weighted pedestrian graph.  Must have ``length`` and ``weight``
        edge attributes, and ``x``/``y`` (or ``lng``/``lat``) node attrs.
    origin : (lng, lat)
    destination : (lng, lat)
    nearest_node_fn : callable, optional
        ``fn(graph, (lng, lat)) -> node_id``  snaps a coordinate to the
        nearest graph node.  If None, tries direct node lookup.

    Returns
    -------
    TripleRouteResponse or None
    """
    # ── Snap coordinates to graph nodes ───────────────────────────────
    if nearest_node_fn is not None:
        origin_node = nearest_node_fn(graph, origin)
        dest_node = nearest_node_fn(graph, destination)
    else:
        origin_node = _snap_to_nearest(graph, origin)
        dest_node = _snap_to_nearest(graph, destination)

    if origin_node is None or dest_node is None:
        return None

    # ── Compute three routes ──────────────────────────────────────────
    shortest_path = find_shortest_route(graph, origin_node, dest_node)
    coolest_path = find_coolest_route(graph, origin_node, dest_node)
    balanced_path = find_balanced_route(graph, origin_node, dest_node)

    if not shortest_path:
        return None

    # Use available paths; fall back to shortest for missing routes
    shortest_result = _build_route_result(graph, shortest_path, "shortest")
    coolest_result = _build_route_result(
        graph, coolest_path or shortest_path, "coolest"
    )
    balanced_result = _build_route_result(
        graph, balanced_path or shortest_path, "balanced"
    )

    return TripleRouteResponse(
        origin=origin,
        destination=destination,
        shortest=shortest_result,
        coolest=coolest_result,
        balanced=balanced_result,
    )


# ─── GeoJSON Serialiser ──────────────────────────────────────────────

def _route_to_geojson_feature(route: RouteResult) -> Dict:
    """Convert a RouteResult into a GeoJSON Feature."""
    coords = route.coordinates

    feature = {
        "type": "Feature",
        "geometry": mapping(LineString(coords)) if len(coords) >= 2 else {
            "type": "Point", "coordinates": coords[0] if coords else [0, 0]
        },
        "properties": {
            "route_type": route.profile,
            "total_distance_m": route.total_distance_m,
            "total_duration_s": route.total_duration_s,
            "avg_shade_pct": route.avg_shade_pct,
            "heat_exposure_score": route.heat_exposure_score,
            "heat_exposure_duration_s": route.heat_exposure_duration_s,
            "navigation_steps": [
                {
                    "instruction": s.instruction,
                    "distance_m": s.distance_m,
                    "duration_s": s.duration_s,
                    "bearing_deg": s.bearing_deg,
                    "street_name": s.street_name,
                }
                for s in route.navigation_steps
            ],
            "path_node_count": len(route.path_nodes),
        },
    }
    return feature


def triple_route_to_geojson(response: TripleRouteResponse) -> Dict:
    """
    Serialise a TripleRouteResponse into a GeoJSON FeatureCollection.

    Each route becomes a Feature with LineString geometry and a
    ``properties`` block containing all navigation metadata.
    """
    features = []
    for route in [response.shortest, response.coolest, response.balanced]:
        features.append(_route_to_geojson_feature(route))

    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "origin": {"lng": response.origin[0], "lat": response.origin[1]},
            "destination": {
                "lng": response.destination[0],
                "lat": response.destination[1],
            },
            "distance_comparison": {
                "shortest_m": response.shortest.total_distance_m,
                "coolest_m": response.coolest.total_distance_m,
                "balanced_m": response.balanced.total_distance_m,
            },
            "heat_exposure_comparison": {
                "shortest_score": response.shortest.heat_exposure_score,
                "coolest_score": response.coolest.heat_exposure_score,
                "balanced_score": response.balanced.heat_exposure_score,
            },
            "shade_comparison": {
                "shortest_avg_shade_pct": response.shortest.avg_shade_pct,
                "coolest_avg_shade_pct": response.coolest.avg_shade_pct,
                "balanced_avg_shade_pct": response.balanced.avg_shade_pct,
            },
        },
    }


# ─── Snap Helper ──────────────────────────────────────────────────────

def _snap_to_nearest(
    graph: nx.Graph, coord: Tuple[float, float]
) -> Optional[Any]:
    """Find the nearest graph node to a (lng, lat) coordinate."""
    lng, lat = coord
    best_node = None
    best_dist = float("inf")
    for node in graph.nodes():
        nd = graph.nodes[node]
        nx_ = nd.get("x", nd.get("lng", 0.0))
        ny = nd.get("y", nd.get("lat", 0.0))
        d = math.hypot(nx_ - lng, ny - lat)
        if d < best_dist:
            best_dist = d
            best_node = node
    return best_node
