import { font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";

/** Text roles shared by the SwiftUI screens. */
export const primaryText = foregroundStyle({ type: "hierarchical", style: "primary" });
export const secondaryText = foregroundStyle({ type: "hierarchical", style: "secondary" });
export const subheadline = font({ size: 15 });
export const footnote = font({ size: 13 });

export const layout = StyleSheet.create({
  fill: { flex: 1 },
});
