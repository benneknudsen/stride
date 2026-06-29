/**
 * Provider router with fallback.
 *
 * All model access goes through the Vercel AI Gateway (`ai`'s built-in
 * `gateway`), so swapping providers is a config change (`AI_PRIMARY` /
 * `AI_FALLBACK`) rather than a code change, and a single `AI_GATEWAY_API_KEY`
 * fronts every provider. The router exposes the primary model plus an ordered
 * fallback list; callers try them in order (see the analyze route).
 *
 * Per CLAUDE.md, AI keys NEVER reach the browser — this module is server-only
 * and is imported exclusively from `app/api/ai/*`.
 */

import { gateway, type LanguageModel } from "ai";

/** Sensible defaults so the app runs with only `AI_GATEWAY_API_KEY` set. */
const DEFAULT_PRIMARY = "anthropic/claude-haiku-4-5";
const DEFAULT_FALLBACK = "openai/gpt-4o-mini";

/**
 * Whether a real AI provider is reachable. When false, the analyze route serves
 * a deterministic, data-driven heuristic analysis instead — so the public demo
 * works for portfolio visitors who never configure a key.
 */
export function isAIConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

/** The configured primary and fallback model identifiers (gateway routes them). */
export function getModelIds(): { primary: string; fallback: string } {
  return {
    primary: process.env.AI_PRIMARY?.trim() || DEFAULT_PRIMARY,
    fallback: process.env.AI_FALLBACK?.trim() || DEFAULT_FALLBACK,
  };
}

/** Resolve a gateway model from its identifier, e.g. `"openai/gpt-4o-mini"`. */
export function resolveModel(modelId: string): LanguageModel {
  return gateway(modelId);
}

/**
 * The ordered list of `{ id, model }` candidates to attempt, primary first.
 * Deduplicated so an identical primary/fallback isn't tried twice.
 */
export function getModelCandidates(): { id: string; model: LanguageModel }[] {
  const { primary, fallback } = getModelIds();
  const ids = primary === fallback ? [primary] : [primary, fallback];
  return ids.map((id) => ({ id, model: resolveModel(id) }));
}
