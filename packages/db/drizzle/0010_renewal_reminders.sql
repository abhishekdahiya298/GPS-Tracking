CREATE TABLE "renewal_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"remind_days" integer DEFAULT 30 NOT NULL,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_state" text,
	"note" text,
	"last_renewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renewal_reminders_org_due_idx" ON "renewal_reminders" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "renewal_reminders_vehicle_idx" ON "renewal_reminders" USING btree ("vehicle_id");