CREATE TABLE "daily_stats_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_history_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_daily_stats" (
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"distance_m" integer DEFAULT 0 NOT NULL,
	"driving_s" integer DEFAULT 0 NOT NULL,
	"idle_s" integer DEFAULT 0 NOT NULL,
	"trips" integer DEFAULT 0 NOT NULL,
	"max_speed_kph" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_daily_stats_device_id_day_pk" PRIMARY KEY("device_id","day")
);
--> statement-breakpoint
ALTER TABLE "device_daily_stats" ADD CONSTRAINT "device_daily_stats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_daily_stats" ADD CONSTRAINT "device_daily_stats_device_id_gps_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."gps_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_daily_stats_org_day_idx" ON "device_daily_stats" USING btree ("organization_id","day");