/**
 * Checkout UI builds replace the exact token process.env.APP_URL from
 * .env.<config>. Write that file from the chosen app config's application_url
 * so staging, production, creators, and petposterous each bake their own backend.
 * Does not touch the root .env.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configArg = process.argv[2];
if (!configArg) {
  console.error("Usage: node scripts/write-checkout-app-url.mjs <shopify.app.*.toml>");
  process.exit(1);
}

const configPath = path.resolve(root, configArg);
const base = path.basename(configPath);
const configName = base === "shopify.app.toml" ? "" : base.slice("shopify.app.".length, -".toml".length);
if (!configName) {
  console.error("Refusing to write the root .env. Pass shopify.app.<name>.toml.");
  process.exit(1);
}

const text = readFileSync(configPath, "utf8");
const match = text.match(/^application_url\s*=\s*"([^"]+)"/m);
const origin = String(match?.[1] || "").trim().replace(/\/$/, "");
if (!origin.startsWith("https://")) {
  console.error(`No https application_url in ${base}`);
  process.exit(1);
}

const envPath = path.join(root, `.env.${configName}`);
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existing.split(/\r?\n/).filter((line) => line && !line.startsWith("APP_URL="));
lines.push(`APP_URL=${origin}`);
writeFileSync(envPath, `${lines.join("\n")}\n`);
console.log(`Checkout Back to shop origin for ${base} written to .env.${configName}`);
