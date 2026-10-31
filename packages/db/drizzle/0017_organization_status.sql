CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status" "organization_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status_changed_by" uuid;