# HeatSafe Route 🌡️🏃

**A heat-aware pedestrian navigation system**

## Problem

Standard navigation apps optimize for distance or time. They route pedestrians along sun-baked asphalt when shaded residential streets exist 50 meters away. The urban heat island effect pushes surface temperatures 20–30°C above air temperature. No consumer routing engine today accounts for thermal exposure.

HeatSafe Route re-weights the pedestrian street graph so the routing algorithm prefers shaded, cooler, canopy-rich pathways — trading modest extra distance for significantly lower heat exposure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1 — INGESTION                                    │
│  • OpenStreetMap → pedestrian street network             │
│  • FortyGuard API → real-time surface temperatures       │
│  • Solar + Canopy models → shade fraction per edge       │
├─────────────────────────────────────────────────────────┤
│  LAYER 2 — COST CALCULATION                             │
│  weight = distance × (1 + α × heat_penalty)             │
│  hot asphalt = expensive, shaded paths = cheap           │
├─────────────────────────────────────────────────────────┤
│  LAYER 3 — ROUTING                                      │
│  Three profiles: shortest / coolest / balanced           │
│  Returns GeoJSON + thermal exposure + navigation steps  │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Core | Python, GeoPandas, NetworkX, Shapely |
| Frontend | React, TypeScript, MapLibre GL JS |
| Database | PostgreSQL + PostGIS |
| Temperature Data | FortyGuard API |
| Street Network | OpenStreetMap |

---

## Project Structure

```
app/
├── core/
│   ├── cost.py              — Heat strain index, edge weight calculator
│   ├── router.py            — 3-profile pathfinding, GeoJSON output
│   ├── fortyguard.py        — FortyGuard API client with retry/fallback
│   ├── test_cost.py         — 21 tests
│   ├── test_router.py       — 50 tests
│   └── test_fortyguard.py   — 26 tests

frontend/
├── src/
│   ├── App.tsx              — Main app with route visualization
│   ├── components/
│   │   ├── HeatSafeMap.tsx   — MapLibre map + heatmap overlay
│   │   ├── RoutePanel.tsx    — Route comparison cards + directions
│   │   └── RouteToggle.tsx   — Profile selector
│   ├── types/route.ts       — TypeScript types
│   └── utils/map.ts         — Utilities + mock data

schema.sql                   — PostGIS database schema
```

---

## How It Works

### The Formula

```
weight = distance × (1 + 0.15 × heat_penalty)

where:
  heat_penalty = max(0, (T_surface - 25) × (1 - shade) × (1 - canopy × 0.5))
```

### Example

A 200m sunny asphalt segment (surface 42°C, 30% shade, 60% canopy):

```
heat_penalty = (42 - 25) × (1 - 0.30) × (1 - 0.60 × 0.5)
             = 17 × 0.70 × 0.70
             = 8.33

weight = 200 × (1 + 0.15 × 8.33) = 200 × 2.25 = 450m equivalent
```

The router avoids this segment and takes a 300m shaded detour (cost ≈ 300m) instead.

### Routing Profiles

| Profile | γ | β | Behavior |
|---------|---|---|----------|
| **Shortest** | 0 | 0 | Pure distance — classic routing |
| **Coolest** | 0.20 | 0.08 | Maximizes shade and thermal safety |
| **Balanced** | 0.10 | 0.04 | Distance ≤ 115% of shortest, minimizes heat |

---

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd heatsafe-route

# Backend setup
python -m venv .venv
.venv\Scripts\activate
pip install networkx shapely geopandas numpy pyproj

# Frontend setup
cd frontend
npm install
```

### Running

```bash
# Start frontend (development)
cd frontend
npm run dev

# Frontend available at http://localhost:5173
```

---

## Testing

### Python (97 tests)

```bash
python -m pytest app/ -v
```

### Frontend (38 tests)

```bash
cd frontend
npm test
```

### Build Frontend

```bash
cd frontend
npm run build
```

---

## Build Status

| Component | Status |
|-----------|--------|
| WBGT proxy calculator | ✅ Built |
| Edge weight assigner (3 profiles) | ✅ Built |
| 3-profile pathfinding engine | ✅ Built |
| GeoJSON serialization + navigation steps | ✅ Built |
| FortyGuard API client with retry/fallback | ✅ Built |
| React + MapLibre frontend | ✅ Built |
| Heat visualization | ✅ Built |
| Route comparison panel | ✅ Built |
| 135 unit tests | ✅ All passing |
| PostGIS database schema | ✅ Designed |
| FastAPI server | 🚧 Planned |
| Database integration | 🚧 Planned |
| Ingestion pipelines | 🚧 Planned |
| Real-time FortyGuard data | 🚧 Planned |

---

## Urban Impact

- **Occupational Health** — Route outdoor workers through coolest paths during peak heat
- **City Planning** — Identify heat exposure corridors and shade deficit zones
- **Climate Adaptation** — Dynamic rerouting as temperatures change throughout the day
- **Emergency Response** — Fastest-coolest hybrid routing for heat stress emergencies

---

## License

MIT
