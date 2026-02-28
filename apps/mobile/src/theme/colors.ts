/**
 * Design system — intelli-claw mobile (Dark Mode)
 * Primary: #FF6B35 (Orange) — matching web globals.css
 * Background: #0a0a0a — pure dark
 */

export const colors = {
  primary: "#FF6B35",
  primaryLight: "#FF8A5C",
  primaryDark: "#E55A2B",
  primaryFaint: "rgba(255, 107, 53, 0.06)",
  primaryMuted: "rgba(255, 107, 53, 0.12)",
  primaryGlow: "rgba(255, 107, 53, 0.18)",

  bg: "#0a0a0a",
  bgSecondary: "#141414",
  bgTertiary: "#1a1a1a",
  bgDark: "#000000",
  bgElevated: "#1a1a1a",

  text: "#fafafa",
  textSecondary: "#A0A0A0",
  textTertiary: "#666666",
  textMuted: "#444444",
  textWhite: "#FFFFFF",

  border: "#222222",
  borderLight: "#2a2a2a",
  borderSubtle: "rgba(255, 255, 255, 0.06)",

  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#3B82F6",

  accent: "#FF6B35",
  userBubble: "#FF6B35",
  userBubbleText: "#0a0a0a",

  overlay: "rgba(0, 0, 0, 0.6)",
  overlayLight: "rgba(255, 255, 255, 0.04)",
  shadow: "#000000",
} as const;

export const shadows = {
  sm: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 1 },
  md: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 3 },
  lg: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 6 },
  input: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 2 },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, full: 9999 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.5, lineHeight: 32 },
  headline: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.2, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: "400" as const, letterSpacing: 0.1, lineHeight: 22 },
  caption: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.2, lineHeight: 16 },
  tiny: { fontSize: 11, fontWeight: "500" as const, letterSpacing: 0.3, lineHeight: 14 },
} as const;
