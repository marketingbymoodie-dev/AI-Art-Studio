/**
 * DB-backed provider credential source (operator-entered, encrypted at rest).
 *
 * Feeds readCredential() in generation-providers.ts at higher precedence than env
 * vars, keyed by the same credential ref id. Only scope = 'platform' is read or
 * written; 'shop' rows are reserved for merchant own-key mode.
 *
 * Plaintext keys are only held in this module's short-lived cache and returned to
 * readCredential(). Admin listings expose last four + status only. Provider probe
 * error text is redacted before it is stored or returned.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { providerCredentials, type ProviderCredentialRow } from "@shared/schema";
import { CREDENTIALS, redactSecrets, type ProviderId } from "./generation-providers";
import { credentialEncryptionConfigured, decryptSecret, encryptSecret, lastFour } from "./credential-crypto";

export type CredentialStatus = "active" | "invalid" | "unchecked" | "disabled";

const CACHE_TTL_MS = 30_000;
let cache: { at: number; keys: Map<string, string> } | null = null;
let loading: Promise<Map<string, string>> | null = null;

async function db() {
  return (await import("./db")).db;
}

export function invalidateCredentialCache(): void {
  cache = null;
}

async function loadActivePlatformKeys(): Promise<Map<string, string>> {
  const rows = await (await db())
    .select({ ref: providerCredentials.credentialRef, enc: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(and(eq(providerCredentials.scope, "platform"), eq(providerCredentials.status, "active")));
  const keys = new Map<string, string>();
  for (const r of rows) {
    try {
      keys.set(r.ref, decryptSecret(r.enc));
    } catch {
      console.error(`[credential-store] could not decrypt ${r.ref}; ignoring DB key (env fallback)`);
    }
  }
  return keys;
}

/** Active platform key for this ref, or null (store disabled, no row, or DB unreadable). */
export async function getPlatformCredential(refId: string): Promise<string | null> {
  if (!credentialEncryptionConfigured()) return null;
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    loading ??= loadActivePlatformKeys()
      .then((keys) => {
        cache = { at: Date.now(), keys };
        return keys;
      })
      .catch((err) => {
        console.error("[credential-store] load failed; using env credentials:", (err as Error)?.message);
        cache = { at: Date.now(), keys: cache?.keys ?? new Map() };
        return cache.keys;
      })
      .finally(() => {
        loading = null;
      });
    await loading;
  }
  return cache?.keys.get(refId) ?? null;
}

// ---- validation probes (no image generation) --------------------------------

export type ProbeResult = { status: Exclude<CredentialStatus, "disabled">; error: string | null };

const PROBES: Record<ProviderId, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai: { url: "https://api.openai.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: (k) => ({ "x-goog-api-key": k }),
  },
  replicate: { url: "https://api.replicate.com/v1/account", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
};

export async function probeProviderKey(
  provider: ProviderId,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const probe = PROBES[provider];
  let res: Response;
  try {
    res = await fetchImpl(probe.url, { headers: probe.headers(key), signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return { status: "unchecked", error: redactSecrets(`Network error: ${(err as Error)?.message ?? err}`, key).slice(0, 300) };
  }
  if (res.ok) return { status: "active", error: null };
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = String(j?.error?.message ?? j?.detail ?? j?.title ?? text);
    } catch {
      detail = text;
    }
  } catch {
    /* body unreadable */
  }
  detail = redactSecrets(detail, key).replace(/\s+/g, " ").trim().slice(0, 300);
  // Google answers an invalid key with 400 API_KEY_INVALID rather than 401.
  const authFailure =
    res.status === 401 || res.status === 403 || (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail));
  return { status: authFailure ? "invalid" : "unchecked", error: `HTTP ${res.status}${detail ? ` — ${detail}` : ""}` };
}

// ---- admin operations -------------------------------------------------------

export type CredentialListItem = {
  id: number;
  provider: string;
  credentialRef: string;
  lastFour: string;
  status: string;
  lastValidatedAt: Date | null;
  lastValidationError: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toListItem(r: ProviderCredentialRow): CredentialListItem {
  return {
    id: r.id,
    provider: r.provider,
    credentialRef: r.credentialRef,
    lastFour: r.lastFour,
    status: r.status,
    lastValidatedAt: r.lastValidatedAt,
    lastValidationError: r.lastValidationError,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Live (non-disabled) platform rows. Never includes ciphertext or plaintext. */
export async function listPlatformCredentials(): Promise<CredentialListItem[]> {
  const rows = await (await db())
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.scope, "platform"), ne(providerCredentials.status, "disabled")))
    .orderBy(desc(providerCredentials.updatedAt));
  return rows.map(toListItem);
}

export class CredentialInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialInputError";
  }
}

/** Add or replace the platform key for a ref: probe, encrypt, retire the previous live row, insert. */
export async function savePlatformCredential(input: {
  credentialRef: string;
  key: string;
  createdBy: string | null;
}): Promise<CredentialListItem> {
  const ref = CREDENTIALS[input.credentialRef];
  if (!ref) throw new CredentialInputError("Unknown credential ref");
  const key = String(input.key ?? "").trim();
  if (key.length < 16 || /\s/.test(key)) throw new CredentialInputError("That does not look like an API key");
  if (!credentialEncryptionConfigured()) throw new CredentialInputError("CREDENTIAL_ENCRYPTION_KEY is not configured on this server");

  const probe = await probeProviderKey(ref.provider, key);
  const encryptedKey = encryptSecret(key);
  const now = new Date();
  const d = await db();
  const row = await d.transaction(async (tx) => {
    await tx
      .update(providerCredentials)
      .set({ status: "disabled", updatedAt: now })
      .where(
        and(
          eq(providerCredentials.scope, "platform"),
          eq(providerCredentials.provider, ref.provider),
          eq(providerCredentials.credentialRef, ref.id),
          ne(providerCredentials.status, "disabled"),
        ),
      );
    const [inserted] = await tx
      .insert(providerCredentials)
      .values({
        provider: ref.provider,
        scope: "platform",
        shopId: null,
        credentialRef: ref.id,
        encryptedKey,
        lastFour: lastFour(key),
        status: probe.status,
        lastValidatedAt: probe.status === "unchecked" ? null : now,
        lastValidationError: probe.error,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return inserted;
  });
  invalidateCredentialCache();
  console.log(`[credential-store] saved ${ref.id} status=${probe.status} by=${input.createdBy ?? "unknown"}`);
  return toListItem(row);
}

async function platformRow(id: number): Promise<ProviderCredentialRow | null> {
  const [row] = await (await db())
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.id, id), eq(providerCredentials.scope, "platform")));
  return row ?? null;
}

export async function revalidatePlatformCredential(id: number): Promise<CredentialListItem | null> {
  const row = await platformRow(id);
  if (!row || row.status === "disabled") return null;
  let key: string;
  try {
    key = decryptSecret(row.encryptedKey);
  } catch {
    throw new CredentialInputError("Stored key cannot be decrypted with this server's CREDENTIAL_ENCRYPTION_KEY — replace it");
  }
  const probe = await probeProviderKey(row.provider as ProviderId, key);
  const now = new Date();
  const [updated] = await (await db())
    .update(providerCredentials)
    .set({
      status: probe.status,
      lastValidatedAt: probe.status === "unchecked" ? row.lastValidatedAt : now,
      lastValidationError: probe.error,
      updatedAt: now,
    })
    .where(eq(providerCredentials.id, id))
    .returning();
  invalidateCredentialCache();
  console.log(`[credential-store] revalidated ${row.credentialRef} status=${probe.status}`);
  return toListItem(updated);
}

export async function disablePlatformCredential(id: number): Promise<boolean> {
  const row = await platformRow(id);
  if (!row || row.status === "disabled") return false;
  await (await db())
    .update(providerCredentials)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(providerCredentials.id, id));
  invalidateCredentialCache();
  console.log(`[credential-store] disabled ${row.credentialRef}`);
  return true;
}
