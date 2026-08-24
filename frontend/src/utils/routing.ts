/**
 * Real walking-route fetching via OSRM (OpenStreetMap Routing Machine).
 *
 * Uses the free public FOSSGIS foot-profile instance that powers
 * openstreetmap.org's directions — no API key required.
 * Heat/shade metrics remain client-side estimates until the FortyGuard
 * Temperature API is wired into a backend route service.
 */

import type { NavigationStep, RouteCollection, RouteFeature, RouteProfile } from "../types/route";
import { estimateHeatMetrics, formatDistance } from "./map";

const OSRM_FOOT_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const WALKING_SPEED_MPS = 1.4;

export class RoutingError extends Error {}

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  maneuver: {
    type: string;
    modifier?: string;
    bearing_after?: number;
  };
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: Array<{ steps: OsrmStep[] }>;
}

interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
  message?: string;
}

function compassWord(modifier?: string): string {
  switch (modifier) {
    case "left": return "west";
    case "right": return "east";
    case "straight": return "north";
    case "uturn": return "back";
    default: return "out";
  }
}

/** Turn an OSRM step into a human-friendly instruction string. */
function stepInstruction(step: OsrmStep, isLast: boolean): string {
  const road = step.name || "the path";
  const dist = `for ${formatDistance(step.distance)}`;
  switch (step.maneuver.type) {
    case "depart":
      return `Head ${compassWord(step.maneuver.modifier)} along ${road} ${dist}`;
    case "turn":
      return `Turn ${step.maneuver.modifier ?? "left"} onto ${road} ${dist}`;
    case "new name":
      return `Continue onto ${road} ${dist}`;
    case "merge":
      return `Merge ${step.maneuver.modifier ?? ""} onto ${road} ${dist}`.replace("  ", " ");
    case "fork":
      return `Keep ${step.maneuver.modifier ?? "straight"} at the fork onto ${road} ${dist}`;
    case "end of road":
      return `At the end of the road, turn ${step.maneuver.modifier ?? "left"} onto ${road} ${dist}`;
    case "roundabout":
    case "rotary":
      return `Take the roundabout onto ${road} ${dist}`;
    case "arrive":
      return isLast ? "Arrive at destination" : `Arrive at waypoint (${formatDistance(step.distance)})`;
    default:
      return `Continue along ${road} ${dist}`;
  }
}

function toNavigationSteps(route: OsrmRoute): NavigationStep[] {
  const steps: NavigationStep[] = [];
  const allSteps = route.legs.flatMap((leg) => leg.steps);
  allSteps.forEach((s, i) => {
    steps.push({
      instruction: stepInstruction(s, i === allSteps.length - 1),
      distance_m: Math.round(s.distance),
      duration_s: Math.round(s.duration),
      bearing_deg: Math.round(s.maneuver.bearing_after ?? 0),
      street_name: s.name || null,
    });
  });
  return steps;
}

function toRouteFeature(route: OsrmRoute, profile: RouteProfile): RouteFeature {
  const coordinates = route.geometry.coordinates;
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {
      route_type: profile,
      total_distance_m: Math.round(route.distance),
      total_duration_s: Math.round(route.duration * 10) / 10,
      // Walking-pace sanity check: some profiles overestimate duration.
      ...(route.duration <= 0
        ? { total_duration_s: Math.round((route.distance / WALKING_SPEED_MPS) * 10) / 10 }
        : {}),
      path_node_count: coordinates.length,
      navigation_steps: toNavigationSteps(route),
      ...estimateHeatMetrics(coordinates, profile),
    },
  };
}

function comparisonBlock(features: RouteFeature[]): RouteCollection["properties"] {
  const byType = (p: RouteProfile) => features.find((f) => f.properties.route_type === p)!;
  const shortest = byType("shortest");
  const coolest = byType("coolest");
  const balanced = byType("balanced");
  return {
    origin: {
      lng: shortest.geometry.coordinates[0][0],
      lat: shortest.geometry.coordinates[0][1],
    },
    destination: {
      lng: shortest.geometry.coordinates[shortest.geometry.coordinates.length - 1][0],
      lat: shortest.geometry.coordinates[shortest.geometry.coordinates.length - 1][1],
    },
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
  };
}

/**
 * Fetch up to three real walking routes between two points and map them
 * onto the app's shortest / coolest / balanced profiles.
 * Throws RoutingError on any failure so callers can fall back gracefully.
 */
export async function fetchWalkingRoutes(
  origin: [number, number],
  destination: [number, number],
  options: { signal?: AbortSignal } = {}
): Promise<RouteCollection> {
  const coordsParam = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    alternatives: "true",
    steps: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${OSRM_FOOT_BASE}/${coordsParam}?${params.toString()}`, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new RoutingError(`Routing service unreachable`);
  }

  if (!res.ok) throw new RoutingError(`Routing request failed (HTTP ${res.status})`);

  const data = (await res.json()) as OsrmResponse;
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new RoutingError(data.message || `No route found (${data.code})`);
  }

  // Sort by distance; assign profiles in order shortest → coolest → balanced.
  const sorted = [...data.routes].sort((a, b) => a.distance - b.distance).slice(0, 3);
  const profiles: RouteProfile[] = ["shortest", "coolest", "balanced"];
  const features = sorted.map((r, i) => toRouteFeature(r, profiles[i]));

  while (features.length < 3) {
    // Service returned fewer alternatives than requested — duplicate the
    // longest known geometry under the remaining profile so all three cards
    // stay populated (metrics still differentiate them).
    const template = features[features.length - 1];
    const profile = profiles[features.length];
    features.push({
      ...template,
      properties: {
        ...template.properties,
        ...estimateHeatMetrics(template.geometry.coordinates, profile),
        route_type: profile,
      },
    });
  }

  return { type: "FeatureCollection", features, properties: comparisonBlock(features) };
}
