/**
 * List Petposterous products and smart collections that use aas-type-56 or aas-type-58.
 * Dry-run is the default and changes nothing.
 *
 *   PETPOSTEROUS_ADMIN_TOKEN=... npx tsx scripts/retag-petposterous-type-tags.ts
 *
 * A real retag also needs --write, the id map from the copy, and
 * CONFIRM_PETPOSTEROUS_RETAG=retag-petposterous.
 * Do not run that until the switchover checklist says go.
 */
import { readFile } from "node:fs/promises";
import { chunks, formatElapsed, formatProgress, PETPOSTEROUS_SHOP, remapTagCondition, retagCatalogueTypeTags } from "./petposterous-copy-lib";

const WRITE_BATCH = 10;

const API = "2025-10";
const RETAG_CONFIRM = "retag-petposterous";
const OLD_TAGS = ["aas-type-56", "aas-type-58"];

type ProductNode = { id: string; title: string; handle: string; tags: string[] };
type Rule = { column: string; relation: string; condition: string };
type CollectionNode = { id: string; title: string; handle: string; ruleSet: { appliedDisjunctively: boolean; rules: Rule[] } | null };

async function main(): Promise<void> {
  const startedAt = Date.now();
  const writing = process.argv.includes("--write");
  const token = process.env.PETPOSTEROUS_ADMIN_TOKEN || "";
  if (!token) throw new Error("PETPOSTEROUS_ADMIN_TOKEN is required. It is not printed.");
  const idMap = await readIdMap(process.env.PETPOSTEROUS_ID_MAP || "tmp/petposterous-id-map.json", writing);
  if (writing && process.env.CONFIRM_PETPOSTEROUS_RETAG !== RETAG_CONFIRM) {
    throw new Error(`Refusing to write. Set CONFIRM_PETPOSTEROUS_RETAG=${RETAG_CONFIRM} and pass --write.`);
  }

  const products = await listProducts(token, startedAt);
  const collections = (await listCollections(token, startedAt)).filter((collection) => usesOldTag(collection));
  console.log(`shop: ${PETPOSTEROUS_SHOP}`);
  console.log(`products with old type tags: ${products.length}`);
  for (const product of products) {
    const next = retagCatalogueTypeTags(product.tags, idMap);
    console.log(`${product.handle} | ${product.title}`);
    console.log(`  tags: ${product.tags.join(", ")}`);
    console.log(`  next: ${next.join(", ")}`);
  }
  console.log(`collections with old type rules: ${collections.length}`);
  for (const collection of collections) {
    const rules = collection.ruleSet?.rules || [];
    console.log(`${collection.handle} | ${collection.title}`);
    for (const rule of rules) {
      console.log(`  ${rule.column} ${rule.relation} ${rule.condition} -> ${remapTagCondition(rule.condition, idMap)}`);
    }
  }
  if (!writing) {
    console.log("Dry-run only. No tags were changed.");
    return;
  }
  if (!Object.keys(idMap).length) throw new Error("The id map is empty.");
  let done = 0;
  for (const batch of chunks(products, WRITE_BATCH)) {
    const declarations = batch.map((_, index) => `$p${index}: ProductUpdateInput!`).join(", ");
    const fields = batch.map((_, index) => `p${index}: productUpdate(product: $p${index}) { userErrors { message } }`).join("\n");
    const variables: Record<string, unknown> = {};
    batch.forEach((product, index) => {
      variables[`p${index}`] = { id: product.id, tags: retagCatalogueTypeTags(product.tags, idMap) };
    });
    await admin(token, `mutation(${declarations}) { ${fields} }`, variables);
    done += batch.length;
    console.log(formatProgress("products", done, products.length, startedAt));
  }
  done = 0;
  for (const batch of chunks(collections, WRITE_BATCH)) {
    const declarations = batch.map((_, index) => `$c${index}: CollectionInput!`).join(", ");
    const fields = batch.map((_, index) => `c${index}: collectionUpdate(input: $c${index}) { userErrors { message } }`).join("\n");
    const variables: Record<string, unknown> = {};
    batch.forEach((collection, index) => {
      const rules = (collection.ruleSet?.rules || []).map((rule) => ({
        column: rule.column,
        relation: rule.relation,
        condition: remapTagCondition(rule.condition, idMap),
      }));
      variables[`c${index}`] = {
        id: collection.id,
        ruleSet: { appliedDisjunctively: collection.ruleSet?.appliedDisjunctively === true, rules },
      };
    });
    await admin(token, `mutation(${declarations}) { ${fields} }`, variables);
    done += batch.length;
    console.log(formatProgress("collections", done, collections.length, startedAt));
  }
  console.log(`committed ${formatElapsed(startedAt)}`);
}

async function readIdMap(file: string, writing: boolean): Promise<Record<string, number>> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0) out[key] = id;
    }
    return out;
  } catch {
    if (writing) throw new Error(`Could not read the id map at ${file}.`);
    console.log("No id map yet. Listing current tags only.");
    return {};
  }
}

function usesOldTag(collection: CollectionNode): boolean {
  return (collection.ruleSet?.rules || []).some((rule) => OLD_TAGS.includes(rule.condition));
}

async function listProducts(token: string, startedAt: number): Promise<ProductNode[]> {
  const query = `tag:${OLD_TAGS.join(" OR tag:")}`;
  const out: ProductNode[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] } } = await admin(token, `query($cursor: String, $query: String!) {
      products(first: 50, after: $cursor, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes { id title handle tags }
      }
    }`, { cursor, query });
    out.push(...data.products.nodes);
    console.log(formatProgress("products listed", out.length, out.length, startedAt));
    if (!data.products.pageInfo.hasNextPage) return out;
    cursor = data.products.pageInfo.endCursor;
  }
}

async function listCollections(token: string, startedAt: number): Promise<CollectionNode[]> {
  const out: CollectionNode[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: CollectionNode[] } } = await admin(token, `query($cursor: String) {
      collections(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id title handle ruleSet { appliedDisjunctively rules { column relation condition } } }
      }
    }`, { cursor });
    out.push(...data.collections.nodes);
    console.log(formatProgress("collections listed", out.length, out.length, startedAt));
    if (!data.collections.pageInfo.hasNextPage) return out;
    cursor = data.collections.pageInfo.endCursor;
  }
}

async function admin<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${PETPOSTEROUS_SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((err) => err.message).filter(Boolean).join("; ") || `Shopify HTTP ${res.status}`);
  }
  const errors = findUserErrors(json.data);
  if (errors.length) throw new Error(errors.join("; "));
  return json.data as T;
}

function findUserErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = Array.isArray(record.userErrors) ? record.userErrors : [];
  const own = direct.map((err) => String((err as { message?: string }).message || "")).filter(Boolean);
  return own.concat(...Object.values(record).map((child) => findUserErrors(child)));
}

const entry = process.argv[1] || "";
if (entry.includes("retag-petposterous-type-tags")) {
  main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Retag failed");
    process.exit(1);
  });
}
