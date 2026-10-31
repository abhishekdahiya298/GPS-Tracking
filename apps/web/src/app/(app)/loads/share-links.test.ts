import { describe, expect, it } from "vitest";
import { smsHref, whatsappHref } from "./load-form";

describe("driver link share buttons", () => {
  const msg = "Northbound: open https://app.riogps.com/d#abc & accept";
  it("WhatsApp gets digits only and the encoded message", () => {
    expect(whatsappHref("+1 (416) 555-0100", msg)).toBe(`https://wa.me/14165550100?text=${encodeURIComponent(msg)}`);
    expect(whatsappHref(null, msg)).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  });
  it("text message keeps the number and encodes the # and & in the link", () => {
    const href = smsHref("+14165550100", msg);
    expect(href.startsWith("sms:+14165550100?&body=")).toBe(true);
    expect(href).not.toContain("#abc");
    expect(decodeURIComponent(href.split("body=")[1]!)).toBe(msg);
  });
});
