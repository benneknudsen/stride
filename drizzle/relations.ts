import { relations } from "drizzle-orm";
import {
  activities,
  activityEmbeddings,
  aiAnalyses,
  chatMessages,
  stravaTokens,
  users,
} from "./schema";

/**
 * Drizzle relations — enables the relational query API (`db.query.*`).
 * Mirrors the foreign keys declared in schema.ts.
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  stravaTokens: one(stravaTokens, {
    fields: [users.id],
    references: [stravaTokens.userId],
  }),
  activities: many(activities),
  analyses: many(aiAnalyses),
  chatMessages: many(chatMessages),
  embeddings: many(activityEmbeddings),
}));

export const stravaTokensRelations = relations(stravaTokens, ({ one }) => ({
  user: one(users, {
    fields: [stravaTokens.userId],
    references: [users.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  user: one(users, {
    fields: [activities.userId],
    references: [users.id],
  }),
  embeddings: many(activityEmbeddings),
}));

export const aiAnalysesRelations = relations(aiAnalyses, ({ one }) => ({
  user: one(users, {
    fields: [aiAnalyses.userId],
    references: [users.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  user: one(users, {
    fields: [chatMessages.userId],
    references: [users.id],
  }),
}));

export const activityEmbeddingsRelations = relations(activityEmbeddings, ({ one }) => ({
  user: one(users, {
    fields: [activityEmbeddings.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [activityEmbeddings.activityId],
    references: [activities.id],
  }),
}));
