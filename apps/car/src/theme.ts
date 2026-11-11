import { StyleSheet } from "react-native";

export const colors = {
  background: "#000000",
  surface: "#16181d",
  surfaceRaised: "#23262e",
  border: "#2f333d",
  text: "#f4f5f7",
  textDim: "#9aa0ac",
  accent: "#5b8cff",
  listening: "#35c26b",
  working: "#f0a43a",
  speaking: "#a37bff",
  danger: "#f0554a",
  approve: "#2fb463",
  muted: "#4a4f5a",
} as const;

/** Shared type and control sizes: everything is large enough to hit without looking. */
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: "700" },
  headerButton: {
    minHeight: 52,
    minWidth: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  body: { color: colors.text, fontSize: 18, lineHeight: 26 },
  dim: { color: colors.textDim, fontSize: 16, lineHeight: 22 },
  bigButton: {
    minHeight: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  bigButtonText: { color: "#ffffff", fontSize: 24, fontWeight: "700" },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: 16,
  },
  pressed: { opacity: 0.6 },
});
