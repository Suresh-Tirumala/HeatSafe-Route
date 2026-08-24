# HeatSafe Route — Architecture Overview

## Problem Statement

Standard pedestrian navigation engines minimise distance or time. In extreme-heat
environments, exposed asphalt corridors can raise core body temperature dangerously.
**HeatSafe Route** re-weights the pedestrian graph so the routing algorithm prefers
shaded, canopy-rich, cooler pathways — producing routes that trade modest extra
distance for significantly lower heat exposure.

---

## System Architecture in Three Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1 — INGESTION                                            │
│  Three async pipelines write to PostGIS on a configurable cycle  │
│  (cron / Airflow / Prefect DAG).                                │
│                                                                  │
│  • OSM PBF   → road_segments + nodes                            │
│  • FortyGuard → temp_readings                                   │
│  • Solar + canopy → shade_profiles + road_segments.canopy_*      │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2 — COST CALCULATION                                     │
│  A stored procedure (recompute_all_weights) or Python job:       │
│                                                                  │
│    weight = distance × (1 + α × heat_penalty)                   │
│    heat_penalty = max(0, (Tsurf−25) × (1−shade) × (1−canopy×.5))│
│                                                                  │
│  Results go to edge_weights, then a materialised view is         │
│  refreshed for the graph builder.                                │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3 — ROUTING API (FastAPI)                                │
│  • Builds an in-memory networkx DiGraph at startup / on cron     │
│  • POST /route receives origin, dest, profile ("coolest",        │
│    "fastest", "balanced"), optional time                         │
│  • Snaps coords → nearest pedestrian node                       │
│  • Runs A* with profile-specific edge weights                   │
│  • Returns GeoJSON route + heat_exposure_score + shade stats    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Heat Penalty Formula (tuning knobs)

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `BASE_TEMP_C` | 25 °C | Threshold below which no penalty applies |
| `α` (alpha) | 0.15 | Controls how much heat inflates edge weight |
| `canopy_weight` | 0.5 | Dampening factor for canopy cover's cooling effect |

**Example:** An edge 200 m long, surface 42 °C, 30 % shade, 60 % canopy:

```
penalty = (42−25) × (1−0.30) × (1−0.60×0.5) = 17 × 0.70 × 0.70 = 8.33
weight  = 200 × (1 + 0.15 × 8.33) = 200 × 2.25 = 450 m equivalent
```

A 200 m sunny asphalt segment costs the algorithm 450 m — the router will
prefer a 300 m shaded alternative (cost ≈ 300–330 m) over this segment.

---

## Routing Profiles

| Profile | Behaviour |
|---------|-----------|
| `coolest` | Weight = distance × (1 + α × heat_penalty) — maximises shade |
| `fastest` | Weight = raw distance — ignores heat (classic routing) |
| `balanced` | Weight = distance × (1 + (α/2) × heat_penalty) — middle ground |

---

## Data Freshness Strategy

| Data | Refresh Cadence | Method |
|------|----------------|--------|
| OSM graph | Weekly | `import_osm.py` diff-import |
| Temperature | Every 15 min | `temp_ingester.py` polling FortyGuard |
| Shade profiles | Daily (or per date change) | `refresh_shade.py` + solar calc |
| Edge weights | After temp or shade refresh | `recompute_all_weights()` procedure |
| Materialised view | After weight recomputation | `refresh_latest_weights()` procedure |
| In-memory graph | On API startup + every `GRAPH_REFRESH_INTERVAL_S` | `build_graph()` |

---

## Scaling Considerations

1. **City-scale** (~1 M edges): single PostGIS instance + in-memory networkx is fine.
2. **Metro-scale** (~10 M edges): move graph to RedisGraph or pgRouting, shard temp readings by city tile.
3. **Country-scale**: deploy per-region containers, edge weights pre-computed and cached in CDN-backed vector tiles.
4. **Real-time temp streaming**: replace polling with Kafka topic from FortyGuard webhooks; use Flink/Spark for windowed interpolation to edges.

---

## Files in This Repository

| File | Contents |
|------|----------|
| `architecture.md` | Full data-flow diagrams + sequence diagram |
| `schema.sql` | PostGIS DDL — tables, indexes, materialised views, stored procedures |
| `project_structure.md` | Python package layout + key module code sketches |
| `overview.md` | This file — executive summary |
