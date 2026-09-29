/**
 * Customer reference images with optional roles ("this is the pet", "this is
 * the owner"). The generate routes accept three payload shapes:
 *   referenceImages: string[]                                  (legacy, unchanged)
 *   referenceImages: [{ url, role?, label? }]                  (role-tagged)
 *   referenceImage:  string                                    (oldest single form)
 * Models receive a plain ordered URL array either way; roles only reach the
 * model through the numbered instruction below (pack generations only).
 */
import { REFERENCE_IMAGE_ROLES, type ReferenceImageRole } from "./stylePacks";

export const MAX_REFERENCE_IMAGES = 5;

export type TaggedReferenceImage = {
  url: string;
  role: ReferenceImageRole;
  /** Customer-given name, e.g. the pet's name. */
  label: string | null;
};

function parseRole(v: unknown): ReferenceImageRole {
  return typeof v === "string" && (REFERENCE_IMAGE_ROLES as readonly string[]).includes(v)
    ? (v as ReferenceImageRole)
    : "other";
}

function parseLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, 40);
  return t || null;
}

/** Normalise any accepted payload shape; order preserved, capped at 5, empty entries dropped. */
export function normalizeReferenceImages(
  referenceImages: unknown,
  referenceImage?: unknown,
): TaggedReferenceImage[] {
  const raw: unknown[] =
    Array.isArray(referenceImages) && referenceImages.length > 0
      ? referenceImages
      : typeof referenceImage === "string" && referenceImage
        ? [referenceImage]
        : [];
  const out: TaggedReferenceImage[] = [];
  for (const item of raw) {
    if (out.length >= MAX_REFERENCE_IMAGES) break;
    if (typeof item === "string") {
      if (item) out.push({ url: item, role: "other", label: null });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url : "";
      if (url) out.push({ url, role: parseRole(o.role), label: parseLabel(o.label) });
    }
  }
  return out;
}

const ROLE_LINE: Record<ReferenceImageRole, (label: string | null) => string> = {
  pet: (label) =>
    `the customer's pet${label ? ` (${label})` : ""} — the main subject; keep it recognisably this exact animal`,
  owner: (label) =>
    `the pet's owner${label ? ` (${label})` : ""} — keep this person recognisable`,
  other: () => "a customer subject — incorporate it as a focal element",
};

/**
 * Numbered role block for the images in the exact order the model receives
 * them (style references first, then customer images). Identity rules follow
 * only when a pet or owner photo is present.
 */
export function buildRoleReferenceInstruction(opts: {
  styleImageCount: number;
  customerImages: Array<Pick<TaggedReferenceImage, "role" | "label">>;
  identityRules?: string | null;
}): string {
  const lines: string[] = [];
  let n = 0;
  for (let i = 0; i < opts.styleImageCount; i++) {
    n++;
    lines.push(`Image ${n}: style reference — use for look and composition only; its subjects are not the customer's.`);
  }
  for (const img of opts.customerImages) {
    n++;
    lines.push(`Image ${n}: ${ROLE_LINE[img.role](img.label)}.`);
  }
  if (n === 0) return "";
  const hasIdentity = opts.customerImages.some((i) => i.role === "pet" || i.role === "owner");
  const rules = hasIdentity ? (opts.identityRules || "").trim() : "";
  return [`REFERENCE IMAGES (${n}, in order):`, ...lines, "Do not duplicate subjects.", rules]
    .filter(Boolean)
    .join("\n");
}
