CREATE TYPE "public"."unit_system" AS ENUM('imperial', 'metric');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "unit_system" "unit_system" DEFAULT 'imperial' NOT NULL;