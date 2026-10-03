import { describe, expect, it } from "vitest";
import express from "express";
import { registerStagingRenderProbeRoutes, stagingProbeAllowed } from "./routes/staging-render-probe";

const TOKEN = "probe-token-0123456789abcdefghij";
const req = (token?: string) => ({ get: (h: string) => (h === "x-appai-probe-token" ? token : undefined) }) as any;

describe("staging render probe gate", () => {
  it("allows only staging with the exact configured token", () => {
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(true);
  });
  it("is closed in production, without a token, with a short token, or a wrong token", () => {
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "production", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "Staging" })).toBe(false);
    expect(stagingProbeAllowed(req("short"), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: "short" })).toBe(false);
    expect(stagingProbeAllowed(req(TOKEN.replace("0", "X")), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
    expect(stagingProbeAllowed(req(undefined), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
  });

  it("serves the style-example form only on staging", async () => {
    const app = express();
    app.use(express.json());
    registerStagingRenderProbeRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const prevName = process.env.RAILWAY_ENVIRONMENT_NAME;
    const prevToken = process.env.STAGING_PROBE_TOKEN;
    try {
      process.env.RAILWAY_ENVIRONMENT_NAME = "production";
      process.env.STAGING_PROBE_TOKEN = TOKEN;
      expect((await fetch(`http://127.0.0.1:${port}/staging/render-probe`)).status).toBe(404);
      process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      const page = await fetch(`http://127.0.0.1:${port}/staging/render-probe`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Style example batch");
      expect(html).toContain("editorial-deadpan");
      expect(html).toContain("Domestic Cinema");
      expect(html).toContain("pp-petty-crimes");
      expect(html).not.toContain("/*__CATALOG__*/");
      const denied = await fetch(`http://127.0.0.1:${port}/api/staging/render-probe/style-batch/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(denied.status).toBe(404);
    } finally {
      if (prevName === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
      else process.env.RAILWAY_ENVIRONMENT_NAME = prevName;
      if (prevToken === undefined) delete process.env.STAGING_PROBE_TOKEN;
      else process.env.STAGING_PROBE_TOKEN = prevToken;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

import sharp from "sharp";
import { measureEdges } from "./routes/staging-render-probe";

describe("probe edge measurement", () => {
  it("flags a bare white margin and reads painted-to-edge content as low", async () => {
    const W = 400, H = 300;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const inner = x > 20 && x < W - 20 && y > 20 && y < H - 20;
      const v = inner ? [(x * 7) % 200, (y * 5) % 180, ((x + y) * 3) % 220] : [250, 249, 246];
      raw.set(v, i);
    }
    const margin = await measureEdges(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    expect(margin.top.palePct).toBeGreaterThan(95);
    expect(margin.left.uniformPct).toBeGreaterThan(95);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set([(x * 7) % 200, (y * 5) % 180, ((x + y) * 3) % 220], (y * W + x) * 3);
    const bleed = await measureEdges(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    expect(bleed.top.palePct).toBe(0);
    expect(bleed.top.uniformPct).toBeLessThan(40);
  });
});
