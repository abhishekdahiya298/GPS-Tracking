import { describe, expect, it, vi } from "vitest";
import { normalizeVin, VehicleInputSchema, VehiclePatchSchema, vinCheckDigitOk } from "./schemas/vehicle";

vi.mock("./redis", () => ({ getReadyRedisPublisher: async () => { throw new Error("no redis in tests"); } }));

describe("vehicle details", () => {
  it("normalizes and validates VINs", () => {
    expect(normalizeVin(" 1hgcm8-2633a004352 ")).toBe("1HGCM82633A004352");
    expect(VehicleInputSchema.parse({ name: "T1", vin: "1hgcm82633a004352" }).vin).toBe("1HGCM82633A004352");
    expect(VehicleInputSchema.safeParse({ name: "T1", vin: "1HGCM82633A00435" }).success).toBe(false);
    // I, O and Q are never used in a VIN.
    expect(VehicleInputSchema.safeParse({ name: "T1", vin: "1HGCM82633A00435O" }).success).toBe(false);
    expect(VehicleInputSchema.parse({ name: "T1", vin: "" }).vin).toBeNull();
  });
  it("checks the North American check digit as a hint only", () => {
    expect(vinCheckDigitOk("1HGCM82633A004352")).toBe(true);
    expect(vinCheckDigitOk("1HGCM82643A004352")).toBe(false);
    // A failing check digit still saves (older and non-US vehicles).
    expect(VehicleInputSchema.safeParse({ name: "T1", vin: "1HGCM82643A004352" }).success).toBe(true);
  });
  it("reads optional numbers from form text", () => {
    const v = VehicleInputSchema.parse({ name: "T1", modelYear: "2022", sortOrder: "1", odometerKm: "193,121.46" });
    expect(v).toMatchObject({ modelYear: 2022, sortOrder: 1, odometerKm: 193121.5 });
    expect(VehicleInputSchema.parse({ name: "T1", modelYear: "", sortOrder: "" })).toMatchObject({ modelYear: null, sortOrder: null });
    expect(VehicleInputSchema.safeParse({ name: "T1", modelYear: "1900" }).success).toBe(false);
    expect(VehicleInputSchema.safeParse({ name: "T1", sortOrder: "0" }).success).toBe(false);
  });
  it("a patch only touches the fields it sends", () => {
    expect(VehiclePatchSchema.parse({ sortOrder: 2 })).toEqual({ sortOrder: 2 });
  });
  it("fills year, make, model and fuel from the VIN look-up", async () => {
    const { decodeVin } = await import("./vin-decode");
    const fake = vi.fn(async () => new Response(JSON.stringify({ Results: [{ ModelYear: "2022", Make: "FREIGHTLINER", Model: "Cascadia", FuelTypePrimary: "Diesel" }] }), { status: 200 }));
    const info = await decodeVin("3akjhhdr7nsmn1234", fake as unknown as typeof fetch);
    expect(info).toMatchObject({ vin: "3AKJHHDR7NSMN1234", modelYear: 2022, make: "Freightliner", model: "Cascadia", fuelType: "diesel", found: true });
    expect(await decodeVin("short", fake as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await decodeVin("3AKJHHDR7NSMN1234", down as unknown as typeof fetch)).toMatchObject({ found: false, make: null });
  });
});
