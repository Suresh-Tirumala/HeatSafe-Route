import { useEffect, useRef, useCallback, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RouteCollection, ActiveRoute, TempReading } from "../types/route";
import { ROUTE_COLORS } from "../types/route";
import type { ThemeMode } from "../theme";
import {
  heatDataToGeoJSON,
  buildMarkersGeoJSON,
  generateMockHeatData,
} from "../utils/map";

// Free OpenStreetMap raster tiles — no API key required. CARTO's
// basemaps.cartocdn.com now enforces an API key, so we use OSM directly.
const OSM_RASTER_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];

const OSM_RASTER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const OSM_LIGHT_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "osm-basemap": {
      type: "raster",
      tiles: OSM_RASTER_TILES,
      tileSize: 256,
      attribution: OSM_RASTER_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "osm-basemap-layer",
      type: "raster",
      source: "osm-basemap",
    },
  ],
};

// Same OSM tiles, darkened via MapLibre paint properties for dark mode.
const OSM_DARK_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "osm-basemap": {
      type: "raster",
      tiles: OSM_RASTER_TILES,
      tileSize: 256,
      attribution: OSM_RASTER_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "osm-basemap-dark-layer",
      type: "raster",
      source: "osm-basemap",
      paint: {
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.25,
        "raster-saturation": -0.6,
        "raster-contrast": 0.2,
      },
    },
  ],
};

const BASEMAP_STYLES: Record<ThemeMode, maplibregl.StyleSpecification> = {
  dark: OSM_DARK_RASTER_STYLE,
  light: OSM_LIGHT_RASTER_STYLE,
};

// ─── Geolocation Control ──────────────────────────────────────────────

class GeolocateButton implements maplibregl.IControl {
  private _container: HTMLDivElement | undefined;
  private _btn: HTMLButtonElement | undefined;
  private _map: maplibregl.Map | undefined;
  private _marker: maplibregl.Marker | undefined;
  private _watchId: number | null = null;
  private _onLocate: ((lng: number, lat: number) => void) | undefined;

  onAdd(map: maplibregl.Map): HTMLElement {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._btn = document.createElement("button");
    this._btn.type = "button";
    this._btn.title = "Show my location";
    this._btn.setAttribute("data-testid", "geolocate-btn");
    this._btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="5" y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
    </svg>`;
    this._btn.style.cssText = "width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:#fff;border:none;padding:0;";
    this._btn.addEventListener("click", () => this._locate());

    this._container.appendChild(this._btn);
    return this._container;
  }

  onRemove(): void {
    this._container?.remove();
    this._map = undefined;
  }

  onLocation(cb: (lng: number, lat: number) => void): void {
    this._onLocate = cb;
  }

  private _locate(): void {
    if (!this._map) return;

    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
      this._marker?.remove();
      this._marker = undefined;
      this._btn!.style.background = "#fff";
      return;
    }

    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    this._btn!.style.background = "#dbeafe";

    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude: lng, latitude: lat } = pos.coords;

        if (!this._marker) {
          const el = document.createElement("div");
          el.setAttribute("data-testid", "user-location-marker");
          el.style.cssText = "position:relative;width:16px;height:16px;";
          el.innerHTML = `
            <span style="
              position:absolute;top:0;left:0;width:16px;height:16px;
              border-radius:50%;background:rgba(59,130,246,0.3);
              animation: pulse-ring 1.5s ease-out infinite;
            "></span>
            <span style="
              position:absolute;top:3px;left:3px;width:10px;height:10px;
              border-radius:50%;background:#3B82F6;
              border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);
            "></span>
          `;

          this._marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(this._map!);

          this._map!.flyTo({ center: [lng, lat], zoom: 16, duration: 1000 });
        } else {
          this._marker.setLngLat([lng, lat]);
        }

        this._btn!.style.background = "#dbeafe";
        this._onLocate?.(lng, lat);
      },
      () => {
        this._btn!.style.background = "#fff";
        alert("Unable to retrieve your location. Please allow location access.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }
}

interface HeatSafeMapProps {
  routeData: RouteCollection | null;
  activeRoute: ActiveRoute;
  /** Centre used for the heat overlay; re-generates the mock FortyGuard data. */
  heatCenter?: [number, number] | null;
  /** Point to fly to when only one endpoint has been chosen. */
  focusPoint?: [number, number] | null;
  /** Fired on map clicks so users can pin origin/destination directly. */
  onMapClick?: (lng: number, lat: number) => void;
  /** Light / dark mode — swaps both UI palette and basemap tiles. */
  mode?: ThemeMode;
  /** Mobile layout — reduces map fit/padding so routes fill the screen. */
  mobile?: boolean;
}

export default function HeatSafeMap({
  routeData,
  activeRoute,
  heatCenter = null,
  focusPoint = null,
  onMapClick,
  mode = "dark",
  mobile = false,
}: HeatSafeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const appliedHeatCenterRef = useRef<[number, number] | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const heatCenterRef = useRef(heatCenter);
  heatCenterRef.current = heatCenter;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const appliedStyleModeRef = useRef<ThemeMode | null>(null);
  const styleTokenRef = useRef(0);
  const updateRoutesRef = useRef<() => void>(() => {});

  // ── Readiness handling ────────────────────────────────────────────
  // NOTE: MapLibre v6's isStyleLoaded() only returns true once every tile
  // in the viewport has finished loading, so it can stay false for a long
  // time (or forever with a hung tile request). It is NOT usable as a gate
  // for style mutations. Instead we treat the map as ready once the "load"
  // event has added our sources, and queue any updates requested before.
  const mapReadyRef = useRef(false);
  const pendingOpsRef = useRef<Array<() => void>>([]);

  const whenMapReady = useCallback((op: () => void) => {
    if (mapRef.current && mapReadyRef.current) {
      op();
    } else {
      pendingOpsRef.current.push(op);
    }
  }, []);

  // ── Style content (sources + layers + popup) ─────────────────────
  // Extracted so it can be re-applied after a light/dark basemap swap,
  // since setStyle() discards every custom source and layer.
  const setupLayers = useCallback((map: maplibregl.Map) => {
    popupRef.current?.remove();

    const heatCenter = heatCenterRef.current ?? ([35.202, 31.781] as [number, number]);
    appliedHeatCenterRef.current = heatCenter;
    const heatData: TempReading[] = generateMockHeatData(heatCenter);
    map.addSource("heat-source", {
      type: "geojson",
      data: heatDataToGeoJSON(heatData),
    });

    map.addLayer({
      id: "heat-layer",
      type: "heatmap",
      source: "heat-source",
      maxzoom: 18,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "temp_c"],
          28, 0,
          45, 1,
        ],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12, 0.6,
          18, 2.0,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.2, "#2563EB",
          0.4, "#22D3EE",
          0.6, "#FACC15",
          0.8, "#F97316",
          1.0, "#DC2626",
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12, 12,
          18, 30,
        ],
        "heatmap-opacity": 0.45,
      },
    });

    map.addSource("routes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    for (const profile of ["shortest", "coolest", "balanced"] as const) {
      map.addLayer({
        id: `route-outline-${profile}`,
        type: "line",
        source: "routes",
        filter: ["==", ["get", "route_type"], profile],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": ROUTE_COLORS[profile],
          "line-width": 6,
          "line-opacity": 0.35,
        },
      });

      map.addLayer({
        id: `route-line-${profile}`,
        type: "line",
        source: "routes",
        filter: ["==", ["get", "route_type"], profile],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": ROUTE_COLORS[profile],
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });
    }

    map.addSource("markers", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    map.addLayer({
      id: "marker-layer",
      type: "circle",
      source: "markers",
      paint: {
        "circle-radius": 8,
        "circle-color": [
          "match",
          ["get", "marker_type"],
          "origin", "#22C55E",
          "destination", "#EF4444",
          "#888",
        ],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
    });
    popupRef.current = popup;

    map.on("mouseenter", "heat-layer", (e: any) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      if (!feature) return;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const temp = (feature.properties as Record<string, number>)?.temp_c ?? 0;
      popup
        .setLngLat(coords)
        .setHTML(
          `<div style="font-size:13px;font-weight:600;color:#fff;background:#000;padding:4px 8px;border-radius:4px">
            ${temp.toFixed(1)} °C surface
          </div>`
        )
        .addTo(map);
    });

    map.on("mouseleave", "heat-layer", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
  }, []);

  // ── Initialise map ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLES[modeRef.current],
      center: [35.2020, 31.7810],
      zoom: 15.5,
      pitch: 0,
      bearing: 0,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const geolocate = new GeolocateButton();
    map.addControl(geolocate, "top-right");

    // Inject pulse animation keyframes
    if (!document.getElementById("geolocate-pulse-css")) {
      const style = document.createElement("style");
      style.id = "geolocate-pulse-css";
      style.textContent = `
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    map.on("load", () => {
      setupLayers(map);

      // ── Click-to-pick origin / destination ──────────────────────
      map.on("click", (e: maplibregl.MapMouseEvent) => {
        onMapClickRef.current?.(e.lngLat.lng, e.lngLat.lat);
      });

      appliedStyleModeRef.current = modeRef.current;

      // Style is now initialised (sources exist) — flush queued updates.
      mapReadyRef.current = true;
      const pending = pendingOpsRef.current;
      pendingOpsRef.current = [];
      for (const op of pending) op();
    });

    mapRef.current = map;

    return () => {
      mapReadyRef.current = false;
      pendingOpsRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Swap basemap when light/dark mode changes ─────────────────────
  // setStyle() wipes custom sources/layers, so after "style.load" fires
  // we rebuild them and re-apply current route/marker/heat data. A token
  // guards against stale callbacks from rapid toggling.
  useEffect(() => {
    if (appliedStyleModeRef.current === mode) return;
    whenMapReady(() => {
      const map = mapRef.current;
      if (!map || appliedStyleModeRef.current === mode) return;
      appliedStyleModeRef.current = mode;
      const token = ++styleTokenRef.current;
      map.setStyle(BASEMAP_STYLES[mode], { diff: false });
      map.once("style.load", () => {
        if (mapRef.current !== map || token !== styleTokenRef.current) return;
        setupLayers(map);
        updateRoutesRef.current();
      });
    });
  }, [mode, whenMapReady, setupLayers]);

  // ── Update route layers when data / active route changes ──────────
  const updateRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!routeData) {
      const empty: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };
      (map.getSource("routes") as maplibregl.GeoJSONSource)?.setData(empty);
      (map.getSource("markers") as maplibregl.GeoJSONSource)?.setData(empty);
      return;
    }

    // Rebuild features with per-feature visibility
    const features = routeData.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _visible:
          activeRoute === null || f.properties.route_type === activeRoute,
      },
    }));

    (map.getSource("routes") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features,
    });

    // Toggle layer visibility
    for (const profile of ["shortest", "coolest", "balanced"] as const) {
      const visible =
        activeRoute === null || activeRoute === profile;
      const lineWidth = profile === activeRoute ? 5 : 3;
      const opacity = visible ? (profile === activeRoute ? 1.0 : 0.45) : 0;

      for (const prefix of ["route-outline-", "route-line-"]) {
        map.setPaintProperty(
          `${prefix}${profile}`,
          "line-opacity",
          opacity
        );
      }
      map.setPaintProperty(
        `route-line-${profile}`,
        "line-width",
        lineWidth
      );
    }

    // Update markers
    (map.getSource("markers") as maplibregl.GeoJSONSource)?.setData(
      buildMarkersGeoJSON(
        [routeData.properties.origin.lng, routeData.properties.origin.lat],
        [routeData.properties.destination.lng, routeData.properties.destination.lat]
      )
    );

    // Fit bounds to show full route
    const allCoords = routeData.features.flatMap(
      (f) => f.geometry.coordinates
    );
    if (allCoords.length >= 2) {
      const lngs = allCoords.map((c) => c[0]);
      const lats = allCoords.map((c) => c[1]);
      const isMobileLayout = mobileRef.current;
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        isMobileLayout
          ? { padding: { top: 140, bottom: 120, left: 40, right: 40 }, maxZoom: 16 }
          : { padding: { top: 80, bottom: 80, left: 420, right: 80 }, maxZoom: 16 }
      );
    }
  }, [routeData, activeRoute]);

  useEffect(() => {
    whenMapReady(updateRoutes);
  }, [updateRoutes, whenMapReady]);
  updateRoutesRef.current = updateRoutes;

  // ── Re-centre heat overlay when the searched area changes ──────────
  useEffect(() => {
    if (!heatCenter) return;
    const applied = appliedHeatCenterRef.current;
    if (
      applied &&
      Math.abs(applied[0] - heatCenter[0]) < 1e-9 &&
      Math.abs(applied[1] - heatCenter[1]) < 1e-9
    ) {
      return; // already showing this area
    }
    whenMapReady(() => {
      const map = mapRef.current;
      if (!map) return;
      const source = map.getSource("heat-source") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData(heatDataToGeoJSON(generateMockHeatData(heatCenter)));
      appliedHeatCenterRef.current = heatCenter;
    });
  }, [heatCenter, whenMapReady]);

  // ── Fly to a single selected place (before destination chosen) ─────
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPoint) return;
    const key = focusPoint.join(",");
    if (lastFocusRef.current === key) return;
    lastFocusRef.current = key;
    whenMapReady(() => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: focusPoint, zoom: Math.max(map.getZoom(), 14.5), duration: 1200 });
    });
  }, [focusPoint, whenMapReady]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
    />
  );
}
