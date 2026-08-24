# HeatSafe Route — Backend System Architecture

## 1. High-Level Data-Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                              │
│                                                                             │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────────┐  │
│  │  OSM PBF     │   │  FortyGuard      │   │  Solar Position +          │  │
│  │  Extract     │   │  Temperature API │   │  Tree Canopy / Building    │  │
│  │  (planet/    │   │  (REST / JSON)   │   │  Footprints (GeoTIFF /     │  │
│  │   region)    │   │                  │   │  vector tiles)             │  │
│  └──────┬───────┘   └────────┬─────────┘   └────────────┬───────────────┘  │
│         │                    │                          │                   │
└─────────┼────────────────────┼──────────────────────────┼───────────────────┘
          │                    │                          │
          ▼                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INGESTION LAYER                                     │
│                                                                             │
│  ┌─────────────────┐ ┌───────────────────┐ ┌────────────────────────────┐  │
│  │ osm_ingester    │ │ temp_ingester     │ │ solar_canopy_ingester      │  │
│  │                 │ │                   │ │                            │  │
│  │ • parse PBF     │ │ • poll / webhooks │ │ • DEMI solar position API  │  │
│  │ • filter pedestrian│ │ • interpolate   │ │ • rioxarray read canopy    │  │
│  │   ways/paths    │ │   to edge midpoints│ │ • OSM buildings height    │  │
│  │ • compute edge  │ │ • store in        │ │ • compute shade polygons   │  │
│  │   geometry len  │ │   temp_readings   │ │   per edge segment         │  │
│  └────────┬────────┘ └────────┬──────────┘ └────────────┬───────────────┘  │
│           │                   │                         │                   │
└───────────┼───────────────────┼─────────────────────────┼───────────────────┘
            │                   │                         │
            ▼                   ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PostgreSQL / PostGIS                                   │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │ road_segments│ │ edge_weights │ │ temp_readings │ │ shade_profiles   │  │
│  │              │ │ (materialized│ │               │ │                  │  │
│  │ (geom, meta) │ │  view / tile)│ │ (ts, temp_c)  │ │ (edge_id, solar  │  │
│  └──────────────┘ └──────┬───────┘ └───────┬───────┘ │  alt, shade_pct) │  │
│                          │                 │         └──────────────────┘  │
│                          │                 │                               │
└──────────────────────────┼─────────────────┼───────────────────────────────┘
                           │                 │
                           ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     COST CALCULATION ENGINE                                  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  heat_cost_calculator                                                │   │
│  │                                                                      │   │
│  │  inputs (per edge):                                                  │   │
│  │    • distance_m          (from road_segments.geom)                   │   │
│  │    • surface_temp_c      (from temp_readings, nearest in time/space) │   │
│  │    • ambient_temp_c      (from temp_readings)                        │   │
│  │    • shade_fraction      (from shade_profiles, for current hour)     │   │
│  │    • canopy_cover_pct    (from road_segments.canopy_metadata)        │   │
│  │                                                                      │   │
│  │  formula:                                                            │   │
│  │    heat_penalty = f(surface_temp, shade_fraction, canopy_cover)      │   │
│  │    edge_weight  = distance_m × (1 + α × heat_penalty)               │   │
│  │                                                                      │   │
│  │  output: weighted edge cost written back to edge_weights             │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GRAPH BUILDER                                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  graph_builder                                                       │   │
│  │                                                                      │   │
│  │  • loads weighted DiGraph from edge_weights + road_segments          │   │
│  │  • caches in-memory (networkx) or exports to route-graph.graphml    │   │
│  │  • refresh trigger: cron / webhook after ingestion completes         │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FastAPI ROUTING LAYER                                    │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ POST /route      │  │ GET  /health     │  │ GET  /edge/{id}/details  │  │
│  │                  │  │                  │  │                          │  │
│  │ body:            │  │ Returns API +    │  │ Returns edge geometry,   │  │
│  │  origin: [lng,lat]│ │ graph freshness  │  │ heat cost breakdown      │  │
│  │  dest: [lng,lat] │  │                  │  │                          │  │
│  │  profile:        │  └──────────────────┘  └──────────────────────────┘  │
│  │    "coolest" |   │                                                      │
│  │    "fastest" |   │                                                      │
│  │    "balanced"│   │                                                      │
│  │  time: ISO8601  │                                                      │
│  │                  │                                                      │
│  │ response:        │                                                      │
│  │  route coords,   │                                                      │
│  │  distance,       │                                                      │
│  │  est_heat_exposure│                                                     │
│  │  shade_pct along │                                                      │
│  └──────────────────┘                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Request Lifecycle (Sequence)

```
Client                  FastAPI              GraphBuilder        PostGIS
  │                       │                      │                  │
  │  POST /route          │                      │                  │
  │──────────────────────>│                      │                  │
  │                       │  snapshot edge_costs │                  │
  │                       │─────────────────────────────────────────│
  │                       │<──── edge rows ──────│──────────────────│
  │                       │                      │                  │
  │                       │  query nearest node  │                  │
  │                       │  for origin/dest     │                  │
  │                       │─────────────────────────────────────────│
  │                       │<──── node_id ────────│──────────────────│
  │                       │                      │                  │
  │                       │  dijkstra(astar)     │                  │
  │                       │  on in-memory graph  │                  │
  │                       │──────┐               │                  │
  │                       │      │ solve         │                  │
  │                       │<─────┘               │                  │
  │                       │                      │                  │
  │  JSON route response  │                      │                  │
  │<──────────────────────│                      │                  │
```
