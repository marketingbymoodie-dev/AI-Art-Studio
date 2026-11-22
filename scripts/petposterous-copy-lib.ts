/**
 * Pure checks for the Petposterous staging → production copy and the tag remap.
 * The scripts that talk to a database import this. They do not print secrets.
 */
export const PETPOSTEROUS_SHOP = "h7epay-gh.myshopify.com";
export const DEMO_SHOP = "ai-art-studio-staging.myshopify.com";
export const PRINTIFY_SHOP_ID = "29135517";
export const DELIVERY_PROFILE_ID = "148236795985";
export const ROUND_ONE_SHOPIFY_PRODUCT_ID = "16470702325841";
export const EXPECTED_PROFILE_VARIANTS = 716;
export const COPY_CONFIRM = "copy-petposterous";

const SECRET_COLUMNS = new Set([
  "access_token",
  "refresh_token",
  "printify_api_token",
  "custom_nano_banana_token",
  "encrypted_key",
]);

export function databaseIdentity(connectionString: string): { host: string; database: string } {
  const url = new URL(connectionString);
  return {
    host: url.hostname.toLowerCase(),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase(),
  };
}

function looksProduction(value: string): boolean {
  return value.includes("production") || value.includes("prod-") || value.includes(".prod");
}

function looksStaging(value: string): boolean {
  return value.includes("staging");
}

/** Source must be staging. Destination must be a different, non-staging database. */
export function assertCopyTargets(source: string, dest: string | undefined, writing: boolean): {
  sourceHost: string;
  destHost: string | null;
} {
  if (!source) throw new Error("SOURCE_DATABASE_URL is required.");
  const src = databaseIdentity(source);
  if (looksProduction(src.host) || looksProduction(src.database)) {
    throw new Error("Source looks like production. Refusing.");
  }
  if (!dest) {
    if (writing) throw new Error("DEST_DATABASE_URL is required to write.");
    return { sourceHost: src.host, destHost: null };
  }
  if (source === dest) throw new Error("Source and destination are the same database.");
  const dst = databaseIdentity(dest);
  if (dst.host === src.host && dst.database === src.database) {
    throw new Error("Source and destination are the same database.");
  }
  if (looksStaging(dst.host) || looksStaging(dst.database)) {
    throw new Error("Destination looks like staging. Refusing.");
  }
  if (looksProduction(src.host) || looksProduction(src.database)) {
    throw new Error("Source looks like production. Refusing.");
  }
  return { sourceHost: src.host, destHost: dst.host };
}

export function isRoundOneDesign(row: { shopify_product_id?: unknown; title?: unknown }): boolean {
  if (String(row.shopify_product_id || "") === ROUND_ONE_SHOPIFY_PRODUCT_ID) return true;
  return /^round one\b/i.test(String(row.title || "").trim());
}

export function remapIdKeys(value: unknown, idMap: Map<number, number>): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, row] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(key);
    const next = Number.isInteger(id) ? idMap.get(id) : undefined;
    out[next ? String(next) : key] = row;
  }
  return out;
}

export function retagCatalogueTypeTags(tags: string[], idMap: Record<string, number>): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const match = /^aas-type-(\d+)$/.exec(tag);
    const mapped = match ? idMap[match[1]] : undefined;
    const value = mapped ? `aas-type-${mapped}` : tag;
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export function remapTagCondition(condition: string, idMap: Record<string, number>): string {
  const match = /^aas-type-(\d+)$/.exec(condition);
  const mapped = match ? idMap[match[1]] : undefined;
  return mapped ? `aas-type-${mapped}` : condition;
}

/** JSON text for a parameter. node-pg would otherwise send arrays as Postgres array literals. */
export function jsonParameter(value: unknown): unknown {
  if (value == null) return null;
  return JSON.stringify(value);
}

export function withoutSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET_COLUMNS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
