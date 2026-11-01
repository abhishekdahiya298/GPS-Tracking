CREATE TYPE "public"."nav_theme" AS ENUM('gradient', 'light', 'glass');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nav_theme" "nav_theme";