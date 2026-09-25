/**
 * Thin wrapper over Traccar's REST API, used only for admin/lookup calls
 * (e.g. confirming a device is registered). The live position path in v0
 * never goes through this client — it consumes Traccar's outgoing webhook
 * instead. Keeping this interface narrow stops Traccar's data model from
 * leaking into the rest of RIO.
 */
export interface TraccarDeviceSummary {
  id: number;
  uniqueId: string;
  name: string;
  status: string;
}

export interface TraccarClientConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export class TraccarRestClient {
  constructor(private readonly config: TraccarClientConfig) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
    return `Basic ${token}`;
  }

  async listDevices(): Promise<TraccarDeviceSummary[]> {
    const response = await fetch(`${this.config.baseUrl}/api/devices`, {
      headers: { Authorization: this.authHeader() }
    });
    if (!response.ok) {
      throw new Error(`Traccar API error: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as TraccarDeviceSummary[];
  }

  /** Looks up a device by its uniqueId (IMEI for Teltonika). */
  async findDeviceByUniqueId(uniqueId: string): Promise<TraccarDeviceSummary | null> {
    const response = await fetch(`${this.config.baseUrl}/api/devices?uniqueId=${encodeURIComponent(uniqueId)}`, {
      headers: { Authorization: this.authHeader() }
    });
    if (!response.ok) throw new Error(`Traccar API error: ${response.status} ${response.statusText}`);
    const devices = (await response.json()) as TraccarDeviceSummary[];
    return devices[0] ?? null;
  }

  /**
   * Raw positions for one device in [from, to], oldest first (Traccar /api/positions).
   * Used only for history backfill; callers validate each item with
   * TraccarForwardPositionSchema, the same schema the webhook uses.
   */
  async listPositions(deviceId: number, from: Date, to: Date): Promise<unknown[]> {
    const qs = new URLSearchParams({ deviceId: String(deviceId), from: from.toISOString(), to: to.toISOString() });
    const response = await fetch(`${this.config.baseUrl}/api/positions?${qs}`, {
      headers: { Authorization: this.authHeader(), Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Traccar API error: ${response.status} ${response.statusText}`);
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) throw new Error("Traccar API returned a non-array positions body");
    return body;
  }

  /**
   * Registers a device (Traccar requires uniqueId to be unique). Returns the
   * existing device if one with this uniqueId is already registered.
   */
  async ensureDevice(name: string, uniqueId: string): Promise<{ device: TraccarDeviceSummary; created: boolean }> {
    const existing = await this.findDeviceByUniqueId(uniqueId);
    if (existing) return { device: existing, created: false };
    const response = await fetch(`${this.config.baseUrl}/api/devices`, {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, uniqueId })
    });
    if (!response.ok) throw new Error(`Traccar API error: ${response.status} ${response.statusText}`);
    return { device: (await response.json()) as TraccarDeviceSummary, created: true };
  }
}
