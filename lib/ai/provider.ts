/**
 * Provider router with fallback.
 *
 * All model access goes through OpenRouter (via the OpenAI-compatible
 * provider from `@ai-sdk/openai`), so swapping models is a config change
 * (`AI_PRIMARY` / `AI_FALLBACK`) rather than a code change, and a single
 * `OPENROUTER_API_KEY` fronts every provider. Set `OPENROUTER_API_KEY` in
 * `.env.local`. The router exposes the primary model plus an ordered
 * fallback list; callers try them in order (see the analyze route).
 *
 * Per CLAUDE.md, AI keys NEVER reach the browser — this module is server-only
 * and is imported exclusively from `app/api/ai/*`.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/** Sensible defaults so the app runs with only `OPENROUTER_API_KEY` set. */
const DEFAULT_PRIMARY = "google/gemma-4-31b-it:free";
const DEFAULT_FALLBACK = "google/gemini-2.0-flash-001";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Whether a real AI provider is reachable. When false, the analyze route serves
 * a deterministic, data-driven heuristic analysis instead — so the public demo
 * works for portfolio visitors who never configure a key.
 */
export function isAIConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/** The configured primary and fallback model identifiers (OpenRouter routes them). */
export function getModelIds(): { primary: string; fallback: string } {
  return {
    primary: process.env.AI_PRIMARY?.trim() || DEFAULT_PRIMARY,
    fallback: process.env.AI_FALLBACK?.trim() || DEFAULT_FALLBACK,
  };
}

/** Resolve an OpenRouter model from its identifier, e.g. `"google/gemini-2.0-flash-001"`. */
export function resolveModel(modelId: string): LanguageModel {
  return openrouter(modelId);
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
