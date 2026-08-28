/**
 * Unit tests for the harmony control-token sanitiser (issue #222).
 *
 * The gpt-oss / harmony model family occasionally leaks its internal channel
 * framing (`<|channel|>thought<|channel|>…<|end|>`) into the plain text stream.
 * These tests pin the two things the coach route relies on: control tokens are
 * stripped, and the model's private "thought"/"analysis" reasoning never
 * survives when a real `final` answer is present — including when a marker is
 * split across two streamed chunks.
 */

import { describe, expect, it } from "vitest";
import { createHarmonyFilter } from "@/lib/ai/harmony";

describe("createHarmonyFilter", () => {
  it("catches a marker split across two chunks", () => {
    const filter = createHarmonyFilter();
    // The opening thought marker is split mid-token between the two deltas.
    const out =
      filter.push("<|chan") +
      filter.push("nel|>thought<|channel|>reasoning<|channel|>final<|channel|>svaret<|end|>") +
      filter.flush();
    expect(out).toBe("svaret");
  });

  it("streams final-channel text delta by delta without holding it back", () => {
    const filter = createHarmonyFilter();
    let out = "";
    out += filter.push("<|channel|>final<|channel|>Du ");
    out += filter.push("skal ");
    out += filter.push("løbe 5 km.");
    out += filter.flush();
    expect(out).toBe("Du skal løbe 5 km.");
  });
});
