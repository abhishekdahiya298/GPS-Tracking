CREATE TABLE "driver_app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"platform" text,
	"app_version" text,
	"device_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "driver_app_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "driver_app_status" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"battery_pct" integer,
	"charging" boolean,
	"permission" text,
	"location_enabled" boolean,
	"platform" text,
	"app_version" text,
	"signed_in" boolean DEFAULT false NOT NULL,
	"last_report_at" timestamp with time zone,
	"last_fix_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"sent_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "phone_device_id" uuid;--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "kind" text DEFAULT 'tracker' NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_app_sessions" ADD CONSTRAINT "driver_app_sessions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_app_sessions" ADD CONSTRAINT "driver_app_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_app_status" ADD CONSTRAINT "driver_app_status_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_app_status" ADD CONSTRAINT "driver_app_status_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_invites" ADD CONSTRAINT "driver_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_invites" ADD CONSTRAINT "driver_invites_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_invites" ADD CONSTRAINT "driver_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_app_sessions_driver_idx" ON "driver_app_sessions" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_invites_driver_idx" ON "driver_invites" USING btree ("driver_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_phone_device_id_gps_devices_id_fk" FOREIGN KEY ("phone_device_id") REFERENCES "public"."gps_devices"("id") ON DELETE set null ON UPDATE no action;