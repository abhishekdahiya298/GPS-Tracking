CREATE TYPE "public"."alert_type" AS ENUM('geofence_enter', 'geofence_exit', 'speeding', 'ignition_on', 'ignition_off', 'device_offline');--> statement-breakpoint
CREATE TYPE "public"."geofence_kind" AS ENUM('circle', 'polygon');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"rule_id" uuid,
	"rule_name" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"device_id" uuid,
	"vehicle_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"details" jsonb,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid
);
--> statement-breakpoint
CREATE TABLE "alert_rule_state" (
	"rule_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rule_state_rule_id_device_id_pk" PRIMARY KEY("rule_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"vehicle_id" uuid,
	"geofence_id" uuid,
	"speed_kph" integer,
	"offline_minutes" integer,
	"notify_email" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "geofence_kind" NOT NULL,
	"center_lat" double precision,
	"center_lon" double precision,
	"radius_m" integer,
	"polygon" jsonb,
	"color" text DEFAULT '#3056d3' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_device_id_gps_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."gps_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule_state" ADD CONSTRAINT "alert_rule_state_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule_state" ADD CONSTRAINT "alert_rule_state_device_id_gps_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."gps_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_geofence_id_geofences_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_org_occurred_idx" ON "alert_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "alert_events_org_unack_idx" ON "alert_events" USING btree ("organization_id") WHERE "alert_events"."acknowledged_at" is null;--> statement-breakpoint
CREATE INDEX "alert_rules_org_active_idx" ON "alert_rules" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "geofences_org_idx" ON "geofences" USING btree ("organization_id");