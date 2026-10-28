CREATE TYPE "public"."load_status" AS ENUM('invited', 'tracking', 'at_pickup', 'in_transit', 'at_delivery', 'delivered', 'cancelled', 'declined');--> statement-breakpoint
CREATE TABLE "load_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "load_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"latitude" double precision,
	"longitude" double precision,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "load_pings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "load_pings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" double precision,
	"speed_kph" double precision,
	"heading_deg" double precision,
	"source" text DEFAULT 'web' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "load_status" DEFAULT 'invited' NOT NULL,
	"carrier_name" text,
	"driver_name" text,
	"driver_phone" text NOT NULL,
	"notes" text,
	"pickup_name" text,
	"pickup_address" text NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lon" double precision NOT NULL,
	"pickup_radius_m" integer DEFAULT 500 NOT NULL,
	"pickup_appointment_at" timestamp with time zone,
	"delivery_name" text,
	"delivery_address" text NOT NULL,
	"delivery_lat" double precision NOT NULL,
	"delivery_lon" double precision NOT NULL,
	"delivery_radius_m" integer DEFAULT 500 NOT NULL,
	"delivery_appointment_at" timestamp with time zone,
	"driver_token_hash" text NOT NULL,
	"shipper_token_hash" text,
	"invite_sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"consent_user_agent" text,
	"sharing_stopped_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"last_lat" double precision,
	"last_lon" double precision,
	"last_accuracy_m" double precision,
	"last_speed_kph" double precision,
	"last_position_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "load_events" ADD CONSTRAINT "load_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_events" ADD CONSTRAINT "load_events_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_events" ADD CONSTRAINT "load_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_pings" ADD CONSTRAINT "load_pings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_pings" ADD CONSTRAINT "load_pings_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "load_events_load_idx" ON "load_events" USING btree ("load_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "load_pings_load_recorded_unique" ON "load_pings" USING btree ("load_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loads_org_reference_unique" ON "loads" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "loads_org_created_idx" ON "loads" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loads_driver_token_unique" ON "loads" USING btree ("driver_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "loads_shipper_token_unique" ON "loads" USING btree ("shipper_token_hash") WHERE "loads"."shipper_token_hash" is not null;