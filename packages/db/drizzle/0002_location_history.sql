CREATE TABLE "location_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"speed_kph" double precision,
	"heading_deg" double precision,
	"altitude_m" double precision,
	"ignition" boolean,
	"motion" boolean
);
--> statement-breakpoint
ALTER TABLE "current_locations" ADD COLUMN "ignition" boolean;--> statement-breakpoint
ALTER TABLE "current_locations" ADD COLUMN "motion" boolean;--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_device_id_gps_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."gps_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_history" ADD CONSTRAINT "location_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_history_device_recorded_unique" ON "location_history" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE INDEX "location_history_org_recorded_idx" ON "location_history" USING btree ("organization_id","recorded_at");--> statement-breakpoint
CREATE INDEX "location_history_vehicle_recorded_idx" ON "location_history" USING btree ("vehicle_id","recorded_at") WHERE "location_history"."vehicle_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_assignments_one_active_per_device" ON "device_assignments" USING btree ("device_id") WHERE "device_assignments"."unassigned_at" is null;