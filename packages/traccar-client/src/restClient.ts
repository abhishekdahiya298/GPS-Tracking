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
}
