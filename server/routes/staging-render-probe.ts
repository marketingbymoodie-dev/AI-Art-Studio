/**
 * Staging-only render probe (QA tooling).
 *
 * Sends a prompt VERBATIM to a configured direct renderer on the Petposterous
 * dedicated Google credential — no prompt layers, decor rules or storage — so a
 * model/API path can be isolated from our prompt stack. 404 unless the Railway
 * environment is staging AND STAGING_PROBE_TOKEN is set and matches. Never in
 * production. Usage is recorded in generation_events (route "staging-render-probe").
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import {
  GOOGLE_RENDERERS,
  applyRendererOverride,
  readCredential,
  resolveGenerationPlan,
  type DirectGoogleImagePath,
  type GoogleImageSize,
} from "../generation-providers";
import { estimateGoogleImageCostUsd, renderGoogleImage } from "../google-image-client";
import { recordGenerationEvent } from "../generation-events";

export function stagingProbeAllowed(req: Pick<Request, "get">, env: Record<string, string | undefined> = process.env): boolean {
  const envName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
  const expected = env.STAGING_PROBE_TOKEN ?? "";
  const got = req.get("x-appai-probe-token") ?? "";
  if (envName !== "staging" || expected.length < 24 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export function registerStagingRenderProbeRoutes(app: Express): void {
  app.post("/api/staging/render-probe", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const aspectRatio = typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : "4:3";
    const imageSize = (["1K", "2K", "4K"].includes(req.body?.imageSize) ? req.body.imageSize : "2K") as GoogleImageSize;
    const rendererId = typeof req.body?.renderer === "string" && GOOGLE_RENDERERS[req.body.renderer] ? req.body.renderer : "google-nb2";
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const plan = applyRendererOverride(
      resolveGenerationPlan({ packProfileKey: "petposterous", productFamily: "poster", isApparel: false }),
      rendererId,
    );
    const path = plan.imagePath as DirectGoogleImagePath;
    const started = Date.now();
    try {
      const apiKey = readCredential(path.credential);
      const result = await renderGoogleImage({
        apiKey,
        credential: path.credential,
        renderer: path.renderer,
        prompt,
        aspectRatio,
        imageSize,
      });
      const meta = await sharp(Buffer.from(result.data, "base64")).metadata();
      const estimatedCostUsd = estimateGoogleImageCostUsd(result.usage, path.renderer);
      void recordGenerationEvent(
        { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous", productFamily: "poster", plan },
        {
          success: true,
          durationMs: Date.now() - started,
          meta: {
            provider: "google",
            credentialRefId: path.credential.id,
            credentialScope: path.credential.scope,
            model: path.renderer.model,
            quality: imageSize,
            size: `${meta.width}x${meta.height}`,
            attempts: 1,
            durationMs: result.durationMs,
            transparent: null,
            transparentFraction: null,
            usage: result.usage,
            estimatedCostUsd,
            providerRequestId: result.requestId,
            providerMime: result.mimeType,
          },
        },
      );
      return res.json({
        model: path.renderer.model,
        credentialRef: path.credential.id,
        mimeType: result.mimeType,
        width: meta.width,
        height: meta.height,
        durationMs: result.durationMs,
        usage: result.usage,
        thoughtsTokens: result.thoughtsTokens,
        estimatedCostUsd,
        requestId: result.requestId,
        imageBase64: result.data,
      });
    } catch (err) {
      void recordGenerationEvent(
        { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous", productFamily: "poster", plan },
        { success: false, durationMs: Date.now() - started, error: err },
      );
      return res.status(502).json({ error: (err as Error)?.message ?? "probe failed" });
    }
  });
}
