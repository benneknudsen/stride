DROP INDEX "chat_messages_user_conversation_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_user_created_idx" ON "chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "chat_messages" DROP COLUMN "conversation_id";