/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
/**
 * The vehicle pictures for the map (assets/map, drawn by scripts/make-map-sprites.py).
 * Every file is named here because the app bundler only includes images it can see by name.
 */
export const VEHICLE_IMAGES: Record<string, number> = {
  "veh-car-moving": require("../../assets/map/veh-car-moving.png"),
  "veh-car-idle": require("../../assets/map/veh-car-idle.png"),
  "veh-car-stopped": require("../../assets/map/veh-car-stopped.png"),
  "veh-car-offline": require("../../assets/map/veh-car-offline.png"),
  "veh-van-moving": require("../../assets/map/veh-van-moving.png"),
  "veh-van-idle": require("../../assets/map/veh-van-idle.png"),
  "veh-van-stopped": require("../../assets/map/veh-van-stopped.png"),
  "veh-van-offline": require("../../assets/map/veh-van-offline.png"),
  "veh-truck-moving": require("../../assets/map/veh-truck-moving.png"),
  "veh-truck-idle": require("../../assets/map/veh-truck-idle.png"),
  "veh-truck-stopped": require("../../assets/map/veh-truck-stopped.png"),
  "veh-truck-offline": require("../../assets/map/veh-truck-offline.png"),
  "veh-trailer-moving": require("../../assets/map/veh-trailer-moving.png"),
  "veh-trailer-idle": require("../../assets/map/veh-trailer-idle.png"),
  "veh-trailer-stopped": require("../../assets/map/veh-trailer-stopped.png"),
  "veh-trailer-offline": require("../../assets/map/veh-trailer-offline.png")
};

/** The 3D map pins (assets/map/pin-*.png, drawn at 3× from assets/art/*.svg). Shown at icon-size 1/3. */
export const PIN_IMAGES: Record<string, number> = {
  "pin-trailer-idle": require("../../assets/map/pin-trailer-idle.png"),
  "pin-trailer-moving-0": require("../../assets/map/pin-trailer-moving-0.png"),
  "pin-trailer-moving-1": require("../../assets/map/pin-trailer-moving-1.png"),
  "pin-trailer-moving-2": require("../../assets/map/pin-trailer-moving-2.png"),
  "pin-trailer-moving-3": require("../../assets/map/pin-trailer-moving-3.png"),
  "pin-trailer-moving-4": require("../../assets/map/pin-trailer-moving-4.png"),
  "pin-trailer-moving-5": require("../../assets/map/pin-trailer-moving-5.png"),
  "pin-trailer-moving-6": require("../../assets/map/pin-trailer-moving-6.png"),
  "pin-trailer-moving-7": require("../../assets/map/pin-trailer-moving-7.png"),
  "pin-trailer-offline": require("../../assets/map/pin-trailer-offline.png"),
  "pin-trailer-parked": require("../../assets/map/pin-trailer-parked.png"),
  "pin-trailer-stopped": require("../../assets/map/pin-trailer-stopped.png"),
  "pin-truck-idle": require("../../assets/map/pin-truck-idle.png"),
  "pin-truck-moving-0": require("../../assets/map/pin-truck-moving-0.png"),
  "pin-truck-moving-1": require("../../assets/map/pin-truck-moving-1.png"),
  "pin-truck-moving-2": require("../../assets/map/pin-truck-moving-2.png"),
  "pin-truck-moving-3": require("../../assets/map/pin-truck-moving-3.png"),
  "pin-truck-moving-4": require("../../assets/map/pin-truck-moving-4.png"),
  "pin-truck-moving-5": require("../../assets/map/pin-truck-moving-5.png"),
  "pin-truck-moving-6": require("../../assets/map/pin-truck-moving-6.png"),
  "pin-truck-moving-7": require("../../assets/map/pin-truck-moving-7.png"),
  "pin-truck-offline": require("../../assets/map/pin-truck-offline.png"),
  "pin-truck-parked": require("../../assets/map/pin-truck-parked.png"),
  "pin-truck-stopped": require("../../assets/map/pin-truck-stopped.png")
};
