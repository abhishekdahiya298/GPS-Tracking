import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gpsProviders } from "./gpsProviders";
import { organizations } from "./organizations";

export const gpsDeviceStatusEnum = pgEnum("gps_device_status", ["active", "inactive", "retired"]);

/**
 * RIO's own device identity, and the platform's tracker inventory.
 *
 * Lifecycle (platform admins only): a tracker is added to stock (organization null), assigned to
 * a customer, possibly moved to another customer, returned to stock, and finally retired. Its
 * positions are stored with the organization it belonged to at the time (location_history has
 * its own organization_id), so moving a tracker never shows one customer's history to another.
 * Tenant queries always filter on organization_id, so stock trackers are invisible to customers.
 * `imei` is the hardware truth; `externalDeviceId` is the
 * provider's own id for the device (Traccar's `uniqueId`) and is treated as an
 * integration detail — nothing outside the traccar-client package should reason
 * about provider-internal ids.
 */
export const gpsDevices = pgTable(
  "gps_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = in RIO's stock (not with any customer). */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    /** The customer's provider row; null while in stock. */
    providerId: uuid("provider_id").references(() => gpsProviders.id, { onDelete: "restrict" }),
    externalDeviceId: text("external_device_id").notNull(),
    imei: text("imei").notNull(),
    model: text("model"),
    /** Customer-facing label, e.g. "Truck 7 tracker" (optional). */
    name: text("name"),
    status: gpsDeviceStatusEnum("status").notNull().default("active"),
    /** Manufacturer serial, if it differs from the IMEI (platform only). */
    serialNumber: text("serial_number"),
    /** Platform notes, e.g. "returned with cracked case" (never shown to customers). */
    platformNotes: text("platform_notes"),
    /** When it last changed hands (stock, customer, retired). */
    inventoryChangedAt: timestamp("inventory_changed_at", { withTimezone: true }),
    /** Last time RIO received any record from this device (fix or not). Drives online/offline. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    imeiUnique: uniqueIndex("gps_devices_imei_unique").on(table.imei),
    providerExternalIdUnique: uniqueIndex("gps_devices_provider_external_id_unique").on(
      table.providerId,
      table.externalDeviceId
    )
  })
);
