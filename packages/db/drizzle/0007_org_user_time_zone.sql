CREATE TYPE "public"."time_format" AS ENUM('12h', '24h');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "time_zone" text DEFAULT 'America/Toronto' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "time_format" time_format DEFAULT '12h' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_format" time_format;