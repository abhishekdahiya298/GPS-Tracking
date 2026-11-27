CREATE TABLE "load_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"stop" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"method" text,
	"latitude" double precision,
	"longitude" double precision,
	"captured_at" timestamp with time zone,
	"driver_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paperwork_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"items" jsonb,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"to_creator" boolean DEFAULT true NOT NULL,
	"send_when" text DEFAULT 'delivered' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "paperwork" jsonb;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "packet_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "paperwork_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paperwork_settings" ADD CONSTRAINT "paperwork_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "load_documents_load_idx" ON "load_documents" USING btree ("load_id","created_at");--> statement-breakpoint
CREATE INDEX "load_documents_driver_idx" ON "load_documents" USING btree ("driver_id") WHERE "load_documents"."driver_id" is not null;