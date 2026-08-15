import { storage } from "./storage";
import {
  pickFlatOrderArtworkUrl,
  resolveGenerationJobIdForOrderLine,
  usablePrintArtworkUrl,
} from "./flat-order-fulfillment";
import type { CreatorCartLine, CreatorCartResult } from "./shopify-storefront";

function parseDesignState(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Resolve the print file for each cart line from the generation job (not the checkout mockup). */
export async function enrichCreatorCartPrintFiles(
  cart: CreatorCartResult,
): Promise<CreatorCartResult> {
  const lines: CreatorCartLine[] = await Promise.all(
    cart.lines.map(async (line) => {
      const attrArt = usablePrintArtworkUrl(line.artworkUrl);
      const jobId = resolveGenerationJobIdForOrderLine({
        lineJobId: line.jobId,
        lineDesignId: line.attributes.find((a) => a.key === "_design_id")?.value,
      });
      let artworkUrl = attrArt;
      if (!artworkUrl && jobId) {
        const job = await storage.getGenerationJob(jobId).catch(() => null);
        if (job) {
          const designState = parseDesignState(job.designState);
          artworkUrl = pickFlatOrderArtworkUrl({
            flatPlacerArtworkUrl: designState?.flatPlacerState?.artworkUrl,
            jobDesignImageUrl: job.designImageUrl as string | null,
          });
        }
      }
      return {
        ...line,
        jobId: jobId || line.jobId,
        artworkUrl: artworkUrl || null,
        printReady: !!(jobId && artworkUrl),
      };
    }),
  );
  return { ...cart, lines };
}
