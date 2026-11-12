/**
 * Raised, glossy icon tiles and colourful gradient surfaces. The "3D" look is drawn, not a
 * picture: a gradient face, a darker lip under it, a soft shine on top and a coloured shadow.
 * So it is sharp at every size and costs no download.
 */
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { memo, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { tones, type Tone, type ToneName } from "../theme";

type IonName = keyof typeof Ionicons.glyphMap;
type McName = keyof typeof MaterialCommunityIcons.glyphMap;

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** Mixes a #rrggbb colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c: number) => clamp(c + (target - c) * k);
  return `#${[mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** A gradient made from one colour, for icons whose colour comes from data (alert kinds, statuses). */
export const toneOf = (color: string): Tone => ({ from: shade(color, 0.38), to: shade(color, -0.12), glow: color });
const resolve = (tone: ToneName | Tone | string): Tone => (typeof tone === "string" ? (tone in tones ? tones[tone as ToneName] : toneOf(tone)) : tone);

/** A raised icon tile. `tone` is a named colour group, a gradient, or any #rrggbb colour. */
export const Icon3D = memo(function Icon3D({ icon, mc, tone = "blue", box = 44, children }: { icon?: IonName; mc?: McName; tone?: ToneName | Tone | string; box?: number; children?: ReactNode }) {
  const t = resolve(tone);
  const r = Math.round(box * 0.3);
  const lip = Math.max(2, Math.round(box * 0.07));
  const glyph = Math.round(box * 0.52);
  return (
    <View style={{ width: box, height: box + lip }}>
      {/* The lip: the darker side of the tile, seen from slightly above. */}
      <View style={[styles.fill, { top: lip, borderRadius: r, backgroundColor: shade(t.to, -0.28), shadowColor: t.glow, shadowOpacity: 0.35, shadowRadius: box * 0.16, shadowOffset: { width: 0, height: box * 0.1 }, elevation: 4 }]} />
      <LinearGradient colors={[t.from, t.to]} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={[styles.face, { width: box, height: box, borderRadius: r }]}>
        {/* The shine across the top half. */}
        <LinearGradient colors={["rgba(255,255,255,0.42)", "rgba(255,255,255,0)"]} style={[styles.shine, { height: box * 0.5, borderTopLeftRadius: r, borderTopRightRadius: r }]} />
        {children ?? (mc ? <MaterialCommunityIcons name={mc} size={glyph + 1} color="#ffffff" style={styles.glyph} /> : <Ionicons name={icon ?? "ellipse"} size={glyph} color="#ffffff" style={styles.glyph} />)}
      </LinearGradient>
    </View>
  );
});

/** A colourful gradient surface with two soft circles for depth. For the status tiles and the hero. */
export function GradientCard({ tone, style, children }: { tone: ToneName | Tone | string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = resolve(tone);
  return (
    <View style={[styles.cardShadow, { shadowColor: t.glow }, style]}>
      <LinearGradient colors={[t.from, t.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View pointerEvents="none" style={[styles.bubble, styles.bubbleBig]} />
        <View pointerEvents="none" style={[styles.bubble, styles.bubbleSmall]} />
        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, right: 0, bottom: 0 },
  face: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  shine: { position: "absolute", left: 0, right: 0, top: 0 },
  glyph: { textShadowColor: "rgba(0,0,0,0.28)", textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 2.5 },
  cardShadow: { borderRadius: 18, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  card: { flex: 1, borderRadius: 18, overflow: "hidden" },
  bubble: { position: "absolute", backgroundColor: "rgba(255,255,255,0.14)" },
  bubbleBig: { width: 120, height: 120, borderRadius: 60, right: -34, top: -44 },
  bubbleSmall: { width: 70, height: 70, borderRadius: 35, right: 36, bottom: -40 }
});
