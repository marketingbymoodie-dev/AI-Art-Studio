/**
 * Colour blanks live inside the mockup library.
 * Approve and Link are the only writes to panel rows. Products and variants are not touched.
 */
import type { Express, RequestHandler, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  approveColourBlank,
  colourBlankGrid,
  createColourBlank,
  linkColourBlank,
  paintColourBlank,
  previewColourUpload,
  restoreBlankRevision,
  saveColourBlank,
  setColourActive,
  signedBlankPhoto,
  uploadColourBlank,
} from "../colour-blanks";
import { approveNewScene, deleteUnusedScene, previewNewScene } from "../mockup-library-store";

function operatorId(req: any): string | null {
  const id = req.user?.claims?.sub || req.user?.id;
  return id ? String(id) : null;
}

function typeId(raw: unknown): number {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 54;
}

export function registerColourBlankRoutes(app: Express, deps: { isAuthenticated: RequestHandler }) {
  const { isAuthenticated } = deps;

  app.get("/api/platform/catalogue-studio/colour-blanks", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await colourBlankGrid(typeId(req.query.productTypeId)));
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.patch("/api/platform/catalogue-studio/colour-blanks/colours/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const option = req.body?.printifyOptionId;
      res.json(await saveColourBlank(String(req.params.id), {
        name: String(req.body?.name || ""),
        printifyTitle: String(req.body?.printifyTitle || ""),
        printifyOptionId: option === "" || option == null ? null : Number(option),
        hex: String(req.body?.hex || ""),
        finish: String(req.body?.finish || ""),
        linkStoredName: req.body?.linkStoredName ? String(req.body.linkStoredName) : null,
      }));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/colours/:id/active", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await setColourActive(String(req.params.id), req.body?.active === true));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/colours", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const option = req.body?.printifyOptionId;
      res.json(await createColourBlank(typeId(req.body?.productTypeId), {
        name: String(req.body?.name || ""),
        printifyTitle: String(req.body?.printifyTitle || ""),
        printifyOptionId: option === "" || option == null ? null : Number(option),
        hex: String(req.body?.hex || ""),
        finish: String(req.body?.finish || "solid"),
        linkStoredName: req.body?.linkStoredName ? String(req.body.linkStoredName) : null,
      }));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/paint", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await paintColourBlank(String(req.body?.colourId || ""), String(req.body?.panelId || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/approve", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await approveColourBlank(String(req.body?.colourId || ""), String(req.body?.panelId || ""), operatorId(req)));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/upload-preview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await previewColourUpload(String(req.body?.colourId || ""), String(req.body?.panelId || ""), String(req.body?.imageBase64 || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/upload", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await uploadColourBlank({
        colourId: String(req.body?.colourId || ""),
        panelId: String(req.body?.panelId || ""),
        imageBase64: String(req.body?.imageBase64 || ""),
        uploadedBy: operatorId(req),
        confirmMask: req.body?.confirmMask === true,
      }));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/link", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await linkColourBlank(String(req.body?.colourId || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/rollback", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await restoreBlankRevision(String(req.body?.rowId || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/scene-preview", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await previewNewScene(String(req.body?.imageBase64 || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/scene-delete", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await deleteUnusedScene(typeId(req.body?.productTypeId), String(req.body?.panelId || "")));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/platform/catalogue-studio/colour-blanks/scene-approve", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await approveNewScene({
        productTypeId: typeId(req.body?.productTypeId),
        label: String(req.body?.label || ""),
        imageBase64: String(req.body?.imageBase64 || ""),
        widthOfH: Number(req.body?.widthOfH),
        heightOfH: Number(req.body?.heightOfH),
        topOfH: Number(req.body?.topOfH),
        uploadedBy: operatorId(req),
      }));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/platform/catalogue-studio/colour-blanks/rows/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      res.json(await signedBlankPhoto(String(req.params.id)));
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });
}
