"""
HeatSafe Route — Dynamic Edge Weight Calculator

Computes WBGT-proxy heat strain indices and assigns composite routing
weights to every edge in a NetworkX pedestrian graph.

Weight formula
--------------
    W_i = Distance_i × (1 + γ · WBGT_i − β · S_i)

where:
    WBGT_i  = calculate_heat_strain_index(T_amb, T_surf, S_i)
    S_i     = shade fraction ∈ [0, 1]
    γ       = heat sensitivity coefficient (default 0.20)
    β       = shade benefit coefficient   (default 0.08)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Literal, Union

import geopandas as gpd
import networkx as nx
import numpy as np
from shapely.geometry import LineString, Point

# ─── Constants ────────────────────────────────────────────────────────

# WBGT approximation coefficients (Liljegren et al. 2008 simplified)
_HUMIDITY_DEFAULT = 0.40  # 40 % RH when unavailable
_TNOM = 25.0              # nominal baseline temp (°C) below which penalty = 0
_EMISSIVITY = 0.95        # asphalt / concrete long-wave emissivity
_STEFAN_BOLTZMANN = 5.67e-8
_WIND_SPEED_MS = 1.0      # assumed pedestrian walking speed component


# ─── Data Classes ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class HeatStrainResult:
    """Output of calculate_heat_strain_index."""
    wbgt_proxy: float          # °C  (Wet-Bulb Globe Temperature estimate)
    heat_index: float          # °C  (simplified Rothfusz heat index)
    mean_radiant_temp: float   # °C  (estimated T_mrt)
    delta_t: float             # °C  (wbgt_proxy − baseline 25 °C, clamped ≥ 0)


@dataclass
class EdgeWeightResult:
    """Per-edge weight computation output."""
    u: Any
    v: Any
    edge_key: Any
    distance_m: float
    wbgt_proxy: float
    shade_fraction: float
    heat_penalty: float
    shade_discount: float
    final_weight: float


# ─── WBGT Proxy Calculator ───────────────────────────────────────────

def calculate_heat_strain_index(
    t_ambient: float,
    t_surface: float,
    shade_fraction: float,
    humidity: float = _HUMIDITY_DEFAULT,
    wind_speed: float = _WIND_SPEED_MS,
) -> HeatStrainResult:
    """
    Estimate a Wet-Bulb Globe Temperature (WBGT) proxy from local
    micro-climate measurements.

    The model combines three sub-estimates:

    1. **Mean Radiant Temperature (T_mrt)**
       Approximated from surface temperature and shade fraction.
       Full sun on hot asphalt can push T_mrt 20–30 °C above ambient;
       shade drastically reduces this.

       T_mrt = T_ambient + (T_surface − T_ambient) × (1 − S) × K_rad

       where K_rad ≈ 0.85 is a long-wave radiation coupling factor.

    2. **Simplified Heat Index (HI)**
       Rothfusz-style regression from T_ambient and relative humidity,
       representing the physiological effect of air temp + moisture.

       HI = −42.379 + 2.04901523·T + 10.14333127·RH
            − 0.22475541·T·RH − 0.00683783·T² − 0.05481717·RH²
            + 0.00122874·T²·RH + 0.00085282·T·RH² − 0.00000199·T²·RH²

    3. **WBGT Proxy**
       Weighted combination (Steadman 1979 approximation):

       WBGT ≈ 0.7 × T_wb + 0.2 × T_g + 0.1 × T_air

       We substitute T_wb with a wet-bulb estimate from T_air + RH,
       and T_g with the globe temperature estimated from T_mrt.

    Parameters
    ----------
    t_ambient : float
        Air temperature in °C (−20 to 60).
    t_surface : float
        Ground surface temperature in °C (may exceed 60 °C on asphalt).
    shade_fraction : float
        Proportion of sky obstructed ∈ [0.0, 1.0].
        0.0 = full sun, 1.0 = full shade.
    humidity : float
        Relative humidity ∈ [0.0, 1.0]. Defaults to 0.40.
    wind_speed : float
        Wind speed at 1.5 m in m/s. Defaults to 1.0.

    Returns
    -------
    HeatStrainResult
        Contains wbgt_proxy, heat_index, mean_radiant_temp, delta_t.
    """
    S = max(0.0, min(1.0, shade_fraction))
    RH = max(0.0, min(1.0, humidity))
    T = t_ambient
    Ts = t_surface

    # ── 1. Mean Radiant Temperature ──────────────────────────────────
    K_rad = 0.85 * (1.0 - 0.15 * wind_speed)  # wind reduces radiation coupling
    K_rad = max(0.3, min(1.0, K_rad))
    delta_rad = (Ts - T) * (1.0 - S) * K_rad
    t_mrt = T + max(0.0, delta_rad)

    # ── 2. Globe temperature (T_g) from T_mrt and wind ──────────────
    # Simplified: T_g ≈ T_mrt − small convective loss
    t_globe = t_mrt - 0.5 * wind_speed * (1.0 - S)

    # ── 3. Wet-bulb estimate (T_wb) from T_air and RH ────────────────
    # Stull (2011) wet-bulb approximation
    t_wb = (T * math.atan(0.151977 * math.sqrt(RH * 100.0 + 8.313659))
            + math.atan(T + RH * 100.0)
            - math.atan(RH * 100.0 - 1.676331)
            + 0.00391838 * (RH * 100.0) ** 1.5
            * math.atan(0.023101 * (RH * 100.0))
            - 4.686035)

    # ── 4. Rothfusz Heat Index ───────────────────────────────────────
    T_F = T * 9.0 / 5.0 + 32.0  # convert to °F for HI formula
    RH_pct = RH * 100.0
    hi_f = (-42.379 + 2.04901523 * T_F + 10.14333127 * RH_pct
            - 0.22475541 * T_F * RH_pct
            - 0.00683783 * T_F ** 2
            - 0.05481717 * RH_pct ** 2
            + 0.00122874 * T_F ** 2 * RH_pct
            + 0.00085282 * T_F * RH_pct ** 2
            - 0.00000199 * T_F ** 2 * RH_pct ** 2)
    heat_index = (hi_f - 32.0) * 5.0 / 9.0  # back to °C

    # ── 5. WBGT Proxy ────────────────────────────────────────────────
    wbgt_proxy = 0.7 * t_wb + 0.2 * t_globe + 0.1 * T
    delta_t = max(0.0, wbgt_proxy - _TNOM)

    return HeatStrainResult(
        wbgt_proxy=round(wbgt_proxy, 2),
        heat_index=round(heat_index, 2),
        mean_radiant_temp=round(t_mrt, 2),
        delta_t=round(delta_t, 2),
    )


# ─── Edge Weight Assigner ────────────────────────────────────────────

def assign_edge_weights(
    graph: Union[nx.MultiDiGraph, nx.DiGraph],
    heat_data: dict[Any, dict[str, float]] | None = None,
    shade_data: dict[Any, float] | None = None,
    user_profile: Literal["coolest", "fastest", "balanced"] = "coolest",
    gamma: float = 0.20,
    beta: float = 0.08,
    t_ambient: float = 35.0,
    t_surface: float = 45.0,
    default_shade: float = 0.0,
) -> dict[tuple, EdgeWeightResult]:
    """
    Assign composite heat-aware weights to every edge in the graph.

    For each edge (u, v, k):

        WBGT_i = calculate_heat_strain_index(T_amb, T_surf, S_i).wbgt_proxy
        W_i    = Distance_i × (1 + γ · WBGT_i − β · S_i)

    The user_profile shifts coefficients:

        coolest : full γ, full β     (maximise shade avoidance)
        fastest : γ = 0, β = 0       (pure distance, classic Dijkstra)
        balanced: γ × 0.5, β × 0.5  (middle ground)

    Parameters
    ----------
    graph : nx.MultiDiGraph | nx.DiGraph
        Pedestrian graph with ``length`` attribute on each edge (metres).
    heat_data : dict, optional
        Mapping  edge_key → {"t_ambient": float, "t_surface": float}.
        If None, uses t_ambient / t_surface defaults.
    shade_data : dict, optional
        Mapping  edge_key → shade_fraction (float 0–1).
        If None, uses default_shade.
    user_profile : str
        One of "coolest", "fastest", "balanced".
    gamma : float
        Heat sensitivity coefficient (default 0.12).
    beta : float
        Shade benefit coefficient (default 0.08).
    t_ambient : float
        Fallback ambient temperature °C.
    t_surface : float
        Fallback surface temperature °C.
    default_shade : float
        Fallback shade fraction when shade_data is None for an edge.

    Returns
    -------
    dict[tuple, EdgeWeightResult]
        Keyed by (u, v, edge_key).  The graph edges are mutated in-place
        with a ``weight`` attribute as well.
    """
    # ── Profile-based coefficient scaling ─────────────────────────────
    profile_scale = {
        "coolest":  (1.0, 1.0),
        "fastest":  (0.0, 0.0),
        "balanced": (0.5, 0.5),
    }
    g_scale, b_scale = profile_scale.get(user_profile, (1.0, 1.0))
    g_eff = gamma * g_scale
    b_eff = beta * b_scale

    heat_data = heat_data or {}
    shade_data = shade_data or {}
    results: dict[tuple, EdgeWeightResult] = {}

    is_multi = isinstance(graph, (nx.MultiGraph, nx.MultiDiGraph))
    edge_iter = (
        graph.edges(data=True, keys=True) if is_multi
        else graph.edges(data=True)
    )

    for edge_tuple in edge_iter:
        if is_multi:
            u, v, edge_key, edge_data = edge_tuple
        else:
            u, v, edge_data = edge_tuple
            edge_key = 0  # sentinel key for DiGraph edges

        # ── Resolve per-edge inputs ───────────────────────────────────
        dist = edge_data.get("length") or edge_data.get("distance_m", 1.0)

        edge_id = (u, v, edge_key)
        h = heat_data.get(edge_id, heat_data.get((u, v), {}))
        t_a = h.get("t_ambient", t_ambient)
        t_s = h.get("t_surface", t_surface)
        S = shade_data.get(edge_id, shade_data.get((u, v), default_shade))
        S = max(0.0, min(1.0, S))

        # ── Compute WBGT proxy ────────────────────────────────────────
        strain = calculate_heat_strain_index(t_a, t_s, S)

        # ── Composite weight ──────────────────────────────────────────
        heat_penalty = g_eff * strain.delta_t
        shade_discount = b_eff * S
        weight = dist * (1.0 + heat_penalty - shade_discount)
        weight = max(0.01, weight)  # floor to avoid zero / negative

        # ── Mutate graph edge ─────────────────────────────────────────
        edge_ref = graph[u][v][edge_key] if is_multi else graph[u][v]
        edge_ref["weight"] = round(weight, 4)
        edge_ref["wbgt_proxy"] = strain.wbgt_proxy
        edge_ref["heat_penalty"] = round(heat_penalty, 4)
        edge_ref["shade_discount"] = round(shade_discount, 4)
        edge_ref["shade_fraction"] = round(S, 4)

        results[edge_id] = EdgeWeightResult(
            u=u,
            v=v,
            edge_key=edge_key,
            distance_m=round(dist, 2),
            wbgt_proxy=strain.wbgt_proxy,
            shade_fraction=round(S, 2),
            heat_penalty=round(heat_penalty, 4),
            shade_discount=round(shade_discount, 4),
            final_weight=round(weight, 4),
        )

    return results


# ─── Convenience: build weighted graph from GeoDataFrames ─────────────

def build_graph_from_geodataframes(
    nodes_gdf: gpd.GeoDataFrame,
    edges_gdf: gpd.GeoDataFrame,
    heat_data: dict | None = None,
    shade_data: dict | None = None,
    user_profile: Literal["coolest", "fastest", "balanced"] = "coolest",
) -> nx.MultiDiGraph:
    """
    Construct a weighted NetworkX MultiDiGraph from GeoDataFrames and
    immediately assign heat-aware edge weights.

    Parameters
    ----------
    nodes_gdf : gpd.GeoDataFrame
        Must contain columns: ``osmid``, ``geometry`` (Point).
    edges_gdf : gpd.GeoDataFrame
        Must contain columns: ``u``, ``v``, ``length``, ``geometry`` (LineString).
    heat_data, shade_data, user_profile :
        Forwarded to assign_edge_weights().

    Returns
    -------
    nx.MultiDiGraph
    """
    G = nx.MultiDiGraph()

    for _, row in nodes_gdf.iterrows():
        G.add_node(row["osmid"], x=row.geometry.x, y=row.geometry.y)

    for idx, row in edges_gdf.iterrows():
        G.add_edge(
            row["u"],
            row["v"],
            key=idx,
            length=row["length"],
            geometry=row.geometry,
        )

    assign_edge_weights(G, heat_data, shade_data, user_profile)
    return G
