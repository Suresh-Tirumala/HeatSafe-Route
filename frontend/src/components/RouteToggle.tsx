import type { RouteProfile } from "../types/route";
import { ROUTE_COLORS, ROUTE_LABELS } from "../types/route";
import { themes } from "../theme";
import type { Theme } from "../theme";

interface RouteToggleProps {
  activeRoute: RouteProfile | null;
  onChange: (profile: RouteProfile | null) => void;
  theme?: Theme;
}

const profiles: RouteProfile[] = ["shortest", "coolest", "balanced"];

export default function RouteToggle({ activeRoute, onChange, theme = themes.dark }: RouteToggleProps) {
  return (
    <div
      data-testid="route-toggle"
      style={{
        display: "flex",
        gap: 0,
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${theme.toggleBorder}`,
      }}
    >
      <button
        data-testid="toggle-all"
        onClick={() => onChange(null)}
        style={{
          ...btnStyle,
          background: activeRoute === null ? theme.toggleActiveBg : "transparent",
          color: activeRoute === null ? theme.text : theme.textMuted,
          fontWeight: activeRoute === null ? 700 : 400,
        }}
      >
        All
      </button>
      {profiles.map((p) => (
        <button
          key={p}
          data-testid={`toggle-${p}`}
          onClick={() => onChange(p)}
          style={{
            ...btnStyle,
            background: activeRoute === p ? `${ROUTE_COLORS[p]}22` : "transparent",
            color: activeRoute === p ? ROUTE_COLORS[p] : theme.textMuted,
            fontWeight: activeRoute === p ? 700 : 400,
            borderLeft: `1px solid ${theme.divider}`,
          }}
        >
          <span
            data-testid={`dot-${p}`}
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: ROUTE_COLORS[p],
              marginRight: 6,
              opacity: activeRoute === p ? 1 : 0.4,
            }}
          />
          {ROUTE_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "all 0.15s ease",
  border: "none",
  outline: "none",
  whiteSpace: "nowrap",
};
