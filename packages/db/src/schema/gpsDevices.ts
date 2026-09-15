import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gpsProviders } from "./gpsProviders";
import { organizations } from "./organizations";

export const gpsDeviceStatusEnum = pgEnum("gps_device_status", ["active", "inactive", "retired"]);

/**
 * RIO's own device identity. `imei` is the hardware truth; `externalDeviceId` is the
 * provider's own id for the device (Traccar's `uniqueId`) and is treated as an
 * integration detail — nothing outside the traccar-client package should reason
 * about provider-internal ids.
 */
export const gpsDevices = pgTable(
  "gps_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => gpsProviders.id, { onDelete: "restrict" }),
    externalDeviceId: text("external_device_id").notNull(),
    imei: text("imei").notNull(),
    model: text("model"),
    status: gpsDeviceStatusEnum("status").notNull().default("active"),
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
