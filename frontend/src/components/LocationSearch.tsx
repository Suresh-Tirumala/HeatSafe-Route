/**
 * LocationSearch — Google Maps-style place search box.
 *
 * Debounced autocomplete against Nominatim with keyboard navigation
 * (↑ / ↓ / Enter / Esc), loading + empty states, clear button.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { searchPlaces, type PlaceResult } from "../utils/geocoding";
import { themes } from "../theme";
import type { Theme } from "../theme";

interface LocationSearchProps {
  /** Small coloured dot beside the input (origin green / destination red). */
  dotColor: string;
  placeholder: string;
  /** Currently selected place (shown in the input). */
  selected: PlaceResult | null;
  onSelect: (place: PlaceResult) => void;
  onClear: () => void;
  theme?: Theme;
}

const DEBOUNCE_MS = 300;

export default function LocationSearch({
  dotColor,
  placeholder,
  selected,
  onSelect,
  onClear,
  theme = themes.dark,
}: LocationSearchProps) {
  const [text, setText] = useState(selected?.label ?? "");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes "user typed" from "selection updated externally" (map click).
  const skipNextSyncRef = useRef(false);

  // Sync external selection (e.g. map-click pick) into the input text.
  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    setText(selected?.label ?? "");
    setResults([]);
    setOpen(false);
  }, [selected]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Inject spinner keyframes once.
  useEffect(() => {
    if (!document.getElementById("location-search-css")) {
      const style = document.createElement("style");
      style.id = "location-search-css";
      style.textContent = `
        @keyframes search-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Cleanup in-flight work on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback(async (query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const found = await searchPlaces(query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(found);
      setHighlight(0);
      setOpen(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Search unavailable — check your connection");
      setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      abortRef.current?.abort();
      if (selected) onClear();
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  };

  const choose = (place: PlaceResult) => {
    skipNextSyncRef.current = true; // our own selection; don't clobber typed text
    setText(place.label);
    setOpen(false);
    setResults([]);
    onSelect(place);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (h + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h - 1 + results.length) % results.length);
        break;
      case "Enter":
        e.preventDefault();
        choose(results[highlight]);
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1 }} data-testid="location-search">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: theme.inputBg,
          border: `1px solid ${open ? theme.inputFocusBorder : theme.inputBorder}`,
          borderRadius: 8,
          padding: "0 10px",
          height: 40,
          transition: "border-color 0.15s",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
            flexShrink: 0,
          }}
        />
        <input
          data-testid="location-search-input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: theme.text,
            fontSize: 13,
            fontFamily: "'Inter', system-ui, sans-serif",
            minWidth: 0,
          }}
        />
        {loading && (
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              border: `2px solid ${theme.inputBorder}`,
              borderTopColor: "#3B82F6",
              borderRadius: "50%",
              animation: "search-spin 0.7s linear infinite",
              flexShrink: 0,
            }}
          />
        )}
        {!loading && text && (
          <button
            type="button"
            aria-label="Clear location"
            onClick={() => handleChange("")}
            style={clearBtnStyle(theme)}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          data-testid="location-search-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: theme.dropdownBg,
            border: `1px solid ${theme.dropdownBorder}`,
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: theme.dropdownShadow,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {error ? (
            <div style={{ padding: "10px 12px", fontSize: 12, color: theme.errorColor }}>{error}</div>
          ) : results.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.5 }}>
              No matching places
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={`${r.id}-${i}`}
                data-testid="location-search-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: i === highlight ? theme.optionHover : "transparent",
                  borderTop: i === 0 ? "none" : `1px solid ${theme.optionDivider}`,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.label}
                </div>
                {r.sublabel && (
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.5,
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.sublabel}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const clearBtnStyle = (theme: Theme): React.CSSProperties => ({
  background: "transparent",
  border: "none",
  color: theme.textMuted,
  cursor: "pointer",
  fontSize: 13,
  padding: "2px 4px",
  lineHeight: 1,
  flexShrink: 0,
});
