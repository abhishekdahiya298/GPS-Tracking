CREATE TYPE "public"."app_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "app_releases" (
	"platform" "app_platform" PRIMARY KEY NOT NULL,
	"latest_version" text,
	"min_version" text,
	"update_url" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;