import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openStream } from "./stream";

/** A stand-in for the phone's XMLHttpRequest that the test drives by hand. */
class FakeXhr {
  static last: FakeXhr;
  readyState = 0;
  status = 0;
  responseText = "";
  responseType = "";
  withCredentials = true;
  headers: Record<string, string> = {};
  aborted = false;
  url = "";
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {}
  abort() {
    this.aborted = true;
  }
  respond(status: number) {
    this.status = status;
    this.readyState = 2;
    this.onreadystatechange?.();
  }
  push(text: string) {
    this.readyState = 3;
    this.responseText += text;
    this.onprogress?.();
  }
  end() {
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

describe("live stream connection", () => {
  const events: string[] = [];
  const closes: Array<{ status: number; planned: boolean }> = [];
  let opened = 0;
  const start = () =>
    openStream({
      url: "https://x/api/v1/locations/stream",
      headers: { Authorization: "Bearer t" },
      onOpen: () => opened++,
      onEvent: (e) => events.push(`${e.event}:${e.data}`),
      onClose: (info) => closes.push(info)
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    events.length = 0;
    closes.length = 0;
    opened = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the token, never cookies, and delivers events as text arrives", () => {
    start();
    const xhr = FakeXhr.last;
    expect(xhr.headers.Authorization).toBe("Bearer t");
    expect(xhr.withCredentials).toBe(false);
    xhr.respond(200);
    expect(opened).toBe(1);
    xhr.push("event: snapshot\ndata: {}\n\nevent: loc");
    xhr.push("ation\ndata: 1\n\n");
    expect(events).toEqual(["snapshot:{}", "location:1"]);
    expect(closes).toEqual([]);
  });

  it("reports a refused connection once, with its status", () => {
    start();
    FakeXhr.last.respond(401);
    FakeXhr.last.end();
    expect(opened).toBe(0);
    expect(closes).toEqual([{ status: 401, planned: false }]);
  });

  it("reports the server closing the stream, and a network failure", () => {
    start();
    FakeXhr.last.respond(200);
    FakeXhr.last.end();
    expect(closes).toEqual([{ status: 200, planned: false }]);
    start();
    FakeXhr.last.onerror?.();
    expect(closes[1]).toEqual({ status: 0, planned: false });
  });

  it("gives up on a silent connection after 90 seconds", () => {
    start();
    FakeXhr.last.respond(200);
    FakeXhr.last.push(": keep-alive\n\n");
    vi.advanceTimersByTime(89_000);
    expect(closes).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(closes).toEqual([{ status: 200, planned: false }]);
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it("starts a fresh connection (planned) once a lot of text has piled up", () => {
    start();
    FakeXhr.last.respond(200);
    FakeXhr.last.push(`: ${"x".repeat(1_600_000)}\n`);
    expect(closes).toEqual([{ status: 200, planned: true }]);
  });

  it("stays quiet after being closed by the app", () => {
    const close = start();
    FakeXhr.last.respond(200);
    close();
    FakeXhr.last.push("event: location\ndata: 1\n\n");
    FakeXhr.last.end();
    expect(events).toEqual([]);
    expect(closes).toEqual([]);
    expect(FakeXhr.last.aborted).toBe(true);
  });
});
