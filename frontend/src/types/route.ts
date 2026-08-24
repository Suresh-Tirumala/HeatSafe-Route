/**
 * HeatSafe Route — Frontend TypeScript Types
 *
 * Mirrors the GeoJSON FeatureCollection produced by
 * app.core.router.triple_route_to_geojson().
 */

export type RouteProfile = "shortest" | "coolest" | "balanced";

export interface NavigationStep {
  instruction: string;
  distance_m: number;
  duration_s: number;
  bearing_deg: number;
  street_name: string | null;
}

export interface RouteProperties {
  route_type: RouteProfile;
  total_distance_m: number;
  total_duration_s: number;
  avg_shade_pct: number;
  heat_exposure_score: number;
  heat_exposure_duration_s: number;
  navigation_steps: NavigationStep[];
  path_node_count: number;
  wbgt_proxy?: number;
  heat_penalty?: number;
  shade_discount?: number;
}

export interface RouteFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: RouteProperties;
}

export interface RouteComparison {
  shortest_m: number;
  coolest_m: number;
  balanced_m: number;
}

export interface HeatComparison {
  shortest_score: number;
  coolest_score: number;
  balanced_score: number;
}

export interface ShadeComparison {
  shortest_avg_shade_pct: number;
  coolest_avg_shade_pct: number;
  balanced_avg_shade_pct: number;
}

export interface RouteCollectionProperties {
  origin: { lng: number; lat: number };
  destination: { lng: number; lat: number };
  distance_comparison: RouteComparison;
  heat_exposure_comparison: HeatComparison;
  shade_comparison: ShadeComparison;
}

export interface RouteCollection {
  type: "FeatureCollection";
  features: RouteFeature[];
  properties: RouteCollectionProperties;
}

/** Surface temperature reading for heatmap overlay. */
export interface TempReading {
  lng: number;
  lat: number;
  temp_c: number;
}

/** Active route selection state. */
export type ActiveRoute = RouteProfile | null;

/** Route color palette (hex strings). */
export const ROUTE_COLORS: Record<RouteProfile, string> = {
  shortest: "#EF4444", // red-500
  coolest: "#22C55E",  // green-500
  balanced: "#3B82F6", // blue-500
};

export const ROUTE_LABELS: Record<RouteProfile, string> = {
  shortest: "Shortest",
  coolest: "Coolest",
  balanced: "Balanced",
};
