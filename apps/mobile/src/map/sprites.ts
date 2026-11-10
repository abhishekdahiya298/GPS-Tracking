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
