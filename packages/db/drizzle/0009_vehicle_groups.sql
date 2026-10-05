CREATE TABLE "vehicle_group_members" (
	"group_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_group_members_group_id_vehicle_id_pk" PRIMARY KEY("group_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_group_members" ADD CONSTRAINT "vehicle_group_members_group_id_vehicle_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."vehicle_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_group_members" ADD CONSTRAINT "vehicle_group_members_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_group_members" ADD CONSTRAINT "vehicle_group_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_groups" ADD CONSTRAINT "vehicle_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_group_members_vehicle_idx" ON "vehicle_group_members" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_groups_org_name_unique" ON "vehicle_groups" USING btree ("organization_id",lower("name"));