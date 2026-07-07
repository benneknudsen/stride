/**
 * Shared types for the AI coach chat endpoint (`/api/ai/chat`).
 *
 * The request carries the running transcript as `ChatMessage[]`; the response
 * is NDJSON where every line is a `ChatReply` fragment — clients concatenate
 * `content` across lines to rebuild the assistant's answer as it streams.
 */

export type ChatRole = "user" | "assistant";

/** One turn in the chat transcript sent by the client. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** One streamed NDJSON line of the assistant's reply. */
export interface ChatReply {
  role: "assistant";
  content: string;
}
