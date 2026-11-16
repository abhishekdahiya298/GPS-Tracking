/**
 * Expo config plugin: on iPhone, draws the street map with Apple's "realistic elevation" style.
 * That style turns into the round 3D Earth when zoomed out (iOS 16+), in the same light or dark
 * colours as the rest of the map, like the Apple Maps app. react-native-maps has no prop for it,
 * so this adds one block to its iOS view when the app is built (prebuild). Satellite is unchanged.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARK = "// RIO GPS: realistic elevation";
const FIND = `    if (oldViewProps.mapType != newViewProps.mapType){
        _view.mapType = mapRNTypeToMKMapType(newViewProps.mapType);
    }`;
const ADD = `
    ${MARK}: the street map becomes the round 3D Earth when zoomed out.
    if (@available(iOS 16.0, *)) {
        if (_view.mapType == MKMapTypeStandard) {
            MKMapConfiguration *now = _view.preferredConfiguration;
            BOOL realistic = [now isKindOfClass:[MKStandardMapConfiguration class]] && ((MKStandardMapConfiguration *)now).elevationStyle == MKMapElevationStyleRealistic;
            if (!realistic) {
                MKStandardMapConfiguration *c = [[MKStandardMapConfiguration alloc] initWithElevationStyle:MKMapElevationStyleRealistic];
                c.pointOfInterestFilter = _view.pointOfInterestFilter;
                _view.preferredConfiguration = c;
            }
        }
    }`;

module.exports = function withAppleGlobe(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const file = require.resolve("react-native-maps/ios/AirMaps/RNMapsMapView.mm", { paths: [cfg.modRequest.projectRoot] });
      const src = fs.readFileSync(file, "utf8");
      if (src.includes(MARK)) return cfg;
      if (!src.includes(FIND)) {
        // A newer react-native-maps changed this code: build without the globe rather than fail.
        console.warn(`[with-apple-globe] ${path.basename(file)} changed; the realistic Earth is not added.`);
        return cfg;
      }
      fs.writeFileSync(file, src.replace(FIND, FIND + ADD));
      return cfg;
    }
  ]);
};
