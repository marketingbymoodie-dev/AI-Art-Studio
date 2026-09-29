/**
 * Code-level definitions of pack-only styles (style packs, shared/stylePacks.ts).
 * Same role as STYLE_PRESETS for the classic catalog, but never read by the
 * boot seeding (`ensureCatalogStylesForAllMerchants`): pack rows are only
 * provisioned for merchants explicitly assigned a pack
 * (server/style-packs.ts provisionPackStylesForMerchant).
 *
 * Deliberately free of schema imports (styleCatalog ↔ schema cycle).
 */
import { PETPOSTEROUS_PACK_SLUG, PETPOSTEROUS_STYLES } from "./packs/petposterous";

export type PackStyleOptionChoice = { id: string; name: string; promptFragment: string };

export type PackStyleDefinition = {
  /** catalog_slug of the provisioned row. */
  id: string;
  name: string;
  category: "all" | "apparel" | "decor";
  /** The style's creative scenario only; shared layers come from the pack profile. */
  promptPrefix: string;
  promptPlaceholder?: string;
  descriptionOptional?: boolean;
  options?: { label: string; required: boolean; choices: PackStyleOptionChoice[] };
  /** StyleInputCapabilities (shared/stylePacks.ts), stored in style_presets.input_capabilities. */
  inputCapabilities: Record<string, unknown>;
  generationModel: string | null;
  generationModelDecor: string | null;
  generationQuality?: string | null;
  /** Shown to customers at launch; false = provisioned inactive. */
  launchActive: boolean;
};

export const PACK_STYLE_CATALOG: Record<string, PackStyleDefinition[]> = {
  [PETPOSTEROUS_PACK_SLUG]: PETPOSTEROUS_STYLES,
};

const BY_SLUG = new Map<string, PackStyleDefinition>();
for (const defs of Object.values(PACK_STYLE_CATALOG)) {
  for (const d of defs) BY_SLUG.set(d.id, d);
}

export function findPackStyleDefinition(slug: string | null | undefined): PackStyleDefinition | undefined {
  const key = String(slug || "").trim().toLowerCase();
  return key ? BY_SLUG.get(key) : undefined;
}

export function isPackCatalogSlug(slug: string | null | undefined): boolean {
  return !!findPackStyleDefinition(slug);
}
