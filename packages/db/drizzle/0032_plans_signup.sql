CREATE TABLE "phone_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "locked_features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "visibility" text DEFAULT 'offered' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_note" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "locked_features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_return_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signup_role" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signup_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source" text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "plan_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "needs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_way" text;--> statement-breakpoint
CREATE INDEX "phone_codes_phone_idx" ON "phone_codes" USING btree ("phone","created_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_return_plan_id_plans_id_fk" FOREIGN KEY ("trial_return_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_join_code_unique" UNIQUE("join_code");--> statement-breakpoint
CREATE INDEX "organizations_signup_phone_idx" ON "organizations" USING btree ("signup_phone");--> statement-breakpoint
-- The public free plan. Its features and limits are edited in the console (Plans → Matrix).
INSERT INTO "plans" ("name", "modules", "included_loads", "locked_features", "limits", "visibility", "sort_order")
VALUES (
  'Free Basic',
  '{gps,loads}',
  5,
  '{alerts,csv_export,emailed_reports,gps_trackers,loads_map,maintenance,reports,shipper_links,trip_history,zones}',
  '{"vehicles":2,"drivers":2,"members":1,"trackers":0,"loadsPerMonth":5,"historyDays":1}'::jsonb,
  'public',
  0
)
ON CONFLICT (lower("name")) DO NOTHING;
--> statement-breakpoint
UPDATE "plans" SET "visibility" = 'hidden' WHERE lower("name") = 'free (internal & testing)';
