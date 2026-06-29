import { beforeAll, describe, expect, it } from "vitest";

// A deterministic 32-byte key (64 hex chars) must be present before the module
// reads it. crypto.ts reads process.env.ENCRYPTION_KEY lazily per call, so
// setting it here is sufficient.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const plaintext = "strava-oauth-access-token-12345";
    const { iv, authTag, encrypted } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, authTag)).toBe(plaintext);
  });

  it("round-trips an empty string", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const { iv, authTag, encrypted } = encrypt("");
    expect(decrypt(encrypted, iv, authTag)).toBe("");
  });

  it("round-trips unicode content", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const plaintext = "løb 🏃 5:00/km";
    const { iv, authTag, encrypted } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, authTag)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const a = encrypt("same-secret");
    const b = encrypt("same-secret");
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it("produces different ciphertexts for different plaintexts", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const a = encrypt("token-one");
    const b = encrypt("token-two");
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("throws when decrypting with a wrong authTag", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const { iv, encrypted } = encrypt("tamper-me");
    const badAuthTag = "00000000000000000000000000000000";
    expect(() => decrypt(encrypted, iv, badAuthTag)).toThrow();
  });

  it("throws when decrypting tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const { iv, authTag, encrypted } = encrypt("integrity");
    // Flip the first byte of the ciphertext.
    const firstByte = encrypted.slice(0, 2);
    const flipped = (Number.parseInt(firstByte, 16) ^ 0xff).toString(16).padStart(2, "0");
    const tampered = flipped + encrypted.slice(2);
    expect(() => decrypt(tampered, iv, authTag)).toThrow();
  });
});
