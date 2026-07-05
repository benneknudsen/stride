import { describe, expect, it } from "vitest";
import authConfig from "@/auth.config";

const jwt = authConfig.callbacks?.jwt;
const session = authConfig.callbacks?.session;

// Minimal stand-ins for the NextAuth callback args we exercise.
const user = { id: "u1", email: "a@b.com" };

describe("auth.config jwt callback (session-fixation rotation)", () => {
  it("mints a fresh sid on initial sign-in", async () => {
    const token = await jwt?.({ token: {}, user } as never);
    expect(typeof (token as { sid?: unknown }).sid).toBe("string");
    expect((token as { sid: string }).sid.length).toBeGreaterThan(0);
  });

  it("rotates sid on explicit session update", async () => {
    const first = (await jwt?.({ token: {}, user } as never)) as { sid: string };
    const rotated = (await jwt?.({
      token: { sid: first.sid },
      trigger: "update",
    } as never)) as { sid: string };
    expect(rotated.sid).not.toBe(first.sid);
  });

  it("does not rotate sid on ordinary token refreshes", async () => {
    const existing = { sid: "keep-me", sub: "u1" };
    const token = (await jwt?.({ token: existing } as never)) as { sid: string };
    expect(token.sid).toBe("keep-me");
  });
});

describe("auth.config session callback", () => {
  it("copies token.sub onto session.user.id", async () => {
    const result = (await session?.({
      session: { user: { email: "a@b.com" } },
      token: { sub: "u1" },
    } as never)) as { user: { id: string } };
    expect(result.user.id).toBe("u1");
  });
});
