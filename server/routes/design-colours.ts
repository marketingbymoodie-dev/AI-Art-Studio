/**
 * Edit colours on one published design. Preview is the dry run. Apply queues
 * the change and returns before Shopify and Printify are touched.
 */
import type { Express, RequestHandler, Response } from "express";
import { ColourEditRefusal, planDesignColourEdit, readDesignColourChoices } from "../design-colour-edit";
import { enqueueColourEdit, readColourJob } from "../design-colour-jobs";

function names(body: unknown): string[] {
  const list = Array.isArray((body as { colours?: unknown })?.colours) ? (body as { colours: unknown[] }).colours : [];
  return list.map((name) => String(name || "").trim()).filter(Boolean);
}

function sendError(res: Response, err: unknown) {
  const reasons = err instanceof ColourEditRefusal && err.reasons.length
    ? err.reasons
    : [err instanceof Error ? err.message : String(err)];
  res.status(400).json({ error: reasons.join("\n"), reasons });
}

export function mountDesignColourRoutes(
  app: Express,
  prefix: string,
  authorize: (req: any, res: Response) => Promise<string | undefined | null>,
  pre: RequestHandler[] = [],
) {
  app.get(`${prefix}/:id/colours`, ...pre, async (req, res) => {
    const shop = await authorize(req, res);
    if (shop === null) return;
    try {
      res.json(await readDesignColourChoices(String(req.params.id), shop));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(`${prefix}/:id/colours/preview`, ...pre, async (req, res) => {
    const shop = await authorize(req, res);
    if (shop === null) return;
    try {
      res.json(await planDesignColourEdit(String(req.params.id), names(req.body), shop));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(`${prefix}/:id/colours`, ...pre, async (req, res) => {
    const shop = await authorize(req, res);
    if (shop === null) return;
    try {
      const id = String(req.params.id);
      const plan = await planDesignColourEdit(id, names(req.body), shop);
      if (plan.blockers.length) {
        res.status(400).json({ error: plan.blockers.join("\n"), reasons: plan.blockers, plan });
        return;
      }
      const job = await enqueueColourEdit(id, names(req.body), plan);
      res.json({ ...job, plan });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get(`${prefix}/:id/colours/job`, ...pre, async (req, res) => {
    const shop = await authorize(req, res);
    if (shop === null) return;
    try {
      await readDesignColourChoices(String(req.params.id), shop);
      res.json({ job: await readColourJob(String(req.params.id)) });
    } catch (err) {
      sendError(res, err);
    }
  });
}
