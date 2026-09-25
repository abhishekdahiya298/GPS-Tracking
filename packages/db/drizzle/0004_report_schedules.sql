CREATE TYPE "public"."report_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency" "report_frequency" NOT NULL,
	"time_zone" text NOT NULL,
	"send_hour" integer NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"device_ids" jsonb,
	"recipient_user_ids" jsonb NOT NULL,
	"attach_csv" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_period_key" text,
	"last_sent_at" timestamp with time zone,
	"last_status" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedules_org_idx" ON "report_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "report_schedules_active_idx" ON "report_schedules" USING btree ("active");