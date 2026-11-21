// Small building blocks used by every screen.
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { font, LOGO, space, useTheme } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Screen({ children, scroll = true, edges = ["top"], padded = true }: { children: ReactNode; scroll?: boolean; edges?: Edge[]; padded?: boolean }) {
  const t = useTheme();
  const inner = padded ? { padding: space.lg, gap: space.md } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, { paddingBottom: 48 }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function LogoMark({ size = 24 }: { size?: number }) {
  const s = size / 128;
  const sq = (x: number, y: number, color: string) => <View style={{ position: "absolute", left: x * s, top: y * s, width: 58 * s, height: 58 * s, backgroundColor: color }} />;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, backgroundColor: LOGO.frame }}>
      {sq(4, 4, LOGO.yellow)}
      {sq(66, 4, LOGO.cyan)}
      {sq(4, 66, LOGO.red)}
      {sq(66, 66, LOGO.green)}
    </View>
  );
}

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
      <Text accessibilityRole="header" style={{ fontSize: font.title, fontWeight: "900", color: t.fg, letterSpacing: -0.5, flexShrink: 1 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm }}>
      <Text accessibilityRole="header" style={{ fontSize: font.small, fontWeight: "900", color: t.mutedFg, textTransform: "uppercase", letterSpacing: 1 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function P({ children, muted, style, numberOfLines, selectable }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const t = useTheme();
  return (
    <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ fontSize: font.body, color: muted ? t.mutedFg : t.fg, lineHeight: 21 }, style]}>
      {children}
    </Text>
  );
}

/** A bordered box with ProdLi's hard offset shadow. */
export function Card({ children, style, onPress, accessibilityLabel, color }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; color?: string }) {
  const t = useTheme();
  const box = [{ backgroundColor: color ?? t.card, borderColor: t.border, borderWidth: 2, padding: space.md, gap: space.sm }, style];
  const body = onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [box, pressed && { transform: [{ translateX: 2 }, { translateY: 2 }] }]}>
      {children}
    </Pressable>
  ) : (
    <View style={box}>{children}</View>
  );
  return (
    <View style={{ marginRight: 4, marginBottom: 4 }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? "#000" : t.shadow, transform: [{ translateX: 4 }, { translateY: 4 }] }]} />
      {body}
    </View>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ask";

export function Button({ title, onPress, variant = "primary", icon, busy, disabled, small, style, accessibilityLabel }: { title: string; onPress: () => void; variant?: Variant; icon?: IconName; busy?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const t = useTheme();
  const bg = { primary: t.primary, secondary: t.secondary, ghost: "transparent", danger: t.danger, ask: t.ask }[variant];
  const fg = variant === "ghost" ? t.fg : variant === "danger" ? "#fff" : "#000";
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: bg, borderWidth: 2, borderColor: variant === "ghost" ? t.border : "#000", paddingVertical: small ? 6 : 11, paddingHorizontal: small ? 10 : 16, minHeight: small ? 34 : 46, opacity: off ? 0.55 : 1 },
        pressed && !off && { transform: [{ translateX: 1 }, { translateY: 1 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: "900", fontSize: small ? font.small : font.body }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color, size = 22 }: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}>
      <Ionicons name={icon} size={size} color={color ?? t.fg} />
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={{ color: t.mutedFg, fontWeight: "800", fontSize: font.small }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={t.mutedFg}
        accessibilityLabel={label ?? props.placeholder}
        {...rest}
        style={[{ borderWidth: 2, borderColor: t.border, backgroundColor: t.dark ? t.muted : "#FFFDF8", color: t.fg, paddingHorizontal: 12, paddingVertical: 10, fontSize: font.body, minHeight: 46 }, style]}
      />
    </View>
  );
}

export function Checkbox({ checked, onPress, label, color }: { checked: boolean; onPress: () => void; label: string; color?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} hitSlop={8} style={{ width: 26, height: 26, borderWidth: 2, borderColor: t.border, backgroundColor: checked ? (color ?? t.primary) : "transparent", alignItems: "center", justifyContent: "center" }}>
      {checked ? <Ionicons name="checkmark" size={18} color="#000" /> : null}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, onLongPress, color }: { label: string; active?: boolean; onPress?: () => void; onLongPress?: () => void; color?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress} accessibilityRole={onPress ? "button" : "text"} accessibilityState={{ selected: !!active }} style={{ borderWidth: 2, borderColor: t.border, backgroundColor: active ? (color ?? t.primary) : "transparent", paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontWeight: "800", fontSize: font.small, color: active ? "#000" : t.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Empty({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 36, gap: 8 }}>
      <Ionicons name={icon} size={36} color={t.mutedFg} />
      <Text style={{ fontWeight: "900", color: t.fg, fontSize: font.h2 }}>{title}</Text>
      {hint ? <Text style={{ color: t.mutedFg, textAlign: "center", maxWidth: 300, lineHeight: 20 }}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ text, tone = "info", action }: { text: string; tone?: "info" | "error" | "ok"; action?: ReactNode }) {
  const t = useTheme();
  const bg = tone === "error" ? (t.dark ? "#4A1F1F" : "#FFD6D6") : tone === "ok" ? (t.dark ? "#1F3A22" : "#D9F2DA") : t.muted;
  return (
    <View accessibilityRole="alert" style={{ borderWidth: 2, borderColor: t.border, backgroundColor: bg, padding: space.md, gap: space.sm }}>
      <Text style={{ color: t.fg, fontSize: font.small, lineHeight: 19 }}>{text}</Text>
      {action}
    </View>
  );
}

export function ListRow({ title, subtitle, icon, onPress, right, danger }: { title: string; subtitle?: string; icon?: IconName; onPress?: () => void; right?: ReactNode; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: t.dark ? "#333842" : "#00000022", backgroundColor: pressed ? t.muted : "transparent" })}>
      {icon ? <Ionicons name={icon} size={20} color={danger ? t.danger : t.fg} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: danger ? t.danger : t.fg, fontWeight: "800", fontSize: font.body }} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: t.mutedFg, fontSize: font.small }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={t.mutedFg} /> : null)}
    </Pressable>
  );
}
