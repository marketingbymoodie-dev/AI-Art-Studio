/**
 * Read-only diagnostic: report the stored Shopify offline token for a given
 * shop (redacted) and make ONE Admin GraphQL call with that exact column
 * value to determine if it's revoked upstream or just stale locally.
 *
 * No DDL. No token writes. Does not print DATABASE_URL.
 *
 * Usage:
 *   npx tsx scripts/diagnose-shopify-token.ts <shopDomainOrHandle>
 *
 * Example:
 *   npx tsx scripts/diagnose-shopify-token.ts ai-art-studio-staging
 */
import { pool } from "../server/db";

function redactToken(token: string | null | undefined): string {
  if (!token) return "(null/empty)";
  if (token === "NEEDS_RECONNECT") return "NEEDS_RECONNECT";
  const s = String(token);
  if (s.length <= 8) return `${s} (len=${s.length})`;
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

function hostHint(): { host: string; db: string } {
  const raw = process.env.DATABASE_URL || "";
  try {
    const u = new URL(raw);
    return { host: u.hostname, db: u.pathname.replace(/^\//, "") };
  } catch {
    return { host: "(unparsed)", db: "" };
  }
}

async function fetchRow(shopDomain: string) {
  const q = await pool.query(
    `SELECT id, shop_domain, access_token, refresh_token,
            access_token_expires_at, refresh_token_expires_at,
            scope, status, installed_at, uninstalled_at
       FROM shopify_installations
       WHERE shop_domain = $1
       LIMIT 1`,
    [shopDomain],
  );
  return q.rows[0];
}

async function testGraphQL(shopDomain: string, accessToken: string) {
  const url = `https://${shopDomain}/admin/api/2025-10/graphql.json`;
  console.log(`\n=== GraphQL probe: POST ${url} ===`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: "{ shop { name } }" }),
  });
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  const isJson = contentType.includes("application/json");
  console.log("status:", status);
  console.log("content-type:", contentType);
  console.log("body_is_json:", isJson);
  console.log("body_first_400:", body.slice(0, 400).replace(/\s+/g, " "));
  if (isJson) {
    try {
      const parsed = JSON.parse(body);
      console.log("parsed.errors:", JSON.stringify(parsed?.errors ?? null));
      console.log("parsed.data.shop:", JSON.stringify(parsed?.data?.shop ?? null));
    } catch {
      console.log("json parse failed despite content-type");
    }
  }
  return { status, isJson };
}

async function main() {
  const argv = process.argv.slice(2);
  const raw = argv[0];
  if (!raw) {
    console.error("Usage: tsx scripts/diagnose-shopify-token.ts <shopDomainOrHandle>");
    process.exit(2);
  }
  const bare = raw.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  const full = bare.endsWith(".myshopify.com") ? bare : `${bare}.myshopify.com`;

  console.log("db_hint", hostHint());
  console.log("candidates:", { full, bare });

  const rowFull = await fetchRow(full);
  const rowBare = rowFull ? null : await fetchRow(bare);
  const row = rowFull || rowBare;
  if (!row) {
    console.log(`\nNo shopify_installations row for ${full} or ${bare}.`);
    return;
  }

  console.log(`\n=== installation row (matched shop_domain=${row.shop_domain}) ===`);
  console.log({
    id: row.id,
    shop_domain: row.shop_domain,
    status: row.status,
    scope: row.scope,
    access_token: redactToken(row.access_token),
    refresh_token: redactToken(row.refresh_token),
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_expires_at: row.refresh_token_expires_at,
    installed_at: row.installed_at,
    uninstalled_at: row.uninstalled_at,
    note:
      "no updated_at column on this table; access_token_expires_at / refresh_token_expires_at are rewritten on every persistOfflineToken call.",
  });

  if (!row.access_token || row.access_token === "NEEDS_RECONNECT") {
    console.log("\nStored token is placeholder/empty — skipping GraphQL probe.");
    return;
  }

  await testGraphQL(row.shop_domain, row.access_token);
}

main()
  .catch((err) => {
    console.error("diagnose failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
