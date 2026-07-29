"use server";

import { auth } from "@/lib/auth";
import { deleteAllChatMessages } from "@/lib/db/queries";
import { captureError } from "@/lib/observability";

// Server action backing the "Ryd samtale nu" link (issue #229). Same pattern as
// actions/race.ts: the user is derived from the session — a server action is a
// callable RPC endpoint, so a client-supplied id is never trusted.

export type ClearChatHistoryResult = { ok: true } | { ok: false; error: string };

/**
 * Delete every coach-chat message the signed-in user owns. Low-risk by design
 * (the history is ephemeral and re-buildable from scratch), so there is no
 * confirmation step — the client resets its transcript to the opening bubble on
 * success.
 */
export async function clearChatHistory(): Promise<ClearChatHistoryResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Du skal være logget ind." };

  try {
    await deleteAllChatMessages(userId);
    return { ok: true };
  } catch (err) {
    captureError("actions.clearChatHistory", err);
    return { ok: false, error: "Kunne ikke rydde samtalen — prøv igen." };
  }
}
