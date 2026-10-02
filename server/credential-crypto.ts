/**
 * AES-256-GCM for provider API keys at rest (provider_credentials.encrypted_key).
 *
 * The data key is CREDENTIAL_ENCRYPTION_KEY (32 bytes, base64) — a Railway secret,
 * never in the DB or repo. Missing/invalid key → store disabled (callers fall back
 * to env-var credentials). Ciphertext format: `v1:<iv>:<tag>:<ciphertext>` (base64).
 * Plaintext never leaves this module except as the return value of decryptSecret().
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function dataKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function credentialEncryptionConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return dataKey(env) !== null;
}

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super("CREDENTIAL_ENCRYPTION_KEY is not configured (32-byte base64)");
    this.name = "CredentialEncryptionUnavailableError";
  }
}

export function encryptSecret(plaintext: string, env: Record<string, string | undefined> = process.env): string {
  const key = dataKey(env);
  if (!key) throw new CredentialEncryptionUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Throws on a wrong key, tampered ciphertext or unknown version. Error text never contains plaintext. */
export function decryptSecret(stored: string, env: Record<string, string | undefined> = process.env): string {
  const key = dataKey(env);
  if (!key) throw new CredentialEncryptionUnavailableError();
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unrecognised credential ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

export function lastFour(secret: string): string {
  return secret.trim().slice(-4);
}
