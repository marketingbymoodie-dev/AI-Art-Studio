/**
 * Style packs: curated, reusable sets of style presets a store/page can expose
 * (e.g. a niche store showing only its own creative styles).
 *
 * - Pack items are keyed by `catalog_slug` so one platform pack resolves to each
 *   merchant's own `style_presets` rows. `style_preset_id` covers custom rows.
 * - A style with visibility `pack_only` is never shown by category pages and may
 *   only be generated with through a pack assigned to its merchant.
 * - Nothing here is specific to any one pack.
 */

export const STYLE_VISIBILITY_PACK_ONLY = "pack_only";

export function isPackOnlyStyle(style: { visibility?: string | null } | null | undefined): boolean {
  return (style?.visibility ?? null) === STYLE_VISIBILITY_PACK_ONLY;
}

export type StylePackItemRef = {
  catalogSlug?: string | null;
  stylePresetId?: number | string | null;
  sortOrder?: number | null;
};

type PresetLike = { id: string | number; catalogSlug?: string | null };

function normSlug(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

/**
 * Map pack items onto one merchant's style rows, in pack order. Items the
 * merchant has no row for are skipped (the pack simply shows fewer styles).
 */
export function resolvePackPresetIds(items: StylePackItemRef[], presets: PresetLike[]): string[] {
  const bySlug = new Map<string, string>();
  const byId = new Set<string>();
  for (const p of presets) {
    const id = String(p.id);
    byId.add(id);
    const slug = normSlug(p.catalogSlug);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, id);
  }
  const ordered = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out: string[] = [];
  for (const item of ordered) {
    let id: string | undefined;
    if (item.stylePresetId != null && byId.has(String(item.stylePresetId))) {
      id = String(item.stylePresetId);
    } else {
      const slug = normSlug(item.catalogSlug);
      if (slug) id = bySlug.get(slug);
    }
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** True when a style row is a member of the pack (by row id or catalog slug). */
export function packContainsStyle(
  items: StylePackItemRef[],
  style: { id: string | number; catalogSlug?: string | null },
): boolean {
  const slug = normSlug(style.catalogSlug);
  return items.some(
    (i) =>
      (i.stylePresetId != null && String(i.stylePresetId) === String(style.id)) ||
      (!!slug && normSlug(i.catalogSlug) === slug),
  );
}

// ---------------------------------------------------------------------------
// Declarative per-style input capabilities
// ---------------------------------------------------------------------------

export type ReferenceRequirement = "optional" | "required" | "unsupported";

/** Photo roles a customer can tag an uploaded reference image with. */
export const REFERENCE_IMAGE_ROLES = ["pet", "owner", "other"] as const;
export type ReferenceImageRole = (typeof REFERENCE_IMAGE_ROLES)[number];

export type StyleInputCapabilities = {
  petPhoto: ReferenceRequirement;
  ownerPhoto: ReferenceRequirement;
  /** Selector support + default choice id (null = not offered). */
  humor: { supported: boolean; default: string | null };
  relationship: { supported: boolean; default: string | null };
};

function parseRequirement(v: unknown): ReferenceRequirement {
  return v === "required" || v === "unsupported" ? v : "optional";
}

function parseSelector(v: unknown): { supported: boolean; default: string | null } {
  if (!v || typeof v !== "object") return { supported: false, default: null };
  const o = v as Record<string, unknown>;
  return {
    supported: o.supported === true,
    default: typeof o.default === "string" && o.default.trim() ? o.default.trim() : null,
  };
}

/** Null column = legacy style: no declared capabilities, today's behaviour. */
export function parseStyleInputCapabilities(raw: unknown): StyleInputCapabilities | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    petPhoto: parseRequirement(o.petPhoto),
    ownerPhoto: parseRequirement(o.ownerPhoto),
    humor: parseSelector(o.humor),
    relationship: parseSelector(o.relationship),
  };
}

export type InputCapabilityError = {
  code: "REFERENCE_REQUIRED" | "REFERENCE_UNSUPPORTED";
  role: ReferenceImageRole;
  message: string;
};

const ROLE_LABEL: Record<ReferenceImageRole, string> = { pet: "pet photo", owner: "owner photo", other: "photo" };

/**
 * Check tagged reference images against a style's declared capabilities.
 * - `required` roles are always enforced (the style cannot work without them).
 * - `personalized` = the request asks for a likeness: it needs a pet photo when
 *   the style accepts one. Non-personalised concepts need no photo at all.
 * - `unsupported` roles are rejected rather than silently dropped.
 */
export function checkReferenceInputs(
  caps: StyleInputCapabilities | null,
  roles: ReferenceImageRole[],
  opts: { personalized: boolean },
): InputCapabilityError | null {
  if (!caps) return null;
  const has = (r: ReferenceImageRole) => roles.includes(r);
  const pairs: Array<[ReferenceImageRole, ReferenceRequirement]> = [
    ["pet", caps.petPhoto],
    ["owner", caps.ownerPhoto],
  ];
  for (const [role, req] of pairs) {
    if (req === "unsupported" && has(role)) {
      return { code: "REFERENCE_UNSUPPORTED", role, message: `This style doesn't use a ${ROLE_LABEL[role]}.` };
    }
  }
  for (const [role, req] of pairs) {
    if (req === "required" && !has(role)) {
      return { code: "REFERENCE_REQUIRED", role, message: `Add a ${ROLE_LABEL[role]} for this style.` };
    }
  }
  if (opts.personalized && caps.petPhoto !== "unsupported" && !has("pet")) {
    return { code: "REFERENCE_REQUIRED", role: "pet", message: "Add a pet photo to personalise this design." };
  }
  return null;
}
