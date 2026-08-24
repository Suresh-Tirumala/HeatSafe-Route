export type ThemeMode = "light" | "dark";

export interface Theme {
  mode: ThemeMode;
  pageBg: string;
  panelBg: string;
  panelBorder: string;
  text: string;
  textMuted: string;
  hintText: string;
  hintShadow: string;
  loadingColor: string;
  noticeColor: string;
  inputBg: string;
  inputBorder: string;
  inputFocusBorder: string;
  dropdownBg: string;
  dropdownBorder: string;
  dropdownShadow: string;
  optionHover: string;
  optionDivider: string;
  errorColor: string;
  cardBg: string;
  cardBorder: string;
  divider: string;
  sectionDivider: string;
  toggleBorder: string;
  toggleActiveBg: string;
  iconBtnBg: string;
  iconBtnBorder: string;
  goodColor: string;
  badColor: string;
}

export const themes: Record<ThemeMode, Theme> = {
  dark: {
    mode: "dark",
    pageBg: "#0A0A0E",
    panelBg: "rgba(10, 10, 14, 0.92)",
    panelBorder: "rgba(255,255,255,0.06)",
    text: "#FFFFFF",
    textMuted: "rgba(255,255,255,0.5)",
    hintText: "rgba(255,255,255,0.55)",
    hintShadow: "0 1px 3px rgba(0,0,0,0.8)",
    loadingColor: "#93C5FD",
    noticeColor: "#FBBF24",
    inputBg: "rgba(255,255,255,0.06)",
    inputBorder: "rgba(255,255,255,0.12)",
    inputFocusBorder: "rgba(59,130,246,0.6)",
    dropdownBg: "rgba(12,12,18,0.97)",
    dropdownBorder: "rgba(255,255,255,0.1)",
    dropdownShadow: "0 12px 32px rgba(0,0,0,0.55)",
    optionHover: "rgba(59,130,246,0.15)",
    optionDivider: "rgba(255,255,255,0.05)",
    errorColor: "#F87171",
    cardBg: "rgba(255,255,255,0.03)",
    cardBorder: "rgba(255,255,255,0.06)",
    divider: "rgba(255,255,255,0.04)",
    sectionDivider: "rgba(255,255,255,0.06)",
    toggleBorder: "rgba(255,255,255,0.12)",
    toggleActiveBg: "rgba(255,255,255,0.15)",
    iconBtnBg: "rgba(12,12,18,0.92)",
    iconBtnBorder: "rgba(255,255,255,0.15)",
    goodColor: "#22C55E",
    badColor: "#EF4444",
  },
  light: {
    mode: "light",
    pageBg: "#E8ECF1",
    panelBg: "rgba(250,250,252,0.94)",
    panelBorder: "rgba(15,23,42,0.10)",
    text: "#111827",
    textMuted: "rgba(15,23,42,0.55)",
    hintText: "rgba(15,23,42,0.65)",
    hintShadow: "none",
    loadingColor: "#2563EB",
    noticeColor: "#B45309",
    inputBg: "rgba(255,255,255,0.85)",
    inputBorder: "rgba(15,23,42,0.16)",
    inputFocusBorder: "rgba(37,99,235,0.7)",
    dropdownBg: "rgba(255,255,255,0.99)",
    dropdownBorder: "rgba(15,23,42,0.12)",
    dropdownShadow: "0 12px 32px rgba(15,23,42,0.22)",
    optionHover: "rgba(59,130,246,0.12)",
    optionDivider: "rgba(15,23,42,0.06)",
    errorColor: "#DC2626",
    cardBg: "rgba(15,23,42,0.03)",
    cardBorder: "rgba(15,23,42,0.10)",
    divider: "rgba(15,23,42,0.07)",
    sectionDivider: "rgba(15,23,42,0.10)",
    toggleBorder: "rgba(15,23,42,0.14)",
    toggleActiveBg: "rgba(15,23,42,0.08)",
    iconBtnBg: "rgba(255,255,255,0.95)",
    iconBtnBorder: "rgba(15,23,42,0.16)",
    goodColor: "#16A34A",
    badColor: "#DC2626",
  },
};

const STORAGE_KEY = "heatsafe-theme-mode";

export function getInitialThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage unavailable
  }
  return "dark";
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore persistence failures
  }
}
