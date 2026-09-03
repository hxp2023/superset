CREATE TYPE "public"."proxy_credential_provider" AS ENUM('anthropic', 'openai', 'custom');--> statement-breakpoint
CREATE TABLE "environment_proxy_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"provider" "proxy_credential_provider" NOT NULL,
	"name" text NOT NULL,
	"placeholder_env" text NOT NULL,
	"destinations" text[] NOT NULL,
	"header" text NOT NULL,
	"value_template" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_proxy_credentials_environment_id_organization_id_name_unique" UNIQUE("environment_id","organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "environment_proxy_credentials" ADD CONSTRAINT "environment_proxy_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_proxy_credentials" ADD CONSTRAINT "environment_proxy_credentials_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_proxy_credentials" ADD CONSTRAINT "environment_proxy_credentials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environment_proxy_credentials_environment_id_idx" ON "environment_proxy_credentials" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "environment_proxy_credentials_organization_id_idx" ON "environment_proxy_credentials" USING btree ("organization_id");