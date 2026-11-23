import { describe, expect, it } from "vitest";
import { z } from "zod";
import { friendlyZodMessage } from "./validation-message";

const msg = (schema: z.ZodTypeAny, v: unknown) => {
  const r = schema.safeParse(v);
  return r.success ? null : friendlyZodMessage(r.error);
};

describe("friendlyZodMessage", () => {
  it("turns zod's built-in wording into sentences with the field name", () => {
    expect(msg(z.object({ name: z.string().min(1) }), { name: "" })).toBe("Name is required.");
    expect(msg(z.object({ name: z.string() }), {})).toBe("Name is required.");
    expect(msg(z.object({ lastServiceOdometerKm: z.number().min(0) }), { lastServiceOdometerKm: -5 })).toBe("Odometer at last service must be at least 0.");
    expect(msg(z.object({ email: z.string().email() }), { email: "x" })).toBe("Enter an email like name@company.com.");
    expect(msg(z.object({ note: z.string().max(5) }), { note: "toolong" })).toBe("Note is too long (at most 5 characters).");
    expect(msg(z.object({ intervalDays: z.number().int() }), { intervalDays: 1.5 })).toMatch(/Time interval must be a whole number|Time interval is not valid/);
    expect(msg(z.object({ vehicleId: z.string().uuid() }), { vehicleId: "x" })).toBe("Vehicle is not valid. Reload the page and try again.");
    expect(msg(z.object({ type: z.enum(["a", "b"]) }), { type: "c" })).toBe("Choose a type from the list.");
  });
  it("keeps messages the schema author wrote, without a field-key prefix", () => {
    expect(msg(z.object({ name: z.string().min(1, "Enter the driver's name") }), { name: "" })).toBe("Enter the driver's name");
    expect(msg(z.object({ d: z.date().refine(() => false, "Last service can't be in the future") }), { d: new Date() })).toBe("Last service can't be in the future");
  });
  it("joins several problems and drops duplicates", () => {
    expect(msg(z.object({ a: z.string().min(1, "Same"), b: z.string().min(1, "Same"), c: z.string() }), { a: "", b: "" })).toBe("Same C is required.");
  });
});
