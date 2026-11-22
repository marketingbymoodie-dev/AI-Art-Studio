/**
 * Saved Designs gallery is one card per generationJobs row (customerId +
 * complete). Placement forks and pre-mockup artwork jobs share the same
 * prompt/title as the real mockup card, which looks like duplicate saves.
 */

export type GalleryJobLike = {
  id: string;
  prompt?: string | null;
  userPrompt?: string | null;
  productTypeId?: string | null;
  createdAt?: Date | string | null;
  mockupUrls?: unknown;
  designState?: unknown;
};

function designStateObject(
  designState: unknown,
): Record<string, unknown> | null {
  if (!designState || typeof designState !== "object" || Array.isArray(designState)) {
    return null;
  }
  return designState as Record<string, unknown>;
}

function firstHttpish(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPlacementForkJob(job: GalleryJobLike): boolean {
  return designStateObject(job.designState)?.placementFork === true;
}

/** True when Saved Designs can show a product mockup (not raw artwork). */
export function galleryJobHasMockupPreview(job: GalleryJobLike): boolean {
  if (Array.isArray(job.mockupUrls)) {
    if (job.mockupUrls.some((u) => firstHttpish(u))) return true;
  }
  const ds = designStateObject(job.designState);
  if (!ds) return false;
  const hoodie = ds.hoodieAopMockups;
  if (hoodie && typeof hoodie === "object" && !Array.isArray(hoodie)) {
    const h = hoodie as Record<string, unknown>;
    if (firstHttpish(h.front) || firstHttpish(h.back)) return true;
  }
  const flat = ds.flatMockups;
  if (flat && typeof flat === "object" && !Array.isArray(flat)) {
    const f = flat as Record<string, unknown>;
    if (firstHttpish(f.front) || firstHttpish(f.back)) return true;
  }
  return false;
}

export function galleryDedupeKey(job: GalleryJobLike): string {
  const prompt = String(job.userPrompt || job.prompt || "")
    .trim()
    .toLowerCase();
  const pt = String(job.productTypeId || "").trim();
  return `${pt}::${prompt}`;
}

function createdAtMs(job: GalleryJobLike): number {
  if (!job.createdAt) return 0;
  const t =
    job.createdAt instanceof Date
      ? job.createdAt.getTime()
      : Date.parse(String(job.createdAt));
  return Number.isFinite(t) ? t : 0;
}

/**
 * One visible card per design. Drops ATC placement forks (same prompt, no
 * mockups) and artwork-only siblings that sit next to a mockup card.
 * When every sibling is still artwork-only, keep the newest.
 */
export function selectVisibleGalleryJobs<T extends GalleryJobLike>(rows: T[]): T[] {
  const withoutForks = rows.filter((r) => !isPlacementForkJob(r));
  const groups = new Map<string, T[]>();
  for (const row of withoutForks) {
    const key = galleryDedupeKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const keep = new Set<string>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      keep.add(group[0].id);
      continue;
    }
    const withPreview = group.filter((r) => galleryJobHasMockupPreview(r));
    if (withPreview.length > 0) {
      for (const r of withPreview) keep.add(r.id);
      continue;
    }
    const newest = [...group].sort((a, b) => createdAtMs(b) - createdAtMs(a))[0];
    if (newest) keep.add(newest.id);
  }
  return withoutForks.filter((r) => keep.has(r.id));
}
