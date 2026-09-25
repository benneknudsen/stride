import { relations } from "drizzle-orm";
import { activities, stravaTokens, users } from "./schema";

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
}));

export const stravaTokensRelations = relations(stravaTokens, ({ one }) => ({
  user: one(users, {
    fields: [stravaTokens.userId],
    references: [users.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  user: one(users, {
    fields: [activities.userId],
    references: [users.id],
  }),
}));
