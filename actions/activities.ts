"use server";

import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { activities } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type Activity = InferSelectModel<typeof activities>;

export async function getActivities(opts?: {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}): Promise<Activity[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const conditions = [eq(activities.userId, userId)];

  if (opts?.from) conditions.push(gte(activities.startDate, opts.from));
  if (opts?.to) conditions.push(lte(activities.startDate, opts.to));

  return db
    .select()
    .from(activities)
    .where(and(...conditions))
    .orderBy(desc(activities.startDate))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function getActivity(id: string): Promise<Activity | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.userId, session.user.id)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getRecentActivities(limit = 10): Promise<Activity[]> {
  return getActivities({ limit });
}
