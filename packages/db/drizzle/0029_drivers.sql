CREATE TYPE "public"."driver_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"license_number" text,
	"license_expires_on" date,
	"vehicle_id" uuid,
	"assigned_at" timestamp with time zone,
	"status" "driver_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drivers_org_idx" ON "drivers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_vehicle_uq" ON "drivers" USING btree ("vehicle_id") WHERE "drivers"."vehicle_id" is not null;