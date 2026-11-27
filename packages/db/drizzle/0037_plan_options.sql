ALTER TABLE "plans" ADD COLUMN "per_trailer_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "per_driver_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;