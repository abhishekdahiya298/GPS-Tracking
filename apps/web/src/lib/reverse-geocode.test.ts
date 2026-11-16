import { describe, expect, it } from "vitest";
import { fromGeoapify, fromGoogle, fromNominatim, spotKey } from "./reverse-geocode";
import { parseMapsSettings, providerKeys } from "./maps-settings";

describe("reverse geocode", () => {
  it("builds a two-line address from OpenStreetMap", () => {
    expect(fromNominatim({ address: { house_number: "100", road: "Front Street West", city: "Toronto", "ISO3166-2-lvl4": "CA-ON", postcode: "M5J 1E3", country: "Canada" } })).toEqual({ line1: "100 Front Street West", line2: "Toronto, ON M5J 1E3", label: "100 Front Street West, Toronto, ON M5J 1E3" });
    expect(fromNominatim({ address: { road: "Highway 401", town: "Milton", "ISO3166-2-lvl4": "CA-ON" } })?.line1).toBe("Highway 401");
  });
  it("reads Geoapify and Google results the same way", () => {
    expect(fromGeoapify({ housenumber: "8", street: "Main St", city: "Brampton", state_code: "ON", postcode: "L6X 1A1" })?.label).toBe("8 Main St, Brampton, ON L6X 1A1");
    expect(
      fromGoogle({
        address_components: [
          { long_name: "8", short_name: "8", types: ["street_number"] },
          { long_name: "Main Street", short_name: "Main St", types: ["route"] },
          { long_name: "Brampton", short_name: "Brampton", types: ["locality"] },
          { long_name: "Ontario", short_name: "ON", types: ["administrative_area_level_1"] }
        ]
      })?.label
    ).toBe("8 Main Street, Brampton, ON");
  });
  it("rounds spots to about 11 m", () => {
    expect(spotKey(43.513249, -79.882149)).toBe("43.5132,-79.8821");
  });
  it("falls back to addresses off for a bad setting, and needs keys for paid services", () => {
    expect(parseMapsSettings({ addressProvider: "bing" })).toEqual({ addressProvider: "off", mapStyle: "streets", iconStyle: "photo", iconColor: "status", mobileMap: "osm" });
    // Saved before icon defaults existed: keeps the address choice.
    expect(parseMapsSettings({ addressProvider: "osm", mapStyle: "dark" })).toEqual({ addressProvider: "osm", mapStyle: "dark", iconStyle: "photo", iconColor: "status", mobileMap: "osm" });
    expect(providerKeys({} as NodeJS.ProcessEnv)).toEqual({ off: true, osm: true, geoapify: false, google: false });
  });
});
