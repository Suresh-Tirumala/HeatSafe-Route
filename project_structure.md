# HeatSafe Route — Python FastAPI Project Structure

## Directory Layout

```
heatsafe-route/
├── pyproject.toml                 # project metadata, deps (pip / poetry)
├── Dockerfile
├── docker-compose.yml             # api + postgres + redis
├── alembic.ini
├── alembic/
│   └── versions/                  # DB migration scripts
│
├── app/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app factory, lifespan, CORS
│   ├── config.py                  # pydantic-settings (env / .env)
│   ├── dependencies.py            # FastAPI Depends() helpers
│   │
│   ├── api/                       # HTTP layer
│   │   ├── __init__.py
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── routing.py         # POST /route
│   │   │   ├── health.py          # GET  /health
│   │   │   └── edges.py           # GET  /edge/{id}/details
│   │   └── schemas/
│   │       ├── __init__.py
│   │       ├── route_request.py   # Pydantic models for request
│   │       └── route_response.py  # Pydantic models for response
│   │
│   ├── core/                      # domain logic
│   │   ├── __init__.py
│   │   ├── graph.py               # in-memory DiGraph, build / refresh
│   │   ├── cost.py                # heat_cost_calculator (weight formula)
│   │   └── router_engine.py       # dijkstra / astar wrapper
│   │
│   ├── ingestion/                 # ETL for external data
│   │   ├── __init__.py
│   │   ├── osm_ingester.py        # parse PBF → road_segments + nodes
│   │   ├── temp_ingester.py       # FortyGuard API → temp_readings
│   │   └── solar_canopy_ingester.py  # solar + canopy → shade_profiles
│   │
│   ├── db/                        # database access
│   │   ├── __init__.py
│   │   ├── engine.py              # async SQLAlchemy engine
│   │   ├── session.py             # session / dependency injection
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── road_segment.py
│   │       ├── node.py
│   │       ├── temp_reading.py
│   │       ├── shade_profile.py
│   │       └── edge_weight.py
│   │
│   └── utils/
│       ├── __init__.py
│       ├── geo.py                 # haversine, snap-to-node, coordinate helpers
│       └── solar.py               # solar position math (astral wrapper)
│
├── scripts/
│   ├── import_osm.py              # CLI: run OSM ingestion
│   ├── refresh_weights.py         # CLI: recompute edge weights
│   └── refresh_shade.py           # CLI: recompute shade profiles
│
└── tests/
    ├── __init__.py
    ├── test_cost.py
    ├── test_graph.py
    ├── test_routing_api.py
    └── test_ingestion.py
```

## Key Module Responsibilities

### `app/main.py`
```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config import settings
from app.api.routes import routing, health, edges

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: build in-memory graph from DB
    from app.core.graph import build_graph
    app.state.graph = await build_graph()
    yield
    # shutdown: cleanup

app = FastAPI(
    title="HeatSafe Route",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(routing.router, prefix="/api/v1")
app.include_router(health.router,  prefix="/api/v1")
app.include_router(edges.router,   prefix="/api/v1")
```

### `app/config.py`
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://heatsafe:secret@localhost:5432/heatsafe"
    fortyguard_api_key: str = ""
    fortyguard_base_url: str = "https://api.fortyguard.com/v1"
    solar_api_url: str = "https://api.elevationapi.com/v1"
    graph_refresh_interval_s: int = 600
    heat_alpha: float = 0.15  # weight tuning knob

    class Config:
        env_file = ".env"
```

### `app/core/cost.py` — Heat Cost Calculator
```python
"""
edge_weight = distance_m × (1 + α × heat_penalty)

heat_penalty = max(0, (surface_temp_c - BASE_TEMP) × (1 - shade_fraction) × (1 - canopy_cover × 0.5))
"""
from dataclasses import dataclass

BASE_TEMP_C = 25.0

@dataclass
class EdgeCostInput:
    distance_m: float
    surface_temp_c: float
    ambient_temp_c: float
    shade_fraction: float      # 0.0 – 1.0
    canopy_cover: float        # 0.0 – 1.0

def compute_heat_penalty(surface_temp_c: float, shade_fraction: float, canopy_cover: float) -> float:
    raw = (surface_temp_c - BASE_TEMP_C) * (1.0 - shade_fraction) * (1.0 - canopy_cover * 0.5)
    return max(0.0, raw)

def compute_weight(inp: EdgeCostInput, alpha: float = 0.15) -> float:
    penalty = compute_heat_penalty(inp.surface_temp_c, inp.shade_fraction, inp.canopy_cover)
    return inp.distance_m * (1.0 + alpha * penalty)
```

### `app/core/graph.py` — Graph Builder
```python
import networkx as nx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

async def build_graph(session: AsyncSession) -> nx.DiGraph:
    """Load latest_edge_weights materialized view into a networkx graph."""
    G = nx.DiGraph()
    result = await session.execute(
        text("SELECT segment_id, osm_node_src, osm_node_dst, weight, length_m FROM latest_edge_weights")
    )
    for row in result:
        G.add_edge(
            row.osm_node_src,
            row.osm_node_dst,
            weight=row.weight,
            segment_id=row.segment_id,
            length_m=row.length_m,
        )
    return G
```

### `app/core/router_engine.py` — Routing Algorithm
```python
import networkx as nx

def find_route(G: nx.DiGraph, origin_node: int, dest_node: int, strategy: str = "coolest"):
    """
    strategy:
      - 'coolest':  minimise heat-weighted cost (default)
      - 'fastest':  minimise raw distance only
      - 'balanced': interpolate between the two
    """
    if strategy == "fastest":
        weight_attr = "length_m"
    else:
        weight_attr = "weight"

    path = nx.astar_path(G, origin_node, dest_node, weight=weight_attr)
    total_weight = nx.astar_path_length(G, origin_node, dest_node, weight=weight_attr)
    return path, total_weight
```

### `app/api/routes/routing.py` — Main Endpoint
```python
from fastapi import APIRouter, Depends, HTTPException
from app.api.schemas.route_request import RouteRequest
from app.api.schemas.route_response import RouteResponse
from app.db.session import get_db
from app.core.router_engine import find_route
from app.utils.geo import find_nearest_node

router = APIRouter()

@router.post("/route", response_model=RouteResponse)
async def get_route(req: RouteRequest, db=Depends(get_db)):
    # 1. snap origin/dest to nearest graph node
    origin_node = await find_nearest_node(db, req.origin)
    dest_node   = await find_nearest_node(db, req.destination)
    if not origin_node or not dest_node:
        raise HTTPException(400, "No pedestrian node within 200 m of input point")

    # 2. run routing
    from app.main import app
    G = app.state.graph
    path, cost = find_route(G, origin_node, dest_node, req.profile)

    # 3. assemble response (geometry, heat exposure, shade stats)
    return RouteResponse(
        coordinates=...,       # stitch LineString from path edges
        distance_m=...,
        heat_exposure_score=cost,
        avg_shade_pct=...,
    )
```

### `app/ingestion/osm_ingester.py` — OSM Pipeline
```python
"""
Pipeline:
  1. Download .osm.pbf region file
  2. Stream-parse with osmium / pyosmium
  3. Filter ways tagged  highway IN (footway, path, pedestrian, sidewalk, steps)
  4. Insert nodes → nodes table, edges → road_segments table
"""
import osmium

class PedestrianWayHandler(osmium.SimpleHandler):
    def way(self, w):
        if "highway" not in w.tags:
            return
        if w.tags["highway"] not in ("footway", "path", "pedestrian", "sidewalk", "steps"):
            return
        # build LINESTRING from node refs, insert into road_segments
        ...

def ingest_osm_pbf(filepath: str, session):
    handler = PedestrianWayHandler()
    handler.apply_file(filepath, locations=True)
```

### `app/ingestion/temp_ingester.py` — FortyGuard Pipeline
```python
"""
Pipeline:
  1. Call FortyGuard REST API for bbox of active road_segments
  2. Interpolate returned grid to edge midpoints
  3. Insert into temp_readings
"""
import httpx

async def fetch_temperatures(bbox: tuple, api_key: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.fortyguard_base_url}/temperature",
            params={"bbox": ",".join(map(str, bbox)), "format": "json"},
            headers={"Authorization": f"Bearer {api_key}"},
        )
        return resp.json()["readings"]
```

### `app/ingestion/solar_canopy_ingester.py` — Shade Pipeline
```python
"""
Pipeline:
  1. For each road_segment, compute solar position (astral library)
  2. Intersect sun vector with tree canopy raster + building footprint polygons
  3. Compute shade_fraction per hour of day
  4. Upsert into shade_profiles
  5. Update road_segments.canopy_cover_pct
"""
from astral import sun, LocationInfo
import rioxarray, xarray

def compute_shade_for_segment(segment_geom, canopy_raster, buildings_gdf, date):
    loc = LocationInfo()
    shade_by_hour = {}
    for hour in range(24):
        solar_alt = sun.elevation(loc.observer, date, hour)
        solar_az  = sun.azimuth(loc.observer, date, hour)
        # ray-cast from segment midpoint upward at (alt, az)
        # intersect with canopy + buildings → shade_fraction
        shade_by_hour[hour] = shade_fraction
    return shade_by_hour
```

## Docker Compose (dev)

```yaml
version: "3.9"
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: heatsafe
      POSTGRES_USER: heatsafe
      POSTGRES_PASSWORD: secret
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env
    depends_on: [db]
    volumes: [./app:/code/app]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

## Key Dependencies (`pyproject.toml`)

```toml
[project]
name = "heatsafe-route"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "geoalchemy2>=0.15",
    "pydantic-settings>=2.0",
    "networkx>=3.3",
    "osmium>=4.0",
    "httpx>=0.27",
    "astral>=3.2",
    "rioxarray>=0.16",
    "shapely>=2.0",
    "pyproj>=3.6",
]
```
