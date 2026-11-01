CREATE TYPE "public"."plan_module" AS ENUM('gps', 'loads');--> statement-breakpoint
CREATE TABLE "billable_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"period" text NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billable_trackers" (
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"imei" text NOT NULL,
	"period" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billable_trackers_organization_id_device_id_period_pk" PRIMARY KEY("organization_id","device_id","period")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"modules" "plan_module"[] NOT NULL,
	"included_loads" integer DEFAULT 0 NOT NULL,
	"extra_load_cents" integer DEFAULT 0 NOT NULL,
	"monthly_fee_cents" integer DEFAULT 0 NOT NULL,
	"per_tracker_cents" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_name" text NOT NULL,
	"modules" "plan_module"[] NOT NULL,
	"included_loads" integer DEFAULT 0 NOT NULL,
	"extra_load_cents" integer DEFAULT 0 NOT NULL,
	"monthly_fee_cents" integer DEFAULT 0 NOT NULL,
	"per_tracker_cents" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"changed_by" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "billable_loads" ADD CONSTRAINT "billable_loads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billable_trackers" ADD CONSTRAINT "billable_trackers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billable_loads_load_unique" ON "billable_loads" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "billable_loads_org_period_idx" ON "billable_loads" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "billable_trackers_org_period_idx" ON "billable_trackers" USING btree ("organization_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_name_unique" ON "plans" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_open" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "subscriptions_org_started_idx" ON "subscriptions" USING btree ("organization_id","started_at");--> statement-breakpoint
-- Starting catalog (suggested prices; edit them in the platform console before invoicing).
INSERT INTO "plans" ("name", "modules", "included_loads", "extra_load_cents", "monthly_fee_cents", "per_tracker_cents", "sort_order") VALUES
  ('GPS', '{gps}', 0, 0, 0, 1999, 1),
  ('Loads Starter', '{loads}', 50, 150, 4900, 0, 2),
  ('Loads Pro', '{loads}', 250, 100, 14900, 0, 3),
  ('Loads Pay as you go', '{loads}', 0, 250, 0, 0, 4),
  ('GPS + Loads', '{gps,loads}', 50, 150, 4900, 1999, 5);--> statement-breakpoint
-- Existing customers keep everything they have today.
INSERT INTO "subscriptions" ("organization_id", "plan_id", "plan_name", "modules", "included_loads", "extra_load_cents", "monthly_fee_cents", "per_tracker_cents", "note")
  SELECT o."id", p."id", p."name", p."modules", p."included_loads", p."extra_load_cents", p."monthly_fee_cents", p."per_tracker_cents", 'Assigned automatically when plans were introduced'
  FROM "organizations" o CROSS JOIN "plans" p WHERE p."name" = 'GPS + Loads';--> statement-breakpoint
-- Loads that already started tracking count in the month they started.
INSERT INTO "billable_loads" ("organization_id", "load_id", "reference", "period", "counted_at")
  SELECT l."organization_id", l."id", l."reference", to_char(l."accepted_at" AT TIME ZONE o."time_zone", 'YYYY-MM'), l."accepted_at"
  FROM "loads" l JOIN "organizations" o ON o."id" = l."organization_id" WHERE l."accepted_at" IS NOT NULL
  ON CONFLICT DO NOTHING;
