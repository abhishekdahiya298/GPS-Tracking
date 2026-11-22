CREATE TABLE "driver_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vin" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "model_year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "make" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "plate_region" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fuel_type" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "unit_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "odometer_km" double precision;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "odometer_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_assignments_driver_idx" ON "driver_assignments" USING btree ("organization_id","driver_id","assigned_at");--> statement-breakpoint
CREATE INDEX "driver_assignments_vehicle_idx" ON "driver_assignments" USING btree ("organization_id","vehicle_id","assigned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_assignments_one_open_per_driver" ON "driver_assignments" USING btree ("driver_id") WHERE "driver_assignments"."unassigned_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_assignments_one_open_per_vehicle" ON "driver_assignments" USING btree ("vehicle_id") WHERE "driver_assignments"."unassigned_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_org_vin_uq" ON "vehicles" USING btree ("organization_id","vin") WHERE "vehicles"."vin" is not null;--> statement-breakpoint
-- Backfill: every driver who drives a vehicle today gets an open history row.
INSERT INTO "driver_assignments" ("organization_id", "driver_id", "vehicle_id", "assigned_at")
SELECT "organization_id", "id", "vehicle_id", coalesce("assigned_at", "created_at")
FROM "drivers" WHERE "vehicle_id" IS NOT NULL;
