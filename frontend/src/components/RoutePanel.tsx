import { useState } from "react";
import { ThermometerSun } from "lucide-react";
import type { RouteCollection, RouteProfile } from "../types/route";
import { ROUTE_COLORS, ROUTE_LABELS } from "../types/route";
import {
  formatDistance,
  formatDuration,
  getRoute,
  pctDiff,
} from "../utils/map";
import RouteToggle from "./RouteToggle";
import { themes } from "../theme";
import type { Theme, ThemeMode } from "../theme";

interface RoutePanelProps {
  routeData: RouteCollection | null;
  activeRoute: RouteProfile | null;
  onRouteChange: (profile: RouteProfile | null) => void;
  theme?: Theme;
  /** Signed-in user's email — shown in Settings. */
  userEmail?: string | null;
  /** Signed-in user's display name — falls back to a derivation from the email. */
  userName?: string | null;
  /** Current theme mode — drives the dark-mode switch in Settings. */
  mode?: ThemeMode;
  /** Toggle between light/dark mode. */
  onToggleTheme?: () => void;
  /** Sign out of the current session. */
  onSignOut?: () => void;
  /** Navigate back to the landing (hero) page when the logo is clicked. */
  onLogoClick?: () => void;
}

export default function RoutePanel({
  routeData,
  activeRoute,
  onRouteChange,
  theme = themes.dark,
  userEmail = null,
  userName = null,
  mode = "dark",
  onToggleTheme,
  onSignOut,
  onLogoClick,
}: RoutePanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const displayName =
    userName ??
    (userEmail
      ? userEmail.split("@")[0].replace(/[._-]+/g, " ")
      : "Guest Walker");
  const initial = displayName.charAt(0).toUpperCase();
  const isDark = mode === "dark";

  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);

  const settingsHeader = (
    <div
      style={{
        ...headerStyle(theme),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <button
        type="button"
        data-testid="sidebar-logo"
        aria-label="HeatSafe Route — back to home"
        title="Back to home"
        onClick={onLogoClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          textAlign: "left",
          color: "inherit",
          cursor: onLogoClick ? "pointer" : "default",
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #F97316, #EF4444)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(249,115,22,0.35)",
          }}
        >
          <ThermometerSun size={17} color="#FFFFFF" strokeWidth={2.4} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
            }}
          >
            HeatSafe Route
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              opacity: 0.45,
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Heat-aware pedestrian navigation
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid="settings-btn"
        aria-label="Open settings"
        title="Settings"
        onClick={openSettings}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: `1px solid ${theme.iconBtnBorder}`,
          background: theme.iconBtnBg,
          cursor: "pointer",
          fontSize: 15,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ⚙️
      </button>
    </div>
  );

  const settingsDrawer = settingsOpen ? (
    <div
      data-testid="settings-drawer"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: theme.panelBg,
        backdropFilter: "blur(20px)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          padding: "16px 16px 14px",
          borderBottom: `1px solid ${theme.sectionDivider}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          data-testid="settings-back-btn"
          aria-label="Close settings"
          onClick={closeSettings}
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: `1px solid ${theme.iconBtnBorder}`,
            background: theme.iconBtnBg,
            color: theme.text,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Settings</div>
      </div>

      {/* Account section */}
      <div style={{ padding: "16px 16px 0" }}>
        <SectionLabel theme={theme}>Account</SectionLabel>
        <div
          data-testid="user-details-card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 10,
            background: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #F97316, #EF4444)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                fontSize: 12,
                opacity: 0.55,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {userEmail ?? "Not signed in"}
            </div>
            <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>
              HeatSafe member · Free plan
            </div>
          </div>
        </div>
      </div>

      {/* Appearance section */}
      <div style={{ padding: "16px 16px 0" }}>
        <SectionLabel theme={theme}>Appearance</SectionLabel>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px",
            borderRadius: 10,
            background: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Dark mode</div>
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
              Easier on the eyes at night
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            data-testid="dark-mode-toggle"
            aria-label="Toggle dark mode"
            onClick={onToggleTheme}
            disabled={!onToggleTheme}
            style={{
              width: 46,
              height: 26,
              borderRadius: 999,
              border: "none",
              background: isDark ? "#F97316" : "rgba(120,120,128,0.32)",
              position: "relative",
              cursor: onToggleTheme ? "pointer" : "default",
              transition: "background 0.2s ease",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: isDark ? 23 : 3,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#FFFFFF",
                boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                transition: "left 0.2s ease",
                display: "block",
              }}
            />
          </button>
        </div>
      </div>

      {/* Session */}
      <div style={{ padding: "16px 16px 0" }}>
        <SectionLabel theme={theme}>Session</SectionLabel>
        <button
          type="button"
          data-testid="signout-btn"
          onClick={() => {
            closeSettings();
            onSignOut?.();
          }}
          style={{
            width: "100%",
            padding: "11px 12px",
            borderRadius: 10,
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
            color: theme.badColor,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          Sign out
        </button>
      </div>

      <div
        style={{
          marginTop: "auto",
          padding: 16,
          fontSize: 10,
          opacity: 0.35,
          textAlign: "center",
        }}
      >
        HeatSafe Route v0.1.0
      </div>
    </div>
  ) : null;

  if (!routeData) {
    return (
      <div data-testid="route-panel" style={panelStyle(theme)}>
        {settingsHeader}
        <div style={emptyStyle}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>No route loaded</div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
            Set origin and destination to generate routes
          </div>
        </div>
        {settingsDrawer}
      </div>
    );
  }

  const { properties } = routeData;
  const profiles: RouteProfile[] = ["shortest", "coolest", "balanced"];

  return (
    <div data-testid="route-panel" style={panelStyle(theme)}>
      {/* ── Header ────────────────────────────────────────────── */}
      {settingsHeader}

      {/* ── Toggle ────────────────────────────────────────────── */}
      <div style={{ padding: "0 16px 12px" }}>
        <RouteToggle activeRoute={activeRoute} onChange={onRouteChange} theme={theme} />
      </div>

      {/* ── Route Cards ───────────────────────────────────────── */}
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {profiles.map((profile) => {
          const feat = getRoute(routeData, profile);
          if (!feat) return null;
          const { properties: rp } = feat;
          const isActive = activeRoute === profile || activeRoute === null;

          return (
            <div
              key={profile}
              data-testid={`route-card-${profile}`}
              onClick={() => onRouteChange(profile)}
              style={{
                ...cardStyle(theme),
                borderColor:
                  activeRoute === profile
                    ? ROUTE_COLORS[profile]
                    : theme.cardBorder,
                opacity: isActive ? 1 : 0.4,
                cursor: "pointer",
              }}
            >
              {/* Colour bar */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: ROUTE_COLORS[profile],
                  borderRadius: "3px 0 0 3px",
                }}
              />

              {/* Profile label */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: ROUTE_COLORS[profile] }}>
                  {ROUTE_LABELS[profile]}
                </span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>
                  {formatDuration(rp.total_duration_s)}
                </span>
              </div>

              {/* Stats grid */}
              <div style={statsGrid}>
                <StatBlock label="Distance" value={formatDistance(rp.total_distance_m)} theme={theme} />
                <StatBlock label="Shaded" value={`${rp.avg_shade_pct.toFixed(0)}%`} highlight={rp.avg_shade_pct > 40} theme={theme} />
                <StatBlock
                  label="Thermal Safety"
                  value={rp.heat_exposure_score.toFixed(0)}
                  subtitle="score"
                  highlight={rp.heat_exposure_score < 300}
                  theme={theme}
                />
                <StatBlock
                  label="Heat Exposure"
                  value={formatDuration(rp.heat_exposure_duration_s)}
                  theme={theme}
                />
              </div>

              {/* Delta vs shortest */}
              {profile !== "shortest" && (
                <div style={deltaStyle(theme)}>
                  <DeltaPct
                    label="vs shortest"
                    base={properties.distance_comparison.shortest_m}
                    value={rp.total_distance_m}
                    invert={false}
                    theme={theme}
                  />
                  <DeltaPct
                    label="shade"
                    base={properties.shade_comparison.shortest_avg_shade_pct}
                    value={rp.avg_shade_pct}
                    invert
                    theme={theme}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Summary Table ─────────────────────────────────────── */}
      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Comparison
        </div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}></th>
              <th style={{ ...thStyle, color: ROUTE_COLORS.shortest }}>Short</th>
              <th style={{ ...thStyle, color: ROUTE_COLORS.coolest }}>Cool</th>
              <th style={{ ...thStyle, color: ROUTE_COLORS.balanced }}>Bal.</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdLabel}>Dist</td>
              <td style={tdVal}>{formatDistance(properties.distance_comparison.shortest_m)}</td>
              <td style={tdVal}>{formatDistance(properties.distance_comparison.coolest_m)}</td>
              <td style={tdVal}>{formatDistance(properties.distance_comparison.balanced_m)}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Shade</td>
              <td style={tdVal}>{properties.shade_comparison.shortest_avg_shade_pct.toFixed(0)}%</td>
              <td style={tdVal}>{properties.shade_comparison.coolest_avg_shade_pct.toFixed(0)}%</td>
              <td style={tdVal}>{properties.shade_comparison.balanced_avg_shade_pct.toFixed(0)}%</td>
            </tr>
            <tr>
              <td style={tdLabel}>Heat</td>
              <td style={tdVal}>{properties.heat_exposure_comparison.shortest_score.toFixed(0)}</td>
              <td style={tdVal}>{properties.heat_exposure_comparison.coolest_score.toFixed(0)}</td>
              <td style={tdVal}>{properties.heat_exposure_comparison.balanced_score.toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Navigation Steps (active route) ───────────────────── */}
      {activeRoute && (() => {
        const feat = getRoute(routeData, activeRoute);
        if (!feat) return null;
        return (
          <div style={{ padding: "16px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Directions
            </div>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {feat.properties.navigation_steps.map((step, i) => (
                <li
                  key={i}
                  data-testid={`nav-step-${i}`}
                  style={{
                    padding: "6px 0",
                    borderBottom: `1px solid ${theme.divider}`,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: ROUTE_COLORS[activeRoute], fontWeight: 700, marginRight: 6 }}>
                    {i + 1}.
                  </span>
                  {step.instruction}
                </li>
              ))}
            </ol>
          </div>
        );
      })()}

      {settingsDrawer}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function SectionLabel({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        opacity: 0.4,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function StatBlock({
  label,
  value,
  subtitle,
  highlight,
  theme,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
  theme: Theme;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: highlight ? theme.goodColor : theme.text }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 9, opacity: 0.35, marginTop: -2 }}>{subtitle}</div>
      )}
    </div>
  );
}

function DeltaPct({
  label,
  base,
  value,
  invert,
  theme,
}: {
  label: string;
  base: number;
  value: number;
  invert: boolean;
  theme: Theme;
}) {
  const diff = pctDiff(base, value);
  const isGood = invert ? diff < 0 : diff > 0;
  if (Math.abs(diff) < 0.5) return null;
  return (
    <span style={{ fontSize: 11, marginRight: 10 }}>
      <span style={{ opacity: 0.4 }}>{label} </span>
      <span style={{ color: isGood ? theme.goodColor : theme.badColor, fontWeight: 600 }}>
        {diff > 0 ? "+" : ""}
        {diff.toFixed(0)}%
      </span>
    </span>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const panelStyle = (theme: Theme): React.CSSProperties => ({
  position: "absolute",
  top: 0,
  left: 0,
  bottom: 0,
  width: 380,
  background: theme.panelBg,
  backdropFilter: "blur(20px)",
  borderRight: `1px solid ${theme.panelBorder}`,
  overflowY: "auto",
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  fontFamily: "'Inter', system-ui, sans-serif",
  color: theme.text,
});

const headerStyle = (theme: Theme): React.CSSProperties => ({
  padding: "20px 16px 16px",
  borderBottom: `1px solid ${theme.sectionDivider}`,
});

const cardStyle = (theme: Theme): React.CSSProperties => ({
  position: "relative",
  padding: "12px 12px 10px 16px",
  borderRadius: 8,
  background: theme.cardBg,
  border: `1px solid ${theme.cardBorder}`,
  transition: "border-color 0.15s, opacity 0.15s",
});

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "6px 16px",
};

const deltaStyle = (theme: Theme): React.CSSProperties => ({
  marginTop: 8,
  paddingTop: 6,
  borderTop: `1px solid ${theme.divider}`,
});

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "right",
  fontWeight: 600,
  padding: "4px 6px",
  fontSize: 11,
};

const tdLabel: React.CSSProperties = {
  padding: "4px 6px",
  opacity: 0.45,
  fontSize: 11,
};

const tdVal: React.CSSProperties = {
  textAlign: "right",
  padding: "4px 6px",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const emptyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  opacity: 0.6,
  textAlign: "center" as const,
};
