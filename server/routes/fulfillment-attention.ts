/** Platform-admin list of orders whose AppAI lines were not sent to Printify. */
import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import { listNeedsAttentionSubmissions } from "../fulfillment-attention";

type Auth = (req: any, res: any, next: any) => void;

export function registerFulfillmentAttentionRoutes(app: Express, deps: { isAuthenticated: Auth }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/fulfillment-attention", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json({
        submissions: await listNeedsAttentionSubmissions({
          shop: typeof req.query.shop === "string" ? req.query.shop : null,
          includeTests: req.query.includeTests === "1",
          limit: Number(req.query.limit) || 100,
        }),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
