import { useState, useEffect, useMemo } from "react";
import HeatSafeMap from "./components/HeatSafeMap";
import RoutePanel from "./components/RoutePanel";
import LocationSearch from "./components/LocationSearch";
import HeroSection from "./components/HeroSection";
import TravelConnectSignIn from "./components/ui/travel-connect-signin-1";
import type { PlaceResult } from "./utils/geocoding";
import { reverseGeocode } from "./utils/geocoding";
import { buildRoutesBetween } from "./utils/map";
import { fetchWalkingRoutes } from "./utils/routing";
import type { RouteCollection, RouteProfile } from "./types/route";
import { useThemeMode } from "./ThemeProvider";
import { themes } from "./theme";

export default function App() {
  const [origin, setOrigin] = useState<PlaceResult | null>(null);
  const [destination, setDestination] = useState<PlaceResult | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteProfile | null>(null);
  const [routeData, setRouteData] = useState<RouteCollection | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesNotice, setRoutesNotice] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const { theme, toggle, mode } = useThemeMode();
  type View = "landing" | "signin" | "home";
  const viewFromHash = (): View => {
    if (typeof window === "undefined") return "landing";
    const hash = window.location.hash;
    if (hash === "#home") return "home";
    if (hash === "#signin") return "signin";
    return "landing";
  };
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const syncFromHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const goTo = (hash: string) => {
    window.location.hash = hash;
  };

  // Fetch real road-following walking routes whenever both ends are set.
  useEffect(() => {
    if (!origin || !destination) {
      setRouteData(null);
      setRoutesNotice(null);
      setRoutesLoading(false);
      return;
    }

    let cancelled = false;
    setRoutesLoading(true);
    setRoutesNotice(null);

    fetchWalkingRoutes([origin.lng, origin.lat], [destination.lng, destination.lat])
      .then((rc) => {
        if (!cancelled) setRouteData(rc);
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return;
        // Offline / service hiccup — degrade to straight-line demo paths.
        setRouteData(
          buildRoutesBetween([origin.lng, origin.lat], [destination.lng, destination.lat])
        );
        setRoutesNotice("Routing service unavailable — showing approximate paths");
      })
      .finally(() => {
        if (!cancelled) setRoutesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin, destination]);

  const singlePoint =
    origin && !destination
      ? ([origin.lng, origin.lat] as [number, number])
      : !origin && destination
        ? ([destination.lng, destination.lat] as [number, number])
        : null;

  const heatCenter: [number, number] | null = useMemo(() => {
    if (origin && destination) {
      return [
        (origin.lng + destination.lng) / 2,
        (origin.lat + destination.lat) / 2,
      ];
    }
    return singlePoint;
  }, [origin, destination, singlePoint]);

  const handleMapClick = (lng: number, lat: number) => {
    const target = !origin ? setOrigin : setDestination;
    reverseGeocode(lng, lat).then(target);
  };

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  // Dark mode is scoped to the map workspace only — landing & sign-in stay light.
  const isHomeDark = view === "home" && mode === "dark";

  useEffect(() => {
    document.body.style.background = isHomeDark
      ? theme.pageBg
      : themes.light.pageBg;
    document.documentElement.style.colorScheme = isHomeDark ? "dark" : "light";
  }, [isHomeDark, theme]);

  if (view === "landing") {
    return (
      <HeroSection
        onGetStarted={() => goTo("#signin")}
        onSignIn={() => goTo("#signin")}
      />
    );
  }

  if (view === "signin") {
    return (
      <TravelConnectSignIn
        onSignIn={(email, name) => {
          if (email) setUserEmail(email);
          if (name) setUserName(name);
          goTo("#home");
        }}
      />
    );
  }

  return (
    <div
      className={isHomeDark ? "dark" : ""}
      style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}
    >
      <RoutePanel
        routeData={routeData}
        activeRoute={activeRoute}
        onRouteChange={setActiveRoute}
        theme={theme}
        userEmail={userEmail}
        userName={userName}
        mode={mode}
        onToggleTheme={toggle}
        onSignOut={() => {
          setUserEmail(null);
          setUserName(null);
          goTo("#signin");
        }}
        onLogoClick={() => goTo("")}
      />
      <div style={{ position: "absolute", top: 0, left: 380, right: 0, bottom: 0 }}>
        <HeatSafeMap
          routeData={routeData}
          activeRoute={activeRoute}
          heatCenter={heatCenter}
          focusPoint={singlePoint}
          onMapClick={handleMapClick}
          mode={mode}
        />

        {/* ── Search & select location bar (Google Maps style) ────── */}
        <div
          data-testid="location-search-bar"
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            width: 400,
            maxWidth: "calc(100% - 140px)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <LocationSearch
              theme={theme}
              dotColor="#22C55E"
              placeholder="Choose starting point…"
              selected={origin}
              onSelect={setOrigin}
              onClear={() => setOrigin(null)}
            />
            <LocationSearch
              theme={theme}
              dotColor="#EF4444"
              placeholder="Choose destination…"
              selected={destination}
              onSelect={setDestination}
              onClear={() => setDestination(null)}
            />
            <div
              style={{
                fontSize: 11,
                color: theme.hintText,
                textShadow: theme.hintShadow,
                padding: "0 2px",
              }}
            >
              {routesLoading ? (
                <span data-testid="routes-loading" style={{ color: theme.loadingColor }}>
                  ⟳ Finding real walking routes along roads…
                </span>
              ) : routesNotice ? (
                <span data-testid="routes-notice" style={{ color: theme.noticeColor }}>
                  ⚠ {routesNotice}
                </span>
              ) : (
                <>
                  Real walking paths via OpenStreetMap · search above or click the map
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              aria-label="Swap origin and destination"
              title="Swap origin and destination"
              onClick={swap}
              disabled={!origin && !destination}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: `1px solid ${theme.iconBtnBorder}`,
                background: theme.iconBtnBg,
                color: theme.text,
                cursor: origin || destination ? "pointer" : "default",
                fontSize: 15,
                lineHeight: 1,
                opacity: origin || destination ? 1 : 0.35,
              }}
            >
              ⇅
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
