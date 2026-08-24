# HeatSafe Route — FortyGuard Hackathon Submission

**Track 1: Resilient Cities & Infrastructure**

---

## Problem: Urban Heat Kills — And Navigation Ignores It

Every summer, outdoor workers and pedestrians in sun-belt cities face a silent killer. The **urban heat island (UHI)** effect pushes asphalt surface temperatures 20–30 °C above air temperature. The WHO estimates that extreme heat causes **489,000 deaths per year globally**, with outdoor laborers — construction crews, delivery workers, street vendors — disproportionately affected.

Current navigation apps optimize for **distance or time**. They route pedestrians along sun-baked arterial roads when shaded residential streets exist 50 meters away. A 400-meter shortcut across exposed asphalt can raise core body temperature by 0.5–1.0 °C, pushing workers toward heat stroke. **No consumer routing engine today accounts for thermal exposure.**

The gap is clear: we have precise, real-time surface temperature data (via FortyGuard), we have shade and canopy data (via solar position models), and we have pedestrian street networks (via OpenStreetMap). What's missing is a **routing engine that fuses all three** to produce heat-aware pedestrian paths.

---

## The Solution: HeatSafe Route

**HeatSafe Route** is a dynamic smart-routing engine that re-weights a pedestrian street graph so the routing algorithm prefers shaded, cooler, canopy-rich pathways — trading modest extra distance for significantly lower heat exposure.

### How It Works

The system operates in three layers:

**Layer 1 — Ingestion**
Three async pipelines feed a PostGIS database:
- **OpenStreetMap** provides the pedestrian street network (sidewalks, footpaths, pedestrianized streets).
- **FortyGuard** provides real-time surface and ambient temperature readings at street-segment granularity.
- **Solar + Canopy** models compute shade fractions per edge based on solar altitude, tree canopy coverage, and building footprint shadows.

**Layer 2 — Cost Calculation**
Every edge in the graph receives a composite weight using a WBGT (Wet-Bulb Globe Temperature) proxy model:

```
W_i = Distance_i × (1 + γ · ΔWBGT_i − β · S_i)
```

Where:
- `ΔWBGT_i` = max(0, WBGT_proxy − 25 °C) — heat strain above a safe baseline
- `S_i` = shade fraction ∈ [0, 1]
- `γ = 0.20` — heat sensitivity coefficient
- `β = 0.08` — shade benefit coefficient

The WBGT proxy itself is a physiologically-grounded estimate combining wet-bulb temperature, globe temperature, and mean radiant temperature:

```
WBGT ≈ 0.7 × T_wet_bulb + 0.2 × T_globe + 0.1 × T_air
```

This captures the real thermal stress on a human body — not just air temperature, but radiant heat from hot surfaces, humidity's effect on evaporative cooling, and wind speed.

**Layer 3 — Routing API (FastAPI)**
A FastAPI service exposes `POST /route` accepting origin/destination coordinates and one of three profiles:

| Profile | γ | β | Behavior |
|---------|---|---|----------|
| `coolest` | 0.20 | 0.08 | Maximizes shade and thermal safety |
| `fastest` | 0 | 0 | Pure distance (classic Dijkstra) |
| `balanced` | 0.10 | 0.04 | Middle ground with distance budget ≤ 115% of shortest |

The API snaps coordinates to the nearest pedestrian node, runs profile-specific Dijkstra on the weighted in-memory NetworkX graph, and returns GeoJSON with route geometry, thermal exposure scores, shade statistics, and turn-by-turn navigation steps.

### Concrete Example

A 200-meter sunny asphalt segment (surface 42 °C, 30% shade, 60% canopy):

```
WBGT_proxy ≈ 38.2 °C
ΔWBGT = 38.2 − 25 = 13.2
W = 200 × (1 + 0.20 × 13.2 − 0.08 × 0.30)
W = 200 × (1 + 2.64 − 0.024)
W = 200 × 3.616 = 723 m equivalent
```

A 200-meter segment costs the algorithm as 723 meters. The router will happily take a **350-meter shaded detour** (cost ≈ 370 m) instead.

---

## FortyGuard API Integration

FortyGuard's thermal data is the **heartbeat** of HeatSafe Route. Here is precisely how it powers the dynamic edge-weighting system:

### Data Ingestion
FortyGuard's REST API provides street-segment-level surface temperature readings (`T_surface`) and ambient temperature (`T_ambient`). These are ingested every 15 minutes via a polling pipeline (`temp_ingester.py`) and stored in the PostGIS `temp_readings` table with spatial indexing for nearest-neighbor queries.

### Edge-Level Interpolation
For each graph edge, the system queries the nearest FortyGuard temperature reading within a configurable spatial and temporal window. If an edge has a midpoint at coordinates (lng, lat), the system finds the closest FortyGuard reading within 200m and 15 minutes, then assigns those temperature values to the edge.

### WBGT Proxy Computation
The FortyGuard temperatures feed directly into the WBGT proxy model:

1. **Mean Radiant Temperature** — estimated from `T_surface` and shade fraction: hotter surfaces radiate more heat. Full sun on 42 °C asphalt pushes mean radiant temperature 15–20 °C above air temperature.

2. **Wet-Bulb Temperature** — estimated from `T_air` and relative humidity (defaulting to 40% when unavailable), using Stull's 2011 approximation.

3. **Globe Temperature** — derived from mean radiant temperature, representing the combined radiant and convective heat load.

4. **WBGT Proxy** — the weighted combination: `0.7 × T_wb + 0.2 × T_globe + 0.1 × T_air`.

Without FortyGuard, the system would rely on static, generic temperature estimates. FortyGuard provides **dynamic, street-level thermal granularity** that makes the routing difference between a 35 °C shaded alley and a 52 °C sun-exposed road real and actionable.

### Dynamic Re-Weighting
As FortyGuard data refreshes (every 15 minutes), edge weights are recomputed via `recompute_all_weights()` stored procedure. A 200-meter sidewalk that was cost-neutral at 8 AM (surface 30 °C) becomes a high-penalty edge by noon (surface 48 °C). The routing engine adapts automatically — **the same origin-destination pair produces different optimal routes at different times of day**, exactly matching real thermal conditions.

### Scalability with FortyGuard
For metro-scale deployment, FortyGuard's data is sharded by city tile. Edge weights are pre-computed and cached in a materialized view, refreshed on the same cadence as temperature ingestion. For real-time streaming, a Kafka topic from FortyGuard webhooks feeds windowed interpolation to edges via Apache Flink.

---

## Urban Impact & Scalability

### Resilient City Planning
HeatSafe Route gives city planners a **thermal vulnerability map** of the pedestrian network. By running the routing engine across all origin-destination pairs in a district, planners can identify:
- **Heat exposure corridors** — streets where pedestrians consistently face high thermal stress
- **Shade deficit zones** — areas where tree planting or shade structures would have the highest routing impact
- **Infrastructure priorities** — which sidewalks to cool first for maximum pedestrian benefit

### Climate Adaptation
As global temperatures rise, the UHI effect intensifies. HeatSafe Route provides an **adaptive response** that doesn't require new infrastructure:
- **Short-term**: Reroute pedestrians to existing shaded paths
- **Medium-term**: Identify optimal locations for tree planting based on routing impact
- **Long-term**: Evaluate how new buildings and green infrastructure change thermal routing patterns

### Occupational Health
For outdoor workers — construction crews, delivery services, street vendors — HeatSafe Route can be integrated into workforce management tools:
- **Shift scheduling**: Route workers through coolest paths during peak heat hours
- **Exposure budgets**: Track cumulative heat exposure per worker per shift
- **Emergency response**: When a worker shows heat stress symptoms, fastest-coolest hybrid routing to shade or medical facilities

### Scalability Path

| Tier | Graph Size | Infrastructure |
|------|-----------|----------------|
| **City** (~1M edges) | Single PostGIS + in-memory NetworkX | Runs on a $20/mo VPS |
| **Metro** (~10M edges) | RedisGraph or pgRouting, sharded temp data | 3–4 container instances |
| **Country** | Per-region containers, CDN-cached edge weights | Kubernetes + vector tiles |
| **Real-time** | Kafka + Flink windowed interpolation from FortyGuard webhooks | Event-driven architecture |

### What We Built

- **51 Python unit tests** — covering WBGT proxy accuracy, edge weight correctness, Dijkstra routing across all three profiles, path analytics, navigation step generation, and GeoJSON serialization
- **27 frontend tests** — covering React components (route panel, map visualization, toggle controls), TypeScript utilities, and Mapbox GL JS integration
- **PostGIS schema** — full DDL with spatial indexes, materialized views, and stored procedures for weight recomputation
- **FastAPI routing engine** — three-profile pathfinding with GeoJSON output, thermal exposure scoring, and turn-by-turn navigation
- **React + Mapbox GL JS frontend** — dark-themed map with heatmap overlay, color-coded route lines, interactive popups, side-by-side route comparison panel

---

## Conclusion

Urban heat is a climate crisis happening now, on the streets where people walk and work. FortyGuard provides the thermal intelligence. HeatSafe Route converts that intelligence into **safer pedestrian paths**. Together, they demonstrate that resilient city infrastructure isn't just about building new things — it's about **smarter use of the streets we already have**.
