/**
 * GET /api/cron/chat-retention — scheduled coach-chat retention sweep (issue #229).
 *
 * The scheduled counterpart to the chat route's opportunistic cleanup: it drops
 * `chat_messages` rows older than the retention window across ALL users, so an
 * inactive user's history is removed even though they never trigger a new turn.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so the endpoint
 * requires that shared secret. Without a configured secret the route refuses to
 * run rather than exposing an unauthenticated deletion endpoint.
 */

import type { NextRequest } from "next/server";
import { deleteAllExpiredChatMessages } from "@/lib/db/queries";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "not_configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteAllExpiredChatMessages();
    return Response.json({ deleted });
  } catch (err) {
    captureError("api.cron.chat_retention", err);
    return Response.json({ error: "sweep_failed" }, { status: 500 });
  }
}
