import { describe, expect, it } from "vitest";
import { deviceDisplayName, deviceName, productName } from "./device-name";

describe("deviceName", () => {
  it("drops names that only repeat the model and IMEI", () => {
    expect(deviceName("FTM164 (868038076566455)", "FTM164")).toBeNull();
    expect(deviceName("FTM880 (864361078566115)", "FTM880")).toBeNull();
  });
  it("keeps real names", () => {
    expect(deviceName("Reefer unit 4", "FTM164")).toBe("Reefer unit 4");
    expect(deviceName(null, "FTM164")).toBeNull();
  });
});

describe("product names", () => {
  it("never shows the maker's model codes to customers", () => {
    expect(productName("FTM880")).toBe("RIO GPS 880");
    expect(productName("FTM164")).toBe("RIO GPS 164");
    expect(productName("NT28E")).toBe("RIO GPS 28");
    expect(deviceDisplayName("NT28E (862601388000266)", "NT28E")).toBe("RIO GPS 28");
    expect(productName(null)).toBe("RIO GPS tracker");
    expect(deviceDisplayName("FTM164", "FTM164")).toBe("RIO GPS 164");
    expect(deviceDisplayName("FTM164 (868038076566455)", "FTM164")).toBe("RIO GPS 164");
    expect(deviceDisplayName(null, "FTM880")).toBe("RIO GPS 880");
    expect(deviceDisplayName("Truck 7 tracker", "FTM880")).toBe("Truck 7 tracker");
    expect(deviceDisplayName("RIO GPS 164", "FTM164")).toBe("RIO GPS 164");
  });
});
