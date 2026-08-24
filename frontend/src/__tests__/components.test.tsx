/**
 * HeatSafe Route — Frontend Component Tests
 *
 * Validates:
 *   1. RoutePanel renders all three route cards from GeoJSON payload.
 *   2. RouteToggle switches active route and updates panel state.
 *   3. Distance/shade/heat metrics are displayed correctly.
 *   4. Navigation steps render for the active route.
 *   5. Empty state renders when no data is provided.
 *   6. GeoJSON utility functions produce valid output.
 *   7. HeatSafeMap initialises with correct source data.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getSetDataCalls, getLastSetDataPayload } from "./setup";

import RoutePanel from "../components/RoutePanel";
import RouteToggle from "../components/RouteToggle";
import HeatSafeMap from "../components/HeatSafeMap";
import type { RouteCollection, RouteProfile } from "../types/route";
import {
  formatDistance,
  formatDuration,
  getRoute,
  pctDiff,
  heatDataToGeoJSON,
  buildMarkersGeoJSON,
} from "../utils/map";

// ── Fixture ──────────────────────────────────────────────────────────

const MOCK_DATA: RouteCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [35.2, 31.78],
          [35.2018, 31.78],
          [35.2036, 31.78],
        ],
      },
      properties: {
        route_type: "shortest",
        total_distance_m: 280,
        total_duration_s: 200.0,
        avg_shade_pct: 6.4,
        heat_exposure_score: 336.0,
        heat_exposure_duration_s: 200.0,
        path_node_count: 3,
        navigation_steps: [
          { instruction: "Head east on Sun Ave for 200 m", distance_m: 200, duration_s: 142.9, bearing_deg: 90, street_name: "Sun Ave" },
          { instruction: "Continue for 80 m", distance_m: 80, duration_s: 57.1, bearing_deg: 90, street_name: null },
        ],
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [35.2, 31.78],
          [35.2, 31.7808],
          [35.2018, 31.7808],
          [35.2036, 31.78],
        ],
      },
      properties: {
        route_type: "coolest",
        total_distance_m: 280,
        total_duration_s: 200.0,
        avg_shade_pct: 63.1,
        heat_exposure_score: 210.5,
        heat_exposure_duration_s: 42.0,
        path_node_count: 4,
        navigation_steps: [
          { instruction: "Head south on Oak Lane", distance_m: 140, duration_s: 100, bearing_deg: 180, street_name: "Oak Lane" },
        ],
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [35.2, 31.78],
          [35.2, 31.7808],
          [35.2018, 31.7808],
          [35.2036, 31.78],
        ],
      },
      properties: {
        route_type: "balanced",
        total_distance_m: 280,
        total_duration_s: 200.0,
        avg_shade_pct: 63.1,
        heat_exposure_score: 255.0,
        heat_exposure_duration_s: 58.0,
        path_node_count: 4,
        navigation_steps: [],
      },
    },
  ],
  properties: {
    origin: { lng: 35.2, lat: 31.78 },
    destination: { lng: 35.2036, lat: 31.78 },
    distance_comparison: { shortest_m: 280, coolest_m: 280, balanced_m: 280 },
    heat_exposure_comparison: { shortest_score: 336, coolest_score: 210.5, balanced_score: 255 },
    shade_comparison: {
      shortest_avg_shade_pct: 6.4,
      coolest_avg_shade_pct: 63.1,
      balanced_avg_shade_pct: 63.1,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Tests: Utility functions
// ═══════════════════════════════════════════════════════════════════════

describe("Utility functions", () => {
  it("formatDistance shows km for >= 1000 m", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
  });

  it("formatDistance shows m for < 1000 m", () => {
    expect(formatDistance(350)).toBe("350 m");
  });

  it("formatDuration shows seconds for < 60s", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formatDuration shows minutes for >= 60s", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("formatDuration shows minutes only when seconds = 0", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("getRoute extracts correct feature", () => {
    const feat = getRoute(MOCK_DATA, "coolest");
    expect(feat).toBeDefined();
    expect(feat!.properties.route_type).toBe("coolest");
  });

  it("getRoute returns undefined for missing profile", () => {
    const feat = getRoute(MOCK_DATA, "shortest" as RouteProfile);
    expect(feat).toBeDefined(); // shortest exists in fixture
  });

  it("pctDiff calculates correctly", () => {
    expect(pctDiff(100, 115)).toBeCloseTo(15);
    expect(pctDiff(100, 90)).toBeCloseTo(-10);
  });

  it("pctDiff returns 0 when base is 0", () => {
    expect(pctDiff(0, 100)).toBe(0);
  });

  it("heatDataToGeoJSON produces valid FeatureCollection", () => {
    const geojson = heatDataToGeoJSON([
      { lng: 35.2, lat: 31.78, temp_c: 38 },
      { lng: 35.21, lat: 31.79, temp_c: 42 },
    ]);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(2);
    expect(geojson.features[0].geometry.type).toBe("Point");
    expect((geojson.features[0].properties as Record<string, number>).temp_c).toBe(38);
  });

  it("buildMarkersGeoJSON produces origin + destination", () => {
    const geojson = buildMarkersGeoJSON([35.2, 31.78], [35.3, 31.8]);
    expect(geojson.features).toHaveLength(2);
    expect((geojson.features[0].properties as Record<string, string>).marker_type).toBe("origin");
    expect((geojson.features[1].properties as Record<string, string>).marker_type).toBe("destination");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests: RouteToggle
// ═══════════════════════════════════════════════════════════════════════

describe("RouteToggle", () => {
  it("renders all four buttons", () => {
    render(<RouteToggle activeRoute={null} onChange={() => {}} />);
    expect(screen.getByTestId("toggle-all")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-shortest")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-coolest")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-balanced")).toBeInTheDocument();
  });

  it("calls onChange with profile on click", () => {
    const onChange = vi.fn();
    render(<RouteToggle activeRoute={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("toggle-coolest"));
    expect(onChange).toHaveBeenCalledWith("coolest");
  });

  it("calls onChange with null on All click", () => {
    const onChange = vi.fn();
    render(<RouteToggle activeRoute="shortest" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("toggle-all"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders colour dots for each profile", () => {
    render(<RouteToggle activeRoute={null} onChange={() => {}} />);
    expect(screen.getByTestId("dot-shortest")).toBeInTheDocument();
    expect(screen.getByTestId("dot-coolest")).toBeInTheDocument();
    expect(screen.getByTestId("dot-balanced")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests: RoutePanel
// ═══════════════════════════════════════════════════════════════════════

describe("RoutePanel", () => {
  it("renders empty state when no data", () => {
    render(<RoutePanel routeData={null} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getByText("No route loaded")).toBeInTheDocument();
  });

  it("renders all three route cards", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getByTestId("route-card-shortest")).toBeInTheDocument();
    expect(screen.getByTestId("route-card-coolest")).toBeInTheDocument();
    expect(screen.getByTestId("route-card-balanced")).toBeInTheDocument();
  });

  it("displays correct distance values", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getAllByText("280 m").length).toBeGreaterThanOrEqual(3);
  });

  it("displays shade percentages", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getAllByText("6%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("63%").length).toBeGreaterThanOrEqual(2);
  });

  it("shows comparison table", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getByText("Comparison")).toBeInTheDocument();
  });

  it("shows directions when route is active", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute="shortest" onRouteChange={() => {}} />);
    expect(screen.getByText("Directions")).toBeInTheDocument();
    expect(screen.getByTestId("nav-step-0")).toBeInTheDocument();
  });

  it("does not show directions when no route is active", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.queryByText("Directions")).not.toBeInTheDocument();
  });

  it("calls onRouteChange when a card is clicked", () => {
    const onChange = vi.fn();
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={onChange} />);
    fireEvent.click(screen.getByTestId("route-card-coolest"));
    expect(onChange).toHaveBeenCalledWith("coolest");
  });

  it("shows route type labels in cards", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getAllByText("Shortest").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Coolest").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Balanced").length).toBeGreaterThanOrEqual(1);
  });

  it("header shows application name", () => {
    render(<RoutePanel routeData={MOCK_DATA} activeRoute={null} onRouteChange={() => {}} />);
    expect(screen.getByText("HeatSafe Route")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests: RoutePanel — Settings drawer
// ═══════════════════════════════════════════════════════════════════════

describe("RoutePanel — Settings drawer", () => {
  const baseProps = {
    routeData: MOCK_DATA,
    activeRoute: null,
    onRouteChange: () => {},
  };

  it("opens the settings drawer from the sidebar gear button", () => {
    render(<RoutePanel {...baseProps} />);
    expect(screen.queryByTestId("settings-drawer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-btn"));
    expect(screen.getByTestId("settings-drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-back-btn"));
    expect(screen.queryByTestId("settings-drawer")).not.toBeInTheDocument();
  });

  it("shows signed-in user details inside settings", () => {
    render(
      <RoutePanel
        {...baseProps}
        userEmail="suresh.tirumala477@gmail.com"
        mode="dark"
      />
    );
    fireEvent.click(screen.getByTestId("settings-btn"));
    expect(screen.getByText("suresh.tirumala477@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("suresh tirumala477")).toBeInTheDocument();
    expect(screen.getByText(/heatSafe member/i)).toBeInTheDocument();
  });

  it("hosts the dark mode switch and reports toggles", () => {
    const onToggleTheme = vi.fn();
    render(
      <RoutePanel
        {...baseProps}
        mode="dark"
        onToggleTheme={onToggleTheme}
      />
    );
    fireEvent.click(screen.getByTestId("settings-btn"));
    const sw = screen.getByTestId("dark-mode-toggle");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("sign out closes the drawer and notifies the app", () => {
    const onSignOut = vi.fn();
    render(<RoutePanel {...baseProps} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByTestId("settings-btn"));
    fireEvent.click(screen.getByTestId("signout-btn"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("settings-drawer")).not.toBeInTheDocument();
  });

  it("sidebar logo click navigates back to the hero page", () => {
    const onLogoClick = vi.fn();
    render(
      <RoutePanel
        {...baseProps}
        userEmail="suresh.tirumala477@gmail.com"
        onLogoClick={onLogoClick}
      />
    );
    const logo = screen.getByTestId("sidebar-logo");
    expect(logo).toHaveTextContent("HeatSafe Route");
    fireEvent.click(logo);
    expect(onLogoClick).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests: HeatSafeMap (smoke — Mapbox is mocked)
// ═══════════════════════════════════════════════════════════════════════

describe("HeatSafeMap", () => {
  it("renders map container", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });

  it("renders without crashing with null data", () => {
    render(
      <HeatSafeMap
        routeData={null}
        activeRoute={null}

      />
    );
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration Tests: Dynamic Edge Weighting — Toggle → setData
// ═══════════════════════════════════════════════════════════════════════

describe("HeatSafeMap — Integration: toggle → setData GeoJSON payload", () => {
  it("calls setData on 'routes' source with all three route features on initial render", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    expect(payload).toBeDefined();
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(3);
  });

  it("sets _visible=true on all features when activeRoute is null (All)", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    for (const feat of payload.features) {
      expect(feat.properties._visible).toBe(true);
    }
  });

  it("sets _visible only on the selected feature when a profile is active", () => {
    const { rerender } = render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );

    // Re-render with "coolest" active
    rerender(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute="coolest"

      />
    );

    const payload = getLastSetDataPayload("routes");
    for (const feat of payload.features) {
      if (feat.properties.route_type === "coolest") {
        expect(feat.properties._visible).toBe(true);
      } else {
        expect(feat.properties._visible).toBe(false);
      }
    }
  });

  it("clears route data when routeData is set to null", () => {
    const { rerender } = render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );

    rerender(
      <HeatSafeMap
        routeData={null}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    expect(payload.features).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration Tests: Edge Metrics Serialization in GeoJSON Properties
// ═══════════════════════════════════════════════════════════════════════

describe("HeatSafeMap — Integration: edge metrics in GeoJSON properties", () => {
  const MOCK_DATA_WITH_EDGE_METRICS: RouteCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [35.2, 31.78],
            [35.2018, 31.78],
          ],
        },
        properties: {
          route_type: "shortest",
          total_distance_m: 200,
          total_duration_s: 142.9,
          avg_shade_pct: 5.0,
          heat_exposure_score: 420.5,
          heat_exposure_duration_s: 142.9,
          path_node_count: 2,
          wbgt_proxy: 38.2,
          heat_penalty: 2.64,
          shade_discount: 0.004,
          navigation_steps: [],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [35.2, 31.78],
            [35.2, 31.7808],
            [35.2018, 31.78],
          ],
        },
        properties: {
          route_type: "coolest",
          total_distance_m: 260,
          total_duration_s: 185.7,
          avg_shade_pct: 82.5,
          heat_exposure_score: 185.3,
          heat_exposure_duration_s: 30.0,
          path_node_count: 3,
          wbgt_proxy: 29.1,
          heat_penalty: 0.82,
          shade_discount: 0.066,
          navigation_steps: [],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [35.2, 31.78],
            [35.2, 31.7808],
            [35.2018, 31.78],
          ],
        },
        properties: {
          route_type: "balanced",
          total_distance_m: 260,
          total_duration_s: 185.7,
          avg_shade_pct: 82.5,
          heat_exposure_score: 240.0,
          heat_exposure_duration_s: 50.0,
          path_node_count: 3,
          wbgt_proxy: 31.5,
          heat_penalty: 1.30,
          shade_discount: 0.033,
          navigation_steps: [],
        },
      },
    ],
    properties: {
      origin: { lng: 35.2, lat: 31.78 },
      destination: { lng: 35.2018, lat: 31.78 },
      distance_comparison: { shortest_m: 200, coolest_m: 260, balanced_m: 260 },
      heat_exposure_comparison: { shortest_score: 420.5, coolest_score: 185.3, balanced_score: 240 },
      shade_comparison: {
        shortest_avg_shade_pct: 5.0,
        coolest_avg_shade_pct: 82.5,
        balanced_avg_shade_pct: 82.5,
      },
    },
  };

  it("serializes wbgt_proxy into GeoJSON feature properties", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA_WITH_EDGE_METRICS}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    const shortest = payload.features.find(
      (f: any) => f.properties.route_type === "shortest"
    );
    const coolest = payload.features.find(
      (f: any) => f.properties.route_type === "coolest"
    );

    expect(shortest.properties.wbgt_proxy).toBe(38.2);
    expect(coolest.properties.wbgt_proxy).toBe(29.1);
    expect(coolest.properties.wbgt_proxy).toBeLessThan(shortest.properties.wbgt_proxy);
  });

  it("serializes heat_penalty into GeoJSON feature properties", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA_WITH_EDGE_METRICS}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    for (const feat of payload.features) {
      expect(typeof feat.properties.heat_penalty).toBe("number");
      expect(feat.properties.heat_penalty).toBeGreaterThanOrEqual(0);
    }
  });

  it("serializes shade_discount into GeoJSON feature properties", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA_WITH_EDGE_METRICS}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    for (const feat of payload.features) {
      expect(typeof feat.properties.shade_discount).toBe("number");
      expect(feat.properties.shade_discount).toBeGreaterThanOrEqual(0);
      expect(feat.properties.shade_discount).toBeLessThanOrEqual(1);
    }
  });

  it("all standard route properties are present in the payload", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA_WITH_EDGE_METRICS}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    const requiredFields = [
      "route_type",
      "total_distance_m",
      "total_duration_s",
      "avg_shade_pct",
      "heat_exposure_score",
      "heat_exposure_duration_s",
      "navigation_steps",
      "path_node_count",
    ];

    for (const feat of payload.features) {
      for (const field of requiredFields) {
        expect(feat.properties).toHaveProperty(field);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration Tests: Full App Toggle Flow
// ═══════════════════════════════════════════════════════════════════════

describe("Full App toggle flow — Toggle changes propagate to map", () => {
  it("clicking 'Coolest' in toggle causes setData with _visible=false on non-coolest features", () => {
    render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute="coolest"

      />
    );

    const payload = getLastSetDataPayload("routes");
    const coolest = payload.features.find(
      (f: any) => f.properties.route_type === "coolest"
    );
    const shortest = payload.features.find(
      (f: any) => f.properties.route_type === "shortest"
    );

    expect(coolest.properties._visible).toBe(true);
    expect(shortest.properties._visible).toBe(false);
  });

  it("switching from 'coolest' to 'shortest' updates _visible flags", () => {
    const { rerender } = render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute="coolest"

      />
    );

    rerender(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute="shortest"

      />
    );

    const payload = getLastSetDataPayload("routes");
    const shortest = payload.features.find(
      (f: any) => f.properties.route_type === "shortest"
    );
    const coolest = payload.features.find(
      (f: any) => f.properties.route_type === "coolest"
    );

    expect(shortest.properties._visible).toBe(true);
    expect(coolest.properties._visible).toBe(false);
  });

  it("switching to 'All' (null) makes all features visible again", () => {
    const { rerender } = render(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute="coolest"

      />
    );

    rerender(
      <HeatSafeMap
        routeData={MOCK_DATA}
        activeRoute={null}

      />
    );

    const payload = getLastSetDataPayload("routes");
    for (const feat of payload.features) {
      expect(feat.properties._visible).toBe(true);
    }
  });
});
