/**
 * Wizard color + type tokens.
 * Mirrors the dashboard's flame (primary) + mist (neutral) scales so reports
 * composed on mobile visually match the triage UI they land in.
 */
export const theme = {
  color: {
    bg: "#ffffff",
    surfaceSoft: "#f5f7f8",
    surface: "#edf0f1",
    border: "#dde2e5",
    borderStrong: "#c7cfd5",
    text: "#25343f",
    textMuted: "#6c7a87",
    textFaint: "#9aa4ae",
    primary: "#ff9b51",
    primaryPressed: "#f27a1f",
    primarySoft: "#fff2e6",
    primaryDisabled: "#ffdcbf",
    danger: "#b91c1c",
    dangerSoft: "#fef2f2",
    dangerBorder: "#fecaca",
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
  },
  hit: 44,
} as const

export type Theme = typeof theme
