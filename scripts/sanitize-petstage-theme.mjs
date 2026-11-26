/**
 * Clears live-store product, collection, and file ids from a pulled theme
 * so Pet Stage does not point at Petposterous products. Does not upload.
 */
import fs from "fs";
import path from "path";

const GID = /gid:\/\/shopify\/(?:Product|ProductVariant|Collection|MediaImage|Video|GenericFile|OnlineStorePage|Metaobject|OnlineStoreMenu)\b[^"'\s]*/g;
const RESOURCE_KEYS = new Set(["product", "featured_product", "collection", "featured_collection"]);
const KEEP_HANDLES = new Set(["all", "frontpage"]);
const KEEP_MENUS = new Set(["main-menu", "footer", "customer-account-main-menu", "legal"]);

const PET_APP_BLOCK = "shopify://apps/ai-art-studio-petposterous/blocks/";
const STAGE_APP_BLOCK = "shopify://apps/ai-art-studio-staging/blocks/";
const PET_EXTENSION_ID = "01a1de52-0d89-736a-a806-0370d800c172";
const STAGE_EXTENSION_ID = "019fc6d4-0850-772f-988a-e220912aad7f";

function stagingAppBlock(value) {
  if (!value.includes(PET_APP_BLOCK)) return value;
  return value.replaceAll(PET_APP_BLOCK, STAGE_APP_BLOCK).replaceAll(PET_EXTENSION_ID, STAGE_EXTENSION_ID);
}

export function sanitizeThemeValue(value, trail, log, resources = new Set(), menus = new Set()) {
  if (typeof value === "string") {
    if (value.includes(PET_APP_BLOCK)) {
      log.push(`${trail} pointed an app block at the staging app`);
      return stagingAppBlock(value);
    }
    if (/h7epay-gh\.myshopify\.com/i.test(value)) {
      log.push(`${trail} cleared a live shop reference`);
      return "";
    }
    if (!value.includes("gid://shopify/")) return value;
    const next = value.replace(GID, "");
    if (next !== value) log.push(`${trail} cleared a Shopify id`);
    return next;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeThemeValue(item, `${trail}[${index}]`, log, resources, menus));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const here = `${trail}.${key}`;
    const resourceKey = RESOURCE_KEYS.has(key) || resources.has(key);
    if (resourceKey && typeof child === "string" && child && !KEEP_HANDLES.has(child) && !child.startsWith("shopify://") && !child.includes("{{")) {
      log.push(`${here} cleared ${child}`);
      out[key] = "";
      continue;
    }
    if ((key === "menu" || key === "linklist" || menus.has(key)) && typeof child === "string" && child && !KEEP_MENUS.has(child) && !child.includes("{{")) {
      log.push(`${here} cleared menu ${child}`);
      out[key] = "";
      continue;
    }
    out[key] = sanitizeThemeValue(child, here, log, resources, menus);
  }
  if (typeof out.type === "string" && out.type.includes("/blocks/my-pet/")) {
    const settings = out.settings && typeof out.settings === "object" ? out.settings : {};
    if (settings.preview_mode !== "inline") {
      settings.preview_mode = "inline";
      log.push(`${trail} my-pet preview set to the product image`);
    }
    out.settings = settings;
  }
  return out;
}

function splitThemeJson(raw) {
  const match = raw.match(/^\s*\/\*[\s\S]*?\*\/\s*/);
  return {
    header: match ? match[0] : "",
    body: match ? raw.slice(match[0].length) : raw,
  };
}

function schemaIds(themeDir) {
  const resources = new Set();
  const menus = new Set();
  const file = path.join(themeDir, "config", "settings_schema.json");
  if (!fs.existsSync(file)) return { resources, menus };
  const { body } = splitThemeJson(fs.readFileSync(file, "utf8"));
  let schema;
  try { schema = JSON.parse(body); } catch { return { resources, menus }; }
  for (const group of schema) {
    for (const setting of group.settings || []) {
      if (!setting?.id) continue;
      if (setting.type === "collection" || setting.type === "collection_list" || setting.type === "product" || setting.type === "product_list") {
        resources.add(setting.id);
      }
      if (setting.type === "link_list") menus.add(setting.id);
    }
  }
  return { resources, menus };
}

function walk(dir, log, resources, menus) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".shopify" || name === "node_modules") continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, log, resources, menus);
      continue;
    }
    if (!name.endsWith(".json") || name.endsWith(".schema.json")) continue;
    const rel = full.replace(/\\/g, "/");
    const inThemeData = rel.includes("/templates/") || rel.includes("/sections/") || rel.endsWith("/config/settings_data.json");
    if (!inThemeData) continue;
    const raw = fs.readFileSync(full, "utf8");
    const { header, body } = splitThemeJson(raw);
    let parsed;
    try { parsed = JSON.parse(body); } catch { continue; }
    const fileLog = [];
    const next = sanitizeThemeValue(parsed, path.basename(full), fileLog, resources, menus);
    if (!fileLog.length) continue;
    fs.writeFileSync(full, header + JSON.stringify(next, null, 2) + "\n");
    log.push(...fileLog);
  }
}

function themeIdFromPushLog(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  for (let index = objects.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(objects[index]);
      const id = String(parsed?.theme?.id || "");
      if (parsed?.theme?.shop === "petstage.myshopify.com" && /^\d+$/.test(id)) return id;
    } catch {
      // Progress text can contain braces that are not the theme result.
    }
  }
  return "";
}

const themeDir = process.argv[2];
if (themeDir === "--theme-id") {
  const buf = fs.readFileSync(process.argv[3]);
  const text = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString("utf16le") : buf.toString("utf8");
  const id = themeIdFromPushLog(text);
  if (!id) process.exit(2);
  process.stdout.write(id);
  process.exit(0);
}
if (process.argv[1] && process.argv[1].endsWith("sanitize-petstage-theme.mjs") && themeDir) {
  if (!fs.existsSync(themeDir)) {
    console.error("theme directory missing");
    process.exit(1);
  }
  const log = [];
  const { resources, menus } = schemaIds(themeDir);
  walk(themeDir, log, resources, menus);
  console.log(`sanitized ${log.length} theme references`);
  for (const line of log) console.log(line);
}
