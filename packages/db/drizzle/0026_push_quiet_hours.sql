ALTER TABLE "push_devices" ADD COLUMN "quiet_start" integer;--> statement-breakpoint
ALTER TABLE "push_devices" ADD COLUMN "quiet_end" integer;--> statement-breakpoint
ALTER TABLE "push_devices" ADD COLUMN "time_zone" text;