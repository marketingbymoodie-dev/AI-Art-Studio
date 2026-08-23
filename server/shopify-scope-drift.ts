/**
 * OAuth scope drift detection.
 *
 * Two independent failure modes have bitten us (write_shipping, then
 * write_inventory): (1) the server's OAuth constant and the shopify.app*.toml
 * configs — which govern Shopify-managed installation grants — silently
 * disagreeing, and (2) a store's granted token predating a scope addition.
 * Both surfaced as ACCESS_DENIED mid-apply instead of a diff up front.
 *
 * - `checkShopifyScopeDrift` — static config diff, run at startup.
 * - `checkGrantedScopes` — live token check against Shopify's
 *   /admin/oauth/access_scopes.json, run in the reconciler pre-flight.
 */
import fs from "fs";
import path from "path";

/** write_x implies read_x on the Shopify Admin API. */
function effectiveScopeSet(scopes: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of scopes) {
    const s = String(raw).trim();
    if (!s) continue;
    out.add(s);
    if (s.startsWith("write_")) out.add(`read_${s.slice(6)}`);
  }
  return out;
}

function splitScopes(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ScopeDriftFileReport = {
  file: string;
  /** Effective scopes the server requests that the toml does not declare. */
  missingInToml: string[];
  /** Effective scopes the toml declares that the server does not request. */
  missingInServer: string[];
};

export type ScopeDriftReport = {
  ok: boolean;
  checkedFiles: number;
  files: ScopeDriftFileReport[];
  notes: string[];
};

/**
 * Compare the server OAuth scope list against every shopify.app*.toml in the
 * repo root. Pure/filesystem-only — safe to call at startup; missing tomls
 * (e.g. a trimmed production image) degrade to a note, not a failure.
 */
export function checkShopifyScopeDrift(
  serverScopesCsv: string,
  rootDir: string = process.cwd(),
): ScopeDriftReport {
  const report: ScopeDriftReport = { ok: true, checkedFiles: 0, files: [], notes: [] };
  let tomlNames: string[] = [];
  try {
    tomlNames = fs
      .readdirSync(rootDir)
      .filter((f) => /^shopify\.app.*\.toml$/i.test(f))
      .sort();
  } catch (e: any) {
    report.notes.push(`could not list ${rootDir}: ${e?.message || e}`);
    return report;
  }
  if (tomlNames.length === 0) {
    report.notes.push(`no shopify.app*.toml found in ${rootDir} — drift check skipped`);
    return report;
  }

  const serverEff = effectiveScopeSet(splitScopes(serverScopesCsv));
  for (const name of tomlNames) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(rootDir, name), "utf8");
    } catch (e: any) {
      report.notes.push(`${name}: unreadable (${e?.message || e})`);
      continue;
    }
    const m = text.match(/^\s*scopes\s*=\s*"([^"]*)"/m);
    if (!m) {
      report.notes.push(`${name}: no scopes = "..." line found`);
      continue;
    }
    report.checkedFiles++;
    const tomlEff = effectiveScopeSet(splitScopes(m[1]));
    const missingInToml = Array.from(serverEff).filter((s) => !tomlEff.has(s)).sort();
    const missingInServer = Array.from(tomlEff).filter((s) => !serverEff.has(s)).sort();
    if (missingInToml.length || missingInServer.length) {
      report.ok = false;
      report.files.push({ file: name, missingInToml, missingInServer });
    }
  }
  return report;
}

/** Log a drift report; loud on drift, one quiet line when clean. */
export function logScopeDriftReport(report: ScopeDriftReport): void {
  for (const note of report.notes) console.warn(`[scope-drift] ${note}`);
  if (report.ok) {
    console.log(
      `[scope-drift] OK — server OAuth scopes match ${report.checkedFiles} shopify.app*.toml file(s)`,
    );
    return;
  }
  for (const f of report.files) {
    if (f.missingInToml.length) {
      console.error(
        `[scope-drift] ${f.file} is MISSING scopes the server requests: ${f.missingInToml.join(", ")} — managed installs will not grant them; add to the toml and redeploy the Partner app`,
      );
    }
    if (f.missingInServer.length) {
      console.error(
        `[scope-drift] ${f.file} declares scopes the server constant lacks: ${f.missingInServer.join(", ")} — add to SHOPIFY_SCOPES in server/shopify.ts or server-initiated OAuth will drop them`,
      );
    }
  }
}

/**
 * Ask Shopify which scopes a shop's token actually has, and diff against
 * `required`. Returns `missing` (after write→read expansion). A transport
 * failure is reported via `error` instead of guessing.
 */
export async function checkGrantedScopes(
  shop: string,
  accessToken: string,
  required: string[],
): Promise<{ granted: string[]; missing: string[]; error?: string }> {
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    if (!res.ok) {
      return { granted: [], missing: [], error: `access_scopes HTTP ${res.status}` };
    }
    const body: any = await res.json();
    const granted = ((body?.access_scopes as any[]) || []).map((x) => String(x.handle));
    const grantedEff = effectiveScopeSet(granted);
    const missing = required.filter((s) => !grantedEff.has(s)).sort();
    return { granted: granted.sort(), missing };
  } catch (e: any) {
    return { granted: [], missing: [], error: e?.message || String(e) };
  }
}
