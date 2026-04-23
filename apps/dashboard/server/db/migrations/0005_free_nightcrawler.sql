CREATE TYPE "public"."identity_provider" AS ENUM('github');--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"external_id" text NOT NULL,
	"external_handle" text NOT NULL,
	"external_name" text,
	"external_email" text,
	"external_avatar_url" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_external_id_unique" ON "user_identities" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_provider_unique" ON "user_identities" USING btree ("user_id","provider");