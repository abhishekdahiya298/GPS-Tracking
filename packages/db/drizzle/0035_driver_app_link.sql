ALTER TABLE "drivers" ADD COLUMN "app_link" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "app_link_at" timestamp with time zone;