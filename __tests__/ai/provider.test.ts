/**
 * Provider-routing tests for `lib/ai/provider.ts`.
 *
 * The one thing worth pinning here is the *API shape*. `@ai-sdk/openai` v3
 * binds the callable form of the provider (`openrouter(id)`) to OpenAI's
 * Responses API, and OpenRouter only speaks Chat Completions — so that form
 * makes every request fail with `Invalid Responses API request`, identically
 * for every model. It reads like a broken model or a dead key, and it costs a
 * deploy cycle to rediscover, which is exactly why it belongs in a test.
 */

import type { LanguageModel } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModelCandidates, getModelIds, isAIConfigured, resolveModel } from "@/lib/ai/provider";

/**
 * `LanguageModel` is `string | LanguageModelV3`; only the object form carries
 * the `.provider` binding ("openai.chat" vs "openai.responses"). A bare string
 * would mean the model was never resolved at all, so assert that first.
 */
function providerIdOf(model: LanguageModel): string {
  expect(typeof model).toBe("object");
  return (model as Exclude<LanguageModel, string>).provider;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI provider routing", () => {
  it("binds models to the Chat Completions API, never the Responses API", () => {
    expect(providerIdOf(resolveModel("google/gemma-4-26b-a4b-it"))).toBe("openai.chat");
    expect(providerIdOf(resolveModel("openai/gpt-4o-mini"))).toBe("openai.chat");
  });

  it("binds every routed candidate the same way", () => {
    for (const { model } of getModelCandidates()) {
      expect(providerIdOf(model)).toBe("openai.chat");
    }
  });

  it("returns primary and fallback as an ordered, deduplicated candidate list", () => {
    vi.stubEnv("AI_PRIMARY", "vendor/primary");
    vi.stubEnv("AI_FALLBACK", "vendor/fallback");
    expect(getModelCandidates().map((c) => c.id)).toEqual(["vendor/primary", "vendor/fallback"]);

    vi.stubEnv("AI_FALLBACK", "vendor/primary");
    expect(getModelCandidates().map((c) => c.id)).toEqual(["vendor/primary"]);
  });

  it("falls back to the built-in model ids when the env vars are blank", () => {
    vi.stubEnv("AI_PRIMARY", "   ");
    vi.stubEnv("AI_FALLBACK", "");
    const { primary, fallback } = getModelIds();
    expect(primary).toBeTruthy();
    expect(fallback).toBeTruthy();
    expect(primary).not.toBe(fallback);
  });

  it("reports configuration from a non-blank key only", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    expect(isAIConfigured()).toBe(true);
    vi.stubEnv("OPENROUTER_API_KEY", "   ");
    expect(isAIConfigured()).toBe(false);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(isAIConfigured()).toBe(false);
  });
});
