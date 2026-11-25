ALTER TABLE "driver_app_sessions" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "driver_app_status" ADD COLUMN "location_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "driver_app_status" ADD COLUMN "location_asked_by" uuid;--> statement-breakpoint
ALTER TABLE "driver_app_status" ADD CONSTRAINT "driver_app_status_location_asked_by_users_id_fk" FOREIGN KEY ("location_asked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;