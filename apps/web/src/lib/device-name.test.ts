import { describe, expect, it } from "vitest";
import { deviceName } from "./device-name";

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
