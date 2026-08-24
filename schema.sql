-- =============================================================
-- HeatSafe Route — PostGIS Database Schema
-- =============================================================

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- for fuzzy node matching

-- =============================================================
-- 1. SPATIAL REFERENCE SYSTEMS
-- =============================================================
-- We store everything in WGS 84 (EPSG:4326) for API compat
-- and use geometry casts for distance calculations in metres
-- via ST_Transform where needed.

-- =============================================================
-- 2. ROAD SEGMENTS  (OSM-derived pedestrian pathways)
-- =============================================================
CREATE TABLE road_segments (
    segment_id      BIGSERIAL PRIMARY KEY,
    osm_way_id      BIGINT,
    osm_node_src    BIGINT NOT NULL,
    osm_node_dst    BIGINT NOT NULL,
    geom            GEOMETRY(LINESTRING, 4326) NOT NULL,
    length_m        DOUBLE PRECISION GENERATED ALWAYS AS (
                        ST_Length(geom::geography)
                    ) STORED,
    surface_type    TEXT,          -- asphalt, concrete, dirt, grass …
    segment_name    TEXT,
    -- canopy / building metadata (enriched by solar_canopy_ingester)
    canopy_cover_pct    DOUBLE PRECISION DEFAULT 0.0,  -- 0.0–1.0
    avg_tree_height_m   DOUBLE PRECISION,
    building_proximity_m DOUBLE PRECISION,  -- nearest building face
    last_refreshed  TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uq_osm_edge UNIQUE (osm_way_id, osm_node_src, osm_node_dst)
);

CREATE INDEX idx_rs_geom    ON road_segments USING GIST (geom);
CREATE INDEX idx_rs_src     ON road_segments (osm_node_src);
CREATE INDEX idx_rs_dst     ON road_segments (osm_node_dst);

-- =============================================================
-- 3. INTERSECTION NODES  (graph vertices)
-- =============================================================
CREATE TABLE nodes (
    node_id         BIGSERIAL PRIMARY KEY,
    osm_node_id     BIGINT UNIQUE NOT NULL,
    geom            GEOMETRY(POINT, 4326) NOT NULL,
    lat             DOUBLE PRECISION GENERATED ALWAYS AS (
                        ST_Y(geom)
                    ) STORED,
    lng             DOUBLE PRECISION GENERATED ALWAYS AS (
                        ST_X(geom)
                    ) STORED
);

CREATE INDEX idx_nodes_geom ON nodes USING GIST (geom);

-- =============================================================
-- 4. TEMPERATURE READINGS  ( FortyGuard data)
-- =============================================================
CREATE TABLE temp_readings (
    reading_id      BIGSERIAL PRIMARY KEY,
    segment_id      BIGINT REFERENCES road_segments(segment_id),
    recorded_at     TIMESTAMPTZ NOT NULL,
    surface_temp_c  DOUBLE PRECISION,
    ambient_temp_c  DOUBLE PRECISION,
    humidity_pct    DOUBLE PRECISION,
    -- spatial query support
    geom            GEOMETRY(POINT, 4326)
);

CREATE INDEX idx_tr_seg_time ON temp_readings (segment_id, recorded_at DESC);
CREATE INDEX idx_tr_geom     ON temp_readings USING GIST (geom);
CREATE INDEX idx_tr_ts       ON temp_readings (recorded_at DESC);

-- Partition by month for high-volume ingestion
-- (uncomment in production)
-- CREATE TABLE temp_readings_y2026m08 PARTITION OF temp_readings
--     FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- =============================================================
-- 5. SHADE PROFILES  (pre-computed per edge per hour-of-day)
-- =============================================================
CREATE TABLE shade_profiles (
    profile_id      BIGSERIAL PRIMARY KEY,
    segment_id      BIGINT NOT NULL REFERENCES road_segments(segment_id),
    calc_date       DATE NOT NULL,        -- date of solar calc
    hour_utc        SMALLINT NOT NULL CHECK (hour_utc BETWEEN 0 AND 23),
    solar_altitude  DOUBLE PRECISION,      -- degrees above horizon
    solar_azimuth   DOUBLE PRECISION,      -- degrees from north
    shade_fraction  DOUBLE PRECISION NOT NULL,  -- 0.0 (full sun) – 1.0 (full shade)
    shade_source    TEXT,                  -- 'tree_canopy', 'building', 'combined'
    last_refreshed  TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uq_shade UNIQUE (segment_id, calc_date, hour_utc)
);

CREATE INDEX idx_sp_seg_hour ON shade_profiles (segment_id, calc_date, hour_utc);

-- =============================================================
-- 6. EDGE WEIGHTS  (composite cost, updated by cost calculator)
-- =============================================================
CREATE TABLE edge_weights (
    edge_weight_id  BIGSERIAL PRIMARY KEY,
    segment_id      BIGINT NOT NULL REFERENCES road_segments(segment_id),
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- raw components
    distance_m      DOUBLE PRECISION NOT NULL,
    surface_temp_c  DOUBLE PRECISION,
    ambient_temp_c  DOUBLE PRECISION,
    shade_fraction  DOUBLE PRECISION DEFAULT 0.0,
    canopy_cover    DOUBLE PRECISION DEFAULT 0.0,
    -- final weighted cost
    heat_penalty    DOUBLE PRECISION DEFAULT 0.0,
    weight          DOUBLE PRECISION NOT NULL,   -- distance_m × (1 + α × heat_penalty)
    -- routing profile this weight belongs to
    profile         TEXT NOT NULL DEFAULT 'coolest'
                    CHECK (profile IN ('coolest', 'fastest', 'balanced')),

    CONSTRAINT uq_edge_weight UNIQUE (segment_id, computed_at, profile)
);

CREATE INDEX idx_ew_seg     ON edge_weights (segment_id);
CREATE INDEX idx_ew_computed ON edge_weights (computed_at DESC);

-- =============================================================
-- 7. MATERIALIZED VIEW — latest edge weights for graph builder
-- =============================================================
CREATE MATERIALIZED VIEW latest_edge_weights AS
SELECT DISTINCT ON (ew.segment_id)
    ew.segment_id,
    rs.osm_node_src,
    rs.osm_node_dst,
    rs.length_m,
    rs.surface_type,
    rs.canopy_cover_pct,
    ew.weight,
    ew.heat_penalty,
    ew.surface_temp_c,
    ew.shade_fraction,
    ew.profile,
    ew.computed_at
FROM edge_weights ew
JOIN road_segments rs ON rs.segment_id = ew.segment_id
WHERE ew.profile = 'coolest'
ORDER BY ew.segment_id, ew.computed_at DESC;

CREATE UNIQUE INDEX idx_lew_seg ON latest_edge_weights (segment_id);

-- =============================================================
-- 8. HELPER FUNCTIONS
-- =============================================================

-- Find the nearest node to a given point (used for snapping origin/dest)
CREATE OR REPLACE FUNCTION find_nearest_node(
    p_geom GEOMETRY(POINT, 4326),
    max_dist_m DOUBLE PRECISION DEFAULT 200.0
)
RETURNS TABLE(node_id BIGINT, osm_node_id BIGINT, dist_m DOUBLE PRECISION)
LANGUAGE SQL STABLE AS $$
    SELECT n.node_id, n.osm_node_id,
           ST_Distance(n.geom::geography, p_geom::geography) AS dist_m
    FROM nodes n
    WHERE ST_DWithin(n.geom::geography, p_geom::geography, max_dist_m)
    ORDER BY n.geom <-> p_geom
    LIMIT 1;
$$;

-- Refresh the materialised view (call after ingestion cycle)
CREATE OR REPLACE PROCEDURE refresh_latest_weights()
LANGUAGE PLpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY latest_edge_weights;
END;
$$;

-- =============================================================
-- 9. SEED / REFRESH HELPER: populate edge_weights from latest
--    temperature + shade data (called by cost_calculation_engine)
-- =============================================================
CREATE OR REPLACE PROCEDURE recompute_all_weights(
    p_profile TEXT DEFAULT 'coolest',
    p_alpha   DOUBLE PRECISION DEFAULT 0.15
)
LANGUAGE PLpgsql AS $$
BEGIN
    INSERT INTO edge_weights (
        segment_id, computed_at,
        distance_m, surface_temp_c, ambient_temp_c,
        shade_fraction, canopy_cover,
        heat_penalty, weight, profile
    )
    SELECT
        rs.segment_id,
        now(),
        rs.length_m,
        COALESCE(tr.surface_temp_c, 30.0),           -- fallback ambient
        COALESCE(tr.ambient_temp_c, 30.0),
        COALESCE(sp.shade_fraction, 0.0),
        rs.canopy_cover_pct,
        -- heat_penalty: higher temp + less shade = bigger penalty
        GREATEST(
            0,
            (COALESCE(tr.surface_temp_c, 30.0) - 25.0)
            * (1.0 - COALESCE(sp.shade_fraction, 0.0))
            * (1.0 - rs.canopy_cover_pct * 0.5)
        ),
        -- final weight
        rs.length_m * (1.0 + p_alpha * GREATEST(
            0,
            (COALESCE(tr.surface_temp_c, 30.0) - 25.0)
            * (1.0 - COALESCE(sp.shade_fraction, 0.0))
            * (1.0 - rs.canopy_cover_pct * 0.5)
        )),
        p_profile
    FROM road_segments rs
    LEFT JOIN LATERAL (
        SELECT surface_temp_c, ambient_temp_c
        FROM temp_readings
        WHERE segment_id = rs.segment_id
        ORDER BY recorded_at DESC
        LIMIT 1
    ) tr ON true
    LEFT JOIN LATERAL (
        SELECT shade_fraction
        FROM shade_profiles
        WHERE segment_id = rs.segment_id
          AND hour_utc = EXTRACT(HOUR FROM now())::int
        ORDER BY calc_date DESC
        LIMIT 1
    ) sp ON true;

    CALL refresh_latest_weights();
END;
$$;
