import type {
  RouteCollection,
  RouteFeature,
  RouteProfile,
  RouteProperties,
  TempReading,
} from "../types/route";

/** Format metres with unit suffix. */
export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

/** Format seconds into human-readable duration. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/** Extract a single route feature from the collection. */
export function getRoute(
  data: RouteCollection,
  profile: RouteProfile
): RouteFeature | undefined {
  return data.features.find((f) => f.properties.route_type === profile);
}

/** Compute % difference between two values. */
export function pctDiff(a: number, b: number): number {
  if (a === 0) return 0;
  return ((b - a) / a) * 100;
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Generate mock temperature readings for heatmap demo. */
export function generateMockHeatData(
  center: [number, number],
  count: number = 120,
  baseTemp: number = 32
): TempReading[] {
  const readings: TempReading[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const radius = 0.003 + Math.random() * 0.008;
    readings.push({
      lng: center[0] + Math.cos(angle) * radius * (1 + Math.random()),
      lat: center[1] + Math.sin(angle) * radius * (1 + Math.random()),
      temp_c: baseTemp + (Math.random() - 0.3) * 12,
    });
  }
  return readings;
}

/** Build a GeoJSON PointFeatureCollection for the heatmap layer. */
export function heatDataToGeoJSON(readings: TempReading[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: readings.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: { temp_c: r.temp_c },
    })),
  };
}

/** Build GeoJSON for origin / destination markers. */
export function buildMarkersGeoJSON(
  origin: [number, number],
  destination: [number, number]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: origin },
        properties: { marker_type: "origin" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: destination },
        properties: { marker_type: "destination" },
      },
    ],
  };
}

// ─── Client-side route synthesis (search-selected places) ─────────────

const WALKING_SPEED_MPS = 1.4;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing in degrees from a to b (0 = north, clockwise). */
function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Stable small hash of a coordinate pair → deterministic pseudo-randomness. */
export function coordHash(p: [number, number], salt: number): number {
  const k = `${p[0].toFixed(5)},${p[1].toFixed(5)},${salt}`;
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000; // 0..1
}

/**
 * Estimate demo heat/shade metrics for a real routed polyline until the
 * FortyGuard integration supplies per-segment temperatures.
 */
export function estimateHeatMetrics(
  coordinates: [number, number][],
  profile: RouteProfile
): Pick<
  RouteProperties,
  "avg_shade_pct" | "heat_exposure_score" | "heat_exposure_duration_s" | "wbgt_proxy" | "heat_penalty" | "shade_discount"
> {
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const base =
    profile === "coolest" ? 62 : profile === "balanced" ? 38 : 12;
  const jitter =
    (coordHash(start, 11) - coordHash(end, 23)) * 12;

  const distance = polylineLengthM(coordinates);
  const duration = distance / WALKING_SPEED_MPS;
  const avgShade = Math.max(2, Math.min(92, base + jitter));
  const shadeFrac = avgShade / 100;

  return {
    avg_shade_pct: Math.round(avgShade * 10) / 10,
    heat_exposure_score: Math.round(distance * (1 - shadeFrac) * 1.2 * 10) / 10,
    heat_exposure_duration_s: Math.round(duration * (1 - shadeFrac)),
    wbgt_proxy: Math.round((38 - avgShade * 0.12) * 10) / 10,
    heat_penalty: Math.round((1 - shadeFrac) * 2.6 * 100) / 100,
    shade_discount: Math.round(avgShade * 0.0008 * 10000) / 10000,
  };
}

function polylineLengthM(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i - 1], coords[i]);
  }
  return total;
}

interface SynthRouteInput {
  profile: RouteProfile;
  origin: [number, number];
  destination: [number, number];
  /** Perpendicular bend as fraction of straight-line distance. */
  bendFactor: number;
  shadeBasePct: number;
  seed: number;
}

function synthesizeRoute(input: SynthRouteInput): RouteFeature {
  const { profile, origin, destination, bendFactor, shadeBasePct, seed } = input;

  // Bend midpoint sideways to suggest an alternate path.
  const mid: [number, number] = [
    (origin[0] + destination[0]) / 2,
    (origin[1] + destination[1]) / 2,
  ];
  const dLng = destination[0] - origin[0];
  const dLat = destination[1] - origin[1];
  const jitter = (coordHash(origin, seed) - coordHash(destination, seed)) * 0.6;
  const offsetLng = -dLat * bendFactor * jitter;
  const offsetLat = dLng * bendFactor * jitter;

  const coordinates: [number, number][] =
    bendFactor === 0 || (offsetLng === 0 && offsetLat === 0)
      ? [origin, mid, destination]
      : [
          origin,
          [mid[0] + offsetLng * 0.7, mid[1] + offsetLat * 0.7],
          [mid[0] + offsetLng, mid[1] + offsetLat],
          destination,
        ];

  const distance = polylineLengthM(coordinates);
  const duration = distance / WALKING_SPEED_MPS;
  const avgShade = Math.max(
    2,
    Math.min(92, shadeBasePct + jitter * 12)
  );
  const shadeFrac = avgShade / 100;
  const heatExposureS = duration * (1 - shadeFrac);
  const heatScore = distance * (1 - shadeFrac) * 1.2;

  const brg = Math.round(bearingDeg(origin, destination));
  const dir =
    brg >= 315 || brg < 45
      ? "north"
      : brg < 135
        ? "east"
        : brg < 225
          ? "south"
          : "west";
  const firstLeg = haversineM(coordinates[0], coordinates[1]);

  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {
      route_type: profile,
      total_distance_m: Math.round(distance),
      total_duration_s: Math.round(duration * 10) / 10,
      avg_shade_pct: Math.round(avgShade * 10) / 10,
      heat_exposure_score: Math.round(heatScore * 10) / 10,
      heat_exposure_duration_s: Math.round(heatExposureS),
      path_node_count: coordinates.length,
      navigation_steps: [
        {
          instruction: `Head ${dir} toward your destination for ${formatDistance(firstLeg)}`,
          distance_m: Math.round(firstLeg),
          duration_s: Math.round(firstLeg / WALKING_SPEED_MPS),
          bearing_deg: brg,
          street_name: null,
        },
        ...(coordinates.length > 3
          ? [
              {
                instruction: `Follow the cooler corridor for ${formatDistance(distance - firstLeg)}`,
                distance_m: Math.round(distance - firstLeg),
                duration_s: Math.round((distance - firstLeg) / WALKING_SPEED_MPS),
                bearing_deg: brg,
                street_name: null,
              },
            ]
          : []),
        {
          instruction: "Arrive at destination",
          distance_m: 0,
          duration_s: 0,
          bearing_deg: brg,
          street_name: null,
        },
      ],
    },
  };
}

/**
 * Build a demo route set (shortest / coolest / balanced) directly between two
 * searched places. Used until the FastAPI routing server is wired up — keeps
 * the search-and-select flow fully functional end-to-end.
 */
export function buildRoutesBetween(
  origin: [number, number],
  destination: [number, number]
): RouteCollection {
  const shortest = synthesizeRoute({
    profile: "shortest",
    origin,
    destination,
    bendFactor: 0,
    shadeBasePct: 12,
    seed: 11,
  });
  const coolest = synthesizeRoute({
    profile: "coolest",
    origin,
    destination,
    bendFactor: 0.35,
    shadeBasePct: 62,
    seed: 23,
  });
  const balanced = synthesizeRoute({
    profile: "balanced",
    origin,
    destination,
    bendFactor: 0.18,
    shadeBasePct: 38,
    seed: 37,
  });

  const features = [shortest, coolest, balanced];

  return {
    type: "FeatureCollection",
    features,
    properties: {
      origin: { lng: origin[0], lat: origin[1] },
      destination: { lng: destination[0], lat: destination[1] },
      distance_comparison: {
        shortest_m: shortest.properties.total_distance_m,
        coolest_m: coolest.properties.total_distance_m,
        balanced_m: balanced.properties.total_distance_m,
      },
      heat_exposure_comparison: {
        shortest_score: shortest.properties.heat_exposure_score,
        coolest_score: coolest.properties.heat_exposure_score,
        balanced_score: balanced.properties.heat_exposure_score,
      },
      shade_comparison: {
        shortest_avg_shade_pct: shortest.properties.avg_shade_pct,
        coolest_avg_shade_pct: coolest.properties.avg_shade_pct,
        balanced_avg_shade_pct: balanced.properties.avg_shade_pct,
      },
    },
  };
}
