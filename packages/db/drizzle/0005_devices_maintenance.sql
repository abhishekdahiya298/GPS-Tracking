CREATE TABLE "maintenance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval_km" integer,
	"interval_days" integer,
	"last_service_at" timestamp with time zone NOT NULL,
	"last_service_odometer_km" integer,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_state" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"serviced_at" timestamp with time zone NOT NULL,
	"odometer_km" integer,
	"km_since_previous" integer,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gps_devices" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_item_id_maintenance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."maintenance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_items_org_idx" ON "maintenance_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "maintenance_items_vehicle_idx" ON "maintenance_items" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "maintenance_records_item_idx" ON "maintenance_records" USING btree ("item_id","serviced_at");