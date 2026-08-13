/**
 * Shared types for the AI coach chat endpoint (`/api/ai/chat`).
 *
 * The request carries the running transcript as `ChatMessage[]`; the response
 * is NDJSON where every line is a `ChatReply` fragment. A reply is a
 * discriminated union (issue #221): a `text` fragment carries a token of the
 * streamed answer (clients concatenate `content` across lines), while a `block`
 * fragment carries a piece of generative UI (a clickable activity card, a
 * workout card) built from tool output — never from the model's free text, so
 * the numbers can't be fabricated. Text and blocks can interleave in one answer.
 *
 * Backward compatibility: a legacy NDJSON line without a `type` field is treated
 * as `{ type: "text", content }` by clients (see ChatPanel.parseLine).
 */

import { z } from "zod";
import type { WorkoutCardView } from "@/lib/coach/dashboard";

export type ChatRole = "user" | "assistant";

/** One turn in the chat transcript sent by the client. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Client-generated idempotency id for the user turn. Sent back on retry so
   * the route can skip persisting a turn that already exists (issue #205).
   */
  clientMessageId?: string;
}

/**
 * A lightweight, persistable reference to a generative-UI block stored in the
 * chat history (issue #228). Only activity references are kept: rehydrating
 * from the current activity row keeps the card in sync with deletions/edits.
 * Workout blocks are intentionally omitted because they are time-sensitive and
 * would be stale on replay.
 */
export type ChatBlockReference = { kind: "activity"; id: string };

/** Zod schema for validating a JSONB column of block references on read. */
export const chatBlockReferenceSchema = z.array(
  z.object({
    kind: z.literal("activity"),
    id: z.string(),
  })
);

/**
 * An activity rendered as a clickable card in the coach chat (issue #221). The
 * same shape as {@link CoachChatActivity} but with the `id` needed to link to
 * the activity's detail page; `startDate` is an ISO string on the wire.
 */
export interface ChatActivity {
  /** DB cuid or demo id ("demo-01") — the `activityRoute(id)` link target. */
  id: string;
  type: string;
  /** ISO 8601 start timestamp. */
  startDate: string;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  averageHeartrate: number | null;
}

/**
 * A piece of generative UI attached to an assistant turn (issue #221). Blocks
 * are built server-side from validated tool output, so the model orchestrates
 * which tool runs but never authors the block's contents.
 *
 * The workout block carries {@link WorkoutCardView} — the recommendation as the
 * dashboard renders it — so it feeds the existing `coach-dashboard/WorkoutCard`
 * unchanged.
 */
export type ChatBlock =
  | { kind: "activity"; activity: ChatActivity }
  | { kind: "workout"; workout: WorkoutCardView };

/** One streamed NDJSON line of the assistant's reply. */
export type ChatReply =
  | { role: "assistant"; type: "text"; content: string }
  | { role: "assistant"; type: "block"; block: ChatBlock };
