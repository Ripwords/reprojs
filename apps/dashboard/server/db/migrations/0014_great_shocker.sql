DROP INDEX "user_invite_token_idx";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "invite_token";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "invite_token_expires_at";