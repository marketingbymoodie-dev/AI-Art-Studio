/**
 * Report-only catalog style ↔ model audit.
 * Does not write generationModel. Catalog default is nano-banana when unset.
 */
import { isGptImage2Model } from "./styleGeneration";

export type CatalogBaseKind = "full-bleed" | "floating-transparent" | "apparel" | "custom";
export type CatalogModelLabel = "GPT-Image-2" | "nano-banana" | "other";

export type CatalogStyleAuditRow = {
  name: string;
  slug: string;
  currentModel: CatalogModelLabel;
  base: CatalogBaseKind;
  recommendedModel: CatalogModelLabel | null;
  mismatch: boolean;
  note?: string;
};

export function catalogModelLabel(generationModel?: string | null): CatalogModelLabel {
  if (!generationModel) return "nano-banana";
  if (isGptImage2Model(generationModel)) return "GPT-Image-2";
  return "other";
}

export function classifyCatalogStyleIntent(preset: {
  id: string;
  category: string;
  promptPrefix: string;
}): { base: CatalogBaseKind; recommendedModel: CatalogModelLabel | null; note?: string } {
  const cat = (preset.category || "").toLowerCase();
  const slug = (preset.id || "").trim().toLowerCase();
  if (slug === "none") {
    return { base: "custom", recommendedModel: null, note: "Custom prompt — no locked base." };
  }
  if (slug === "minimal-line") {
    return {
      base: "full-bleed",
      recommendedModel: "nano-banana",
      note:
        "Dual intent: stored catalog prefix is decor full-bleed (nano-banana matches). Apparel compose uses an isolated treatment that wants GPT-Image-2. Review per surface — do not treat as a hard catalog mismatch.",
    };
  }
  if (cat === "decor") return { base: "full-bleed", recommendedModel: "nano-banana" };
  if (cat === "graphics") return { base: "floating-transparent", recommendedModel: "GPT-Image-2" };
  if (cat === "apparel") return { base: "apparel", recommendedModel: "GPT-Image-2" };

  const prefix = (preset.promptPrefix || "").toLowerCase();
  if (
    prefix.includes("full-bleed") ||
    prefix.includes("edge-to-edge") ||
    prefix.includes("fills the entire canvas")
  ) {
    return { base: "full-bleed", recommendedModel: "nano-banana" };
  }
  if (
    prefix.includes("isolated") ||
    prefix.includes("transparent") ||
    prefix.includes("centered graphic")
  ) {
    return { base: "floating-transparent", recommendedModel: "GPT-Image-2" };
  }
  return { base: "custom", recommendedModel: null };
}

export function auditCatalogStyleModels(
  presets: ReadonlyArray<{
    id: string;
    name: string;
    category: string;
    promptPrefix: string;
    generationModel?: string | null;
  }>,
): CatalogStyleAuditRow[] {
  return presets.map((preset) => {
    const currentModel = catalogModelLabel(preset.generationModel);
    const intent = classifyCatalogStyleIntent(preset);
    const mismatch = Boolean(
      intent.recommendedModel &&
        currentModel !== "other" &&
        currentModel !== intent.recommendedModel,
    );
    return {
      name: preset.name,
      slug: preset.id,
      currentModel,
      base: intent.base,
      recommendedModel: intent.recommendedModel,
      mismatch,
      note: intent.note,
    };
  });
}
