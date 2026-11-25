/**
 * The driver's Map tab (D10): where I am, and the next stop. Uses the same map engine choice as
 * the owner app (the phone's own map, or OpenStreetMap), and follows the driver as they drive.
 */
import { Camera, Map, Marker as MlMarker, UserLocation } from "@maplibre/maplibre-react-native";
import { StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useMapEngine } from "@/map/mapEngine";
import { DEFAULT_CENTER, styleUrl } from "@/map/model";
import { isDark } from "@/theme";

export type Stop = { lat: number; lon: number; kind: "pickup" | "delivery"; title: string } | null;

export function DriveMap({ stop }: { stop: Stop }) {
  const engine = useMapEngine();
  const color = stop?.kind === "pickup" ? "#136c35" : "#d81e2c";
  if (engine === "native") {
    return (
      <MapView
        style={StyleSheet.absoluteFill}
        showsUserLocation
        followsUserLocation
        showsMyLocationButton
        userInterfaceStyle={isDark ? "dark" : "light"}
        initialRegion={stop ? { latitude: stop.lat, longitude: stop.lon, latitudeDelta: 0.5, longitudeDelta: 0.5 } : { latitude: DEFAULT_CENTER[1], longitude: DEFAULT_CENTER[0], latitudeDelta: 8, longitudeDelta: 8 }}
        toolbarEnabled={false}
      >
        {stop ? <Marker coordinate={{ latitude: stop.lat, longitude: stop.lon }} title={stop.title} pinColor={color} /> : null}
      </MapView>
    );
  }
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={styleUrl(isDark ? "dark" : "streets")} logo={false} attribution={false} compass={false}>
      <Camera trackUserLocation="course" initialViewState={{ center: stop ? [stop.lon, stop.lat] : DEFAULT_CENTER, zoom: stop ? 11 : 5 }} />
      <UserLocation heading accuracy />
      {stop ? (
        <MlMarker lngLat={[stop.lon, stop.lat]} anchor="bottom">
          <View style={[styles.pin, { backgroundColor: color }]} />
        </MlMarker>
      ) : null}
    </Map>
  );
}

const styles = StyleSheet.create({
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: "#ffffff" }
});
