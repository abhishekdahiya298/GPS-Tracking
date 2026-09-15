import { describe, expect, it } from "vitest";
import { getAuthenticatedSession, UnauthenticatedError } from "./tenant.js";

describe("getAuthenticatedSession", () => {
  it("rejects until real session verification is implemented, never falling back to trusting client input", async () => {
    await expect(getAuthenticatedSession(new Request("http://localhost/api/x"))).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
  });
});
