/**
 * Store experience profiles: how a store *presents* the shared customizer
 * (brand, a small set of copy strings, extra creative controls). Style packs
 * decide what can be generated; a profile only changes presentation.
 *
 * No profile (null) = the classic customizer, unchanged: every call site keeps
 * its existing literal as the fallback (`experienceCopy(profile, key, literal)`).
 */

/** High-value strings a store may override. Anything not listed stays hard-coded. */
export const EXPERIENCE_COPY_KEYS = [
  "savedDesignsLabel",
  "savedDesignsIntro",
  "accountHeading",
  "accountBody",
  "uploadLabel",
  "uploadCaption",
  "petUploadLabel",
  "ownerUploadLabel",
  "promptLabel",
  "promptPlaceholder",
  "conceptButtonLabel",
  "generateButtonLabel",
  "regenerateButtonLabel",
  "emailCaptureMenuLabel",
  "emailCaptureHeading",
  "emailCaptureBody",
  "emailCaptureButton",
] as const;
export type ExperienceCopyKey = (typeof EXPERIENCE_COPY_KEYS)[number];
export type ExperienceCopy = Partial<Record<ExperienceCopyKey, string>>;

/**
 * Today's customer-facing strings, for reference and admin placeholders.
 * Call sites keep their own literal fallback; this table documents them and
 * the tests pin both to the same value.
 */
export const CLASSIC_COPY: Record<ExperienceCopyKey, string> = {
  savedDesignsLabel: "Saved Designs",
  savedDesignsIntro: "",
  accountHeading: "Sign in or create account",
  accountBody:
    "Save designs, track credits, and pick up where you left off. New here? We'll create your account automatically.",
  uploadLabel: "Upload",
  uploadCaption: "Reference Images (optional, up to 5)",
  petUploadLabel: "Add pet photo",
  ownerUploadLabel: "Add owner photo",
  promptLabel: "Describe your artwork",
  promptPlaceholder: "",
  conceptButtonLabel: "Give me 3 ideas",
  generateButtonLabel: "Generate Artwork",
  regenerateButtonLabel: "Regenerate from",
  emailCaptureMenuLabel: "Art Class newsletter",
  emailCaptureHeading: "Studio Art Class",
  emailCaptureBody:
    "Join the Studio Art Class list. Discover prompt tips and tricks, inspiration from others and more.",
  emailCaptureButton: "Join",
};

export type ExperienceBrand = {
  name?: string;
  shortName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  surfaceColor?: string;
  textColor?: string;
};

export type ExperienceChoice = { id: string; label: string };

/**
 * Extra creative controls a store shows for pack styles. Humour/relationship
 * option lists come from the pack prompt profile (they carry prompt text);
 * personality/species/pet name are presentation + concept-writer inputs.
 */
export type ExperienceControls = {
  humor?: { label: string };
  relationship?: { label: string };
  personality?: { label: string; max: number; options: ExperienceChoice[] };
  species?: { label: string; options: ExperienceChoice[] };
  petName?: { label: string; placeholder?: string };
  words?: { label: string };
};

export type ExperienceProfileConfig = {
  brand: ExperienceBrand;
  copy: ExperienceCopy;
  controls: ExperienceControls;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || undefined;
}

function hex(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : undefined;
}

function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function slugId(v: unknown): string | undefined {
  const t = text(v, 40);
  return t && /^[a-z0-9][a-z0-9-]*$/.test(t) ? t : undefined;
}

function choices(v: unknown, max = 30): ExperienceChoice[] {
  if (!Array.isArray(v)) return [];
  const out: ExperienceChoice[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const id = slugId((c as any).id);
    const label = text((c as any).label, 40);
    if (id && label && !out.some((o) => o.id === id)) out.push({ id, label });
    if (out.length >= max) break;
  }
  return out;
}

function labelled(v: unknown): { label: string } | undefined {
  const label = v && typeof v === "object" ? text((v as any).label, 60) : undefined;
  return label ? { label } : undefined;
}

/** Whitelisted, length-capped, colour/URL-validated config. Unknown keys are dropped. */
export function parseExperienceProfileConfig(raw: unknown): ExperienceProfileConfig {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, any>;
  const b = (o.brand && typeof o.brand === "object" ? o.brand : {}) as Record<string, unknown>;
  const brand: ExperienceBrand = {};
  const name = text(b.name, 60);
  if (name) brand.name = name;
  const shortName = text(b.shortName, 30);
  if (shortName) brand.shortName = shortName;
  const logoUrl = httpsUrl(b.logoUrl);
  if (logoUrl) brand.logoUrl = logoUrl;
  for (const k of ["primaryColor", "accentColor", "surfaceColor", "textColor"] as const) {
    const c = hex(b[k]);
    if (c) brand[k] = c;
  }

  const c = (o.copy && typeof o.copy === "object" ? o.copy : {}) as Record<string, unknown>;
  const copy: ExperienceCopy = {};
  for (const key of EXPERIENCE_COPY_KEYS) {
    const t = text(c[key], key.endsWith("Body") || key.endsWith("Intro") ? 400 : 120);
    if (t) copy[key] = t;
  }

  const k = (o.controls && typeof o.controls === "object" ? o.controls : {}) as Record<string, any>;
  const controls: ExperienceControls = {};
  const humor = labelled(k.humor);
  if (humor) controls.humor = humor;
  const relationship = labelled(k.relationship);
  if (relationship) controls.relationship = relationship;
  const words = labelled(k.words);
  if (words) controls.words = words;
  if (k.personality && typeof k.personality === "object") {
    const opts = choices(k.personality.options);
    const label = text(k.personality.label, 60);
    if (label && opts.length) {
      const max = Number(k.personality.max);
      controls.personality = { label, options: opts, max: Number.isInteger(max) && max > 0 ? Math.min(max, 5) : 3 };
    }
  }
  if (k.species && typeof k.species === "object") {
    const opts = choices(k.species.options);
    const label = text(k.species.label, 60);
    if (label && opts.length) controls.species = { label, options: opts };
  }
  if (k.petName && typeof k.petName === "object") {
    const label = text(k.petName.label, 60);
    if (label) controls.petName = { label, placeholder: text(k.petName.placeholder, 80) };
  }
  return { brand, copy, controls };
}

/** What a storefront client receives. Never contains prompt text. */
export type PublicExperienceProfile = {
  slug: string;
  brand: ExperienceBrand;
  copy: ExperienceCopy;
  controls: ExperienceControls & {
    humorOptions?: ExperienceChoice[];
    relationshipOptions?: ExperienceChoice[];
  };
  /** The profile's style pack, when any (for generate/concept requests). */
  stylePackId: string | null;
};

export function publicExperienceProfile(
  row: { slug: string; config: unknown; stylePackId?: string | null },
  packOptions?: { humorOptions?: ExperienceChoice[]; relationshipOptions?: ExperienceChoice[] } | null,
): PublicExperienceProfile {
  const cfg = parseExperienceProfileConfig(row.config);
  return {
    slug: row.slug,
    brand: cfg.brand,
    copy: cfg.copy,
    controls: {
      ...cfg.controls,
      ...(packOptions?.humorOptions?.length ? { humorOptions: packOptions.humorOptions } : {}),
      ...(packOptions?.relationshipOptions?.length ? { relationshipOptions: packOptions.relationshipOptions } : {}),
    },
    stylePackId: row.stylePackId ?? null,
  };
}

/** Override when the store sets one, else the caller's existing literal. */
export function experienceCopy(
  profile: { copy?: ExperienceCopy } | null | undefined,
  key: ExperienceCopyKey,
  fallback: string,
): string {
  const v = profile?.copy?.[key];
  return typeof v === "string" && v ? v : fallback;
}

export function parsePublicExperienceProfile(raw: unknown): PublicExperienceProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  if (typeof o.slug !== "string" || !o.slug) return null;
  const cfg = parseExperienceProfileConfig({ brand: o.brand, copy: o.copy, controls: o.controls });
  return {
    slug: o.slug,
    brand: cfg.brand,
    copy: cfg.copy,
    controls: {
      ...cfg.controls,
      humorOptions: choices(o.controls?.humorOptions),
      relationshipOptions: choices(o.controls?.relationshipOptions),
    },
    stylePackId: typeof o.stylePackId === "string" ? o.stylePackId : null,
  };
}
