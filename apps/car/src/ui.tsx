import { SymbolView, type SFSymbol } from "expo-symbols";
import { Children, isValidElement, type ReactNode } from "react";
import {
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ColorValue,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** System colors, so the app follows light and dark mode like a stock iOS app. */
export const colors = {
  background: PlatformColor("systemGroupedBackground"),
  cell: PlatformColor("secondarySystemGroupedBackground"),
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  tertiaryLabel: PlatformColor("tertiaryLabel"),
  separator: PlatformColor("separator"),
  tint: PlatformColor("systemBlue"),
  red: PlatformColor("systemRed"),
  green: PlatformColor("systemGreen"),
  orange: PlatformColor("systemOrange"),
  purple: PlatformColor("systemPurple"),
  gray: PlatformColor("systemGray"),
  fill: PlatformColor("tertiarySystemFill"),
} as const;

export function Screen(props: { readonly children: ReactNode }) {
  return <SafeAreaView style={styles.screen}>{props.children}</SafeAreaView>;
}

/** The navigation bar of a stock app: plain text buttons and an optional inline title. */
export function NavBar(props: {
  readonly title?: string;
  readonly left?: ReactNode;
  readonly right?: ReactNode;
}) {
  return (
    <View style={styles.navBar}>
      <View style={styles.navSide}>{props.left}</View>
      <Text numberOfLines={1} style={styles.navTitle}>
        {props.title ?? ""}
      </Text>
      <View style={[styles.navSide, styles.navSideRight]}>{props.right}</View>
    </View>
  );
}

export function NavButton(props: {
  readonly title: string;
  readonly onPress: () => void;
  readonly bold?: boolean;
  readonly back?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={12}
      onPress={props.onPress}
      style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
    >
      {props.back ? <SymbolView name="chevron.left" size={20} tintColor={colors.tint} /> : null}
      <Text style={[styles.navButtonText, props.bold && styles.bold]}>{props.title}</Text>
    </Pressable>
  );
}

export function LargeTitle(props: { readonly children: string }) {
  return <Text style={styles.largeTitle}>{props.children}</Text>;
}

/** An inset grouped section, as in the Settings app. */
export function Section(props: {
  readonly header?: string;
  readonly footer?: string | null;
  readonly children: ReactNode;
}) {
  const rows = Children.toArray(props.children);
  return (
    <View style={styles.section}>
      {props.header ? <Text style={styles.sectionHeader}>{props.header.toUpperCase()}</Text> : null}
      <View style={styles.group}>
        {rows.map((row, index) => (
          // Children.toArray gives every child a stable key.
          <View key={isValidElement(row) ? row.key : null}>
            {index > 0 ? <View style={styles.separator} /> : null}
            {row}
          </View>
        ))}
      </View>
      {props.footer ? <Text style={styles.sectionFooter}>{props.footer}</Text> : null}
    </View>
  );
}

export function Row(props: {
  readonly title: string;
  readonly subtitle?: string | null;
  /** Shown on the right in the secondary color. */
  readonly detail?: string | null;
  readonly onPress?: (() => void) | undefined;
  /** How the title reads: plain text, an action in the tint color, or a destructive action. */
  readonly kind?: "text" | "action" | "destructive";
  readonly disabled?: boolean;
  readonly chevron?: boolean;
  readonly checked?: boolean;
  readonly leading?: ReactNode;
  readonly titleLines?: number;
}) {
  const kind = props.kind ?? "text";
  const body = (
    <View style={[styles.row, props.disabled && styles.disabled]}>
      {props.leading}
      <View style={styles.rowText}>
        <Text
          numberOfLines={props.titleLines ?? 1}
          style={[
            styles.rowTitle,
            kind === "action" && { color: colors.tint },
            kind === "destructive" && { color: colors.red },
          ]}
        >
          {props.title}
        </Text>
        {props.subtitle ? <Text style={styles.rowSubtitle}>{props.subtitle}</Text> : null}
      </View>
      {props.detail ? <Text style={styles.rowDetail}>{props.detail}</Text> : null}
      {props.checked ? <SymbolView name="checkmark" size={17} tintColor={colors.tint} /> : null}
      {props.chevron ? (
        <SymbolView name="chevron.right" size={14} tintColor={colors.tertiaryLabel} />
      ) : null}
    </View>
  );
  if (!props.onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => pressed && styles.rowPressed}
    >
      {body}
    </Pressable>
  );
}

export function FieldRow(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.tertiaryLabel}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}

/** A filled button, used only for the one prominent action on a screen. */
export function Button(props: {
  readonly title: string;
  readonly onPress: () => void;
  readonly color?: ColorValue;
  readonly disabled?: boolean;
  readonly flex?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: props.color ?? colors.tint },
        props.flex && styles.flex,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={styles.buttonText}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function Symbol(props: {
  readonly name: SFSymbol;
  readonly size: number;
  readonly color: ColorValue;
}) {
  return <SymbolView name={props.name} size={props.size} tintColor={props.color} />;
}

export const text = StyleSheet.create({
  body: { color: colors.label, fontSize: 17, lineHeight: 22 },
  secondary: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },
  footnote: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  error: { color: colors.red, fontSize: 15, lineHeight: 20 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  pressed: { opacity: 0.4 },
  disabled: { opacity: 0.4 },
  navBar: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  navSide: { minWidth: 64, flexDirection: "row" },
  navSideRight: { justifyContent: "flex-end" },
  navTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
  },
  navButton: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 44 },
  navButtonText: { color: colors.tint, fontSize: 17 },
  largeTitle: {
    color: colors.label,
    fontSize: 34,
    fontWeight: "700",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  section: { marginTop: 22 },
  sectionHeader: {
    color: colors.secondaryLabel,
    fontSize: 13,
    paddingHorizontal: 36,
    paddingBottom: 7,
  },
  sectionFooter: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 36,
    paddingTop: 7,
  },
  group: {
    marginHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.cell,
    overflow: "hidden",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: colors.separator,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowPressed: { backgroundColor: colors.fill },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.label, fontSize: 17, lineHeight: 22 },
  rowSubtitle: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },
  rowDetail: { color: colors.secondaryLabel, fontSize: 17 },
  field: { minHeight: 44, paddingHorizontal: 16, color: colors.label, fontSize: 17 },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
});
