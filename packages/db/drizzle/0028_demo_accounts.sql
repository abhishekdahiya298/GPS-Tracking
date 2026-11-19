ALTER TABLE "organizations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The store-review / sales demo customer created on 2026-11-10.
UPDATE "organizations" SET "is_demo" = true WHERE "slug" = 'rio-demo';
