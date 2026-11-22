/**
 * Operator-only provider API key management (platform scope).
 *
 * Keys are write-only: requests carry plaintext once, responses only ever carry
 * last four + status. Gate = isAuthenticated + requirePlatformAdmin (same as the
 * other /api/platform routes). Request bodies are never logged.
 */
import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import { CREDENTIALS, credentialResolutionLog } from "../generation-providers";
import { credentialEncryptionConfigured } from "../credential-crypto";
import {
  CredentialInputError,
  disablePlatformCredential,
  listPlatformCredentials,
  revalidatePlatformCredential,
  savePlatformCredential,
} from "../credential-store";

function fail(res: Response, err: unknown, action: string) {
  if (err instanceof CredentialInputError) return res.status(400).json({ error: err.message });
  console.error(`[platform-credentials] ${action} failed:`, (err as Error)?.name ?? "error");
  return res.status(500).json({ error: `Could not ${action}. Check server logs.` });
}

export function registerPlatformCredentialRoutes(app: Express, deps: { isAuthenticated: any }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/credentials", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const encryptionConfigured = credentialEncryptionConfigured();
    let stored: Awaited<ReturnType<typeof listPlatformCredentials>> = [];
    let storeError: string | null = null;
    if (encryptionConfigured) {
      try {
        stored = await listPlatformCredentials();
      } catch (err) {
        console.error("[platform-credentials] list failed:", (err as Error)?.message);
        storeError = "Credential table unavailable — check the startup migration log.";
      }
    }
    const refs = Object.values(CREDENTIALS).map((ref) => {
      const last = credentialResolutionLog.get(ref.id) ?? null;
      return {
        id: ref.id,
        provider: ref.provider,
        scope: ref.scope,
        label: ref.label,
        envVar: ref.credentialKey,
        envPresent: !!process.env[ref.credentialKey]?.trim(),
        stored: stored.find((s) => s.credentialRef === ref.id) ?? null,
        lastResolved: last ? { source: last.source, at: last.at.toISOString() } : null,
      };
    });
    res.json({ encryptionConfigured, storeError, refs });
  });

  app.post("/api/platform/credentials", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const saved = await savePlatformCredential({
        credentialRef: String(req.body?.credentialRef ?? ""),
        key: String(req.body?.key ?? ""),
        createdBy: req.shopDomain ?? null,
      });
      res.json({ credential: saved });
    } catch (err) {
      fail(res, err, "save key");
    }
  });

  app.post("/api/platform/credentials/:id/validate", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const updated = await revalidatePlatformCredential(Number(req.params.id));
      if (!updated) return res.status(404).json({ error: "Key not found" });
      res.json({ credential: updated });
    } catch (err) {
      fail(res, err, "validate key");
    }
  });

  app.post("/api/platform/credentials/:id/disable", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const ok = await disablePlatformCredential(Number(req.params.id));
      if (!ok) return res.status(404).json({ error: "Key not found" });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "disable key");
    }
  });
}
