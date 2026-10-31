CREATE TYPE "public"."sim_status" AS ENUM('inventory', 'active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE "sim_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iccid" text NOT NULL,
	"msisdn" text,
	"carrier" text,
	"plan" text,
	"apn" text,
	"status" "sim_status" DEFAULT 'inventory' NOT NULL,
	"monthly_cost_cents" integer,
	"device_id" uuid,
	"activated_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_daily_stats" DROP CONSTRAINT "device_daily_stats_device_id_day_pk";--> statement-breakpoint
ALTER TABLE "gps_devices" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gps_devices" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_daily_stats" ADD CONSTRAINT "device_daily_stats_organization_id_device_id_day_pk" PRIMARY KEY("organization_id","device_id","day");--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "platform_notes" text;--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "inventory_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "platform_notes" text;--> statement-breakpoint
ALTER TABLE "sim_cards" ADD CONSTRAINT "sim_cards_device_id_gps_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."gps_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sim_cards_iccid_unique" ON "sim_cards" USING btree ("iccid");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_cards_device_unique" ON "sim_cards" USING btree ("device_id");