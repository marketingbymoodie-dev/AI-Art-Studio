import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialEncryptionConfigured, decryptSecret, encryptSecret, lastFour } from "./credential-crypto";
import { probeProviderKey } from "./credential-store";

const env = { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
const SECRET = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789WXYZ";

describe("credential-crypto", () => {
  it("round-trips and never stores plaintext", () => {
    const ct = encryptSecret(SECRET, env);
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct).not.toContain(SECRET);
    expect(ct).not.toContain("WXYZ");
    expect(decryptSecret(ct, env)).toBe(SECRET);
    expect(encryptSecret(SECRET, env)).not.toBe(ct);
  });

  it("rejects a wrong key and tampered ciphertext without echoing plaintext", () => {
    const ct = encryptSecret(SECRET, env);
    const other = { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    expect(() => decryptSecret(ct, other)).toThrow();
    const parts = ct.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    try {
      decryptSecret(parts.join(":"), env);
      throw new Error("should not decrypt");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(SECRET);
    }
  });

  it("is disabled without a valid 32-byte key", () => {
    expect(credentialEncryptionConfigured({})).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: "short" })).toBe(false);
    expect(() => encryptSecret(SECRET, {})).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    expect(lastFour(SECRET)).toBe("WXYZ");
  });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;
}

describe("probeProviderKey", () => {
  it("2xx → active", async () => {
    expect(await probeProviderKey("openai", SECRET, fakeFetch(200, { data: [] }))).toEqual({ status: "active", error: null });
  });

  it("401 → invalid with the provider reason, key redacted", async () => {
    const r = await probeProviderKey(
      "openai",
      SECRET,
      fakeFetch(401, { error: { message: `Incorrect API key provided: ${SECRET}.` } }),
    );
    expect(r.status).toBe("invalid");
    expect(r.error).toMatch(/HTTP 401/);
    expect(r.error).toMatch(/Incorrect API key/);
    expect(r.error).not.toContain(SECRET);
  });

  it("Google 400 API_KEY_INVALID → invalid", async () => {
    const key = "AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY12";
    const r = await probeProviderKey(
      "google",
      key,
      fakeFetch(400, { error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }),
    );
    expect(r.status).toBe("invalid");
  });

  it("5xx / network → unchecked (retryable)", async () => {
    expect((await probeProviderKey("replicate", SECRET, fakeFetch(503, "upstream down"))).status).toBe("unchecked");
    const boom = (async () => {
      throw new Error(`connect ECONNREFUSED ${SECRET}`);
    }) as typeof fetch;
    const r = await probeProviderKey("replicate", SECRET, boom);
    expect(r.status).toBe("unchecked");
    expect(r.error).not.toContain(SECRET);
  });
});
