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
import { createHarmonyFilter, stripHarmony } from "@/lib/ai/harmony";

describe("stripHarmony", () => {
  it("keeps only the final channel and drops thought + control tokens", () => {
    const raw =
      "<|channel|>thought<|channel|>internal reasoning<|channel|>final<|channel|>actual answer<|end|>";
    expect(stripHarmony(raw)).toBe("actual answer");
  });

  it("leaves text without any markers unchanged", () => {
    expect(stripHarmony("Hej Benjamin!")).toBe("Hej Benjamin!");
  });

  it("keeps the content when a thought marker leaks but no final channel follows", () => {
    // The real #222 leak: a spurious thought header in front of the only answer.
    // Dropping the whole channel would show the user nothing, so the mis-tagged
    // content is flushed with its markers stripped.
    expect(stripHarmony("<|channel|>thought<|channel|>Dit seneste løb blev registreret.")).toBe(
      "Dit seneste løb blev registreret."
    );
  });

  it("handles the full harmony framing with start/message/end tokens", () => {
    const raw =
      "<|start|>assistant<|channel|>analysis<|message|>reasoning<|end|>" +
      "<|start|>assistant<|channel|>final<|message|>Kør et roligt pas.<|end|>";
    expect(stripHarmony(raw)).toBe("Kør et roligt pas.");
  });

  it("strips malformed fragments that are missing a pipe", () => {
    expect(stripHarmony("<channel|>Dit svar.")).toBe("Dit svar.");
  });
});

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
