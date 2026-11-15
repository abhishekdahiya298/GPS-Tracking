import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { StatusPill, VehiclePicture, type IconName } from "@/components/kit";
import { PressableScale } from "@/components/motion";
import { STATE_META, compassPoint, displayName, fleetState, sheetFacts, type FleetDevice, type FleetState } from "@/fleet/model";
import { colors, ink, isDark, radius, softTint, space, themed } from "@/theme";

/** One cell of the fact strip: icon and value on one line, the label centred under them. */
export type FactCell = { icon: IconName; value: string; label: string; color: string };

/**
 * The four facts shown for a vehicle, the same on the map card and on its details screen:
 * speed, heading, ignition and GPS while it reports; ignition, motion, GPS age and tracker when silent.
 */
export function factCellsFor(d: FleetDevice, now: number, fmtSpeed: (kph: number | null) => string): FactCell[] {
  const state = fleetState(d);
  const facts = sheetFacts(d, now);
  const loc = d.location;
  const ignition: FactCell = { icon: "key-outline", value: facts.ignition, label: "Ignition", color: facts.ignition === "Off" ? STATE_META.stopped.color : STATE_META.moving.color };
  if (state === "offline" || state === "parked" || state === "never_seen") {
    return [
      ignition,
      { icon: "pulse-outline", value: facts.motion, label: "Motion", color: colors.primary },
      { icon: "locate-outline", value: facts.gps.value.replace(" old", ""), label: "GPS age", color: STATE_META.idle.color },
      { icon: "wifi-outline", value: facts.tracker.online ? "On" : "Off", label: "Tracker", color: facts.tracker.online ? STATE_META.moving.color : STATE_META.offline.color }
    ];
  }
  const text = fmtSpeed(state === "moving" ? (loc?.speedKph ?? null) : 0);
  const cut = text.lastIndexOf(" ");
  const heading = loc?.headingDeg ?? null;
  return [
    { icon: "speedometer-outline", value: cut < 0 ? text : text.slice(0, cut), label: cut < 0 ? "Speed" : text.slice(cut + 1), color: STATE_META[state].color },
    { icon: "navigate-outline", value: compassPoint(heading) ?? "—", label: heading != null ? `${Math.round(((heading % 360) + 360) % 360)}°` : "Heading", color: colors.primary },
    ignition,
    { icon: "locate-outline", value: facts.gps.fresh ? "Live" : facts.gps.value.replace(" old", ""), label: "GPS", color: facts.gps.fresh ? STATE_META.parked.color : STATE_META.idle.color }
  ];
}

/**
 * The selected vehicle on the live map, as in the design (M5/M6): one compact card with the
 * previous and next vehicles peeking at its sides. Tap a side card (or swipe) to move.
 */
export function VehicleCarousel({
  device,
  state,
  sub,
  index,
  prev,
  next,
  facts,
  silent,
  address,
  addressLabel,
  onStep,
  onClose
}: {
  device: FleetDevice;
  state: FleetState;
  sub: string;
  index: string | null;
  prev?: FleetDevice;
  next?: FleetDevice;
  facts: FactCell[];
  silent?: { title: string; note: string } | null;
  address: string;
  addressLabel?: string;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const meta = STATE_META[state];
  return (
    <View style={styles.row}>
      {prev ? <SidePeek side="left" device={prev} onPress={() => onStep(-1)} /> : <View style={styles.gap} />}
      <View style={styles.card}>
        <View style={[styles.edge, { backgroundColor: meta.color }]} />
        <View style={styles.head}>
          <VehiclePicture type={device.vehicle?.type} width={52} height={38} />
          <View style={styles.title}>
            <Text style={styles.name} numberOfLines={1}>{displayName(device)}</Text>
            <View style={styles.subLine}>
              <StatusPill state={state} compact />
              <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
            </View>
          </View>
          <View style={styles.headEnd}>
            {index ? <Text style={styles.index}>{index}</Text> : null}
            <PressableScale onPress={onClose} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel="Back to all vehicles">
              <Ionicons name="close" size={17} color={colors.mutedForeground} />
            </PressableScale>
          </View>
        </View>
        {silent ? (
          <View style={[styles.silent, { backgroundColor: softTint(STATE_META.idle.color, STATE_META.idle.soft) }]}>
            <Ionicons name="cloud-offline-outline" size={17} color={ink(STATE_META.idle.color)} />
            <View style={styles.flex}>
              <Text style={styles.silentTitle} numberOfLines={1}>{silent.title}</Text>
              <Text style={styles.silentNote} numberOfLines={1}>{silent.note}</Text>
            </View>
          </View>
        ) : null}
        <FactStrip cells={facts} />
        <View style={styles.addr}>
          <Ionicons name="location-outline" size={15} color={colors.primary} />
          {addressLabel ? <Text style={styles.addrLabel}>{addressLabel}</Text> : null}
          <Text style={styles.addrText} numberOfLines={2}>{address}</Text>
        </View>
      </View>
      {next ? <SidePeek side="right" device={next} onPress={() => onStep(1)} /> : <View style={styles.gap} />}
    </View>
  );
}

/** Four equal cells in one strip. */
export function FactStrip({ cells }: { cells: FactCell[] }) {
  return (
    <View style={styles.strip}>
      {cells.map((c, i) => (
        <View key={c.label} style={[styles.cell, i < cells.length - 1 && styles.cellLine]} accessible accessibilityLabel={`${c.label}: ${c.value}`}>
          <View style={styles.cellTop}>
            <Ionicons name={c.icon} size={14} color={ink(c.color)} />
            <Text style={[styles.cellValue, { color: ink(c.color) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{c.value}</Text>
          </View>
          <Text style={styles.cellLabel} numberOfLines={1}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The previous or next vehicle, as a narrow card at the side: its name runs up the card. */
function SidePeek({ side, device, onPress }: { side: "left" | "right"; device: FleetDevice; onPress: () => void }) {
  const st = STATE_META[fleetState(device)];
  const name = displayName(device);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.peek, side === "left" ? styles.peekLeft : styles.peekRight, side === "left" ? { borderRightColor: st.color } : { borderLeftColor: st.color }]}
      accessibilityRole="button"
      accessibilityLabel={`${side === "left" ? "Previous" : "Next"} vehicle: ${name}`}
    >
      <Ionicons name={side === "left" ? "chevron-back" : "chevron-forward"} size={16} color={colors.primary} />
      <View style={styles.peekNameBox}>
        <Text style={[styles.peekName, { transform: [{ rotate: side === "left" ? "-90deg" : "90deg" }] }]} numberOfLines={1}>{name}</Text>
      </View>
      <View style={[styles.peekDot, { backgroundColor: st.color }]} />
    </Pressable>
  );
}

/** One solid main action, then the others together in one light tray. */
export type BarAction = { icon: IconName; label: string; onPress: () => void };
export function ActionBar({ main, items, inset = false }: { main: BarAction & { selected?: boolean; disabled?: boolean }; items: BarAction[]; inset?: boolean }) {
  const off = main.disabled === true;
  return (
    <View style={[styles.actions, inset && styles.actionsInset]}>
      <Pressable onPress={main.onPress} disabled={off} style={[styles.follow, main.selected && styles.followOn, off && styles.followOff]} accessibilityRole="button" accessibilityState={{ selected: main.selected === true, disabled: off }}>
        <Ionicons name={main.icon} size={16} color={off ? colors.mutedForeground : colors.primaryForeground} />
        <Text style={[styles.followText, off && { color: colors.mutedForeground }]}>{main.label}</Text>
      </Pressable>
      <View style={styles.tray}>
        {items.map((it) => (
          <TrayButton key={it.label} icon={it.icon} label={it.label} onPress={it.onPress} />
        ))}
      </View>
    </View>
  );
}

/** The map card's actions: Follow, then Trips, Navigate and Details. */
export function ActionRow({ following, canFollow, onFollow, onTrips, onNavigate, onDetails }: { following: boolean; canFollow: boolean; onFollow: () => void; onTrips: () => void; onNavigate: () => void; onDetails: () => void }) {
  return (
    <ActionBar
      inset
      main={{ icon: following ? "navigate" : "navigate-outline", label: following ? "Following" : "Follow", onPress: onFollow, selected: following, disabled: !canFollow }}
      items={[
        { icon: "git-commit-outline", label: "Trips", onPress: onTrips },
        { icon: "map-outline", label: "Navigate", onPress: onNavigate },
        { icon: "information-circle-outline", label: "Details", onPress: onDetails }
      ]}
    />
  );
}

function TrayButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.trayBtn, pressed && styles.trayPressed]} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.trayText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const PEEK_W = 30;

const styles = themed(() => ({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "stretch", gap: space.sm },
  gap: { width: 6 },
  card: { flex: 1, minWidth: 0, overflow: "hidden", backgroundColor: colors.background, gap: space.sm, paddingVertical: 10, paddingLeft: 15, paddingRight: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: "800", color: colors.foreground },
  subLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  sub: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.mutedForeground, flexShrink: 1, fontVariant: ["tabular-nums"] },
  headEnd: { alignSelf: "flex-start", alignItems: "flex-end", gap: 2 },
  index: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: colors.mutedForeground, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden", fontVariant: ["tabular-nums"] },
  close: { width: 26, height: 22, alignItems: "flex-end", justifyContent: "center" },
  silent: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 7, paddingHorizontal: 10, borderRadius: radius.lg },
  silentTitle: { fontSize: 14, lineHeight: 18, fontWeight: "800", color: colors.foreground },
  silentNote: { fontSize: 12, lineHeight: 16, color: colors.mutedForeground },
  strip: { flexDirection: "row", borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: isDark ? colors.muted : "#f3f6fb" },
  cell: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 1, paddingVertical: 7, paddingHorizontal: 2 },
  cellLine: { borderRightWidth: 1, borderRightColor: colors.border },
  cellTop: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, maxWidth: "100%" },
  cellValue: { fontSize: 15, lineHeight: 18, fontWeight: "800", flexShrink: 1, fontVariant: ["tabular-nums"] },
  cellLabel: { fontSize: 11, lineHeight: 13, fontWeight: "600", color: colors.mutedForeground },
  addr: { flexDirection: "row", alignItems: "flex-start", gap: 6, minWidth: 0 },
  addrLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.mutedForeground },
  addrText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 17, fontWeight: "600", color: colors.foreground },
  peek: { width: PEEK_W, alignItems: "center", justifyContent: "space-between", paddingVertical: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  peekLeft: { borderTopRightRadius: 14, borderBottomRightRadius: 14, borderLeftWidth: 0, borderRightWidth: 3 },
  peekRight: { borderTopLeftRadius: 14, borderBottomLeftRadius: 14, borderRightWidth: 0, borderLeftWidth: 3 },
  peekNameBox: { flex: 1, width: PEEK_W, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  peekName: { width: 96, textAlign: "center", fontSize: 12, lineHeight: 15, fontWeight: "700", color: colors.foreground },
  peekDot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionsInset: { paddingHorizontal: 14 },
  follow: { flexDirection: "row", alignItems: "center", gap: 5, height: 42, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.primary },
  followOn: { backgroundColor: colors.primaryDark },
  followOff: { backgroundColor: colors.muted },
  followText: { fontSize: 14, fontWeight: "700", color: colors.primaryForeground },
  tray: { flex: 1, minWidth: 0, flexDirection: "row", padding: 3, gap: 2, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted },
  trayBtn: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 34, borderRadius: 11 },
  trayPressed: { backgroundColor: colors.background },
  trayText: { fontSize: 13, fontWeight: "700", color: colors.foreground, flexShrink: 1 }
}));
