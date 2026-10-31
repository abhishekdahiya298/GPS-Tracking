ALTER TABLE "sim_cards" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "sim_cards" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "sim_cards" ADD COLUMN "synced_at" timestamp with time zone;