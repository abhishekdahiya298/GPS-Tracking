CREATE TYPE "public"."load_tracking_mode" AS ENUM('phone', 'vehicle');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'load_late';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'load_no_signal';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'load_paused';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'load_arrived';--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'load_delivered';--> statement-breakpoint
ALTER TABLE "loads" ALTER COLUMN "driver_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_devices" ADD COLUMN "loads" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "tracking_mode" "load_tracking_mode" DEFAULT 'phone' NOT NULL;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "late_alert_target" text;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "stale_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loads_vehicle_idx" ON "loads" USING btree ("vehicle_id") WHERE "loads"."vehicle_id" is not null;