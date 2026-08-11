/**
 * Production-safe startup migration fallback.
 *
 * drizzle-kit push is the primary migration mechanism (runs during build).
 * This file is a safety net that ensures:
 *   1. All required columns exist on existing tables (ADD COLUMN IF NOT EXISTS)
 *   2. All required tables exist (CREATE TABLE IF NOT EXISTS)
 *
 * Every statement is fully idempotent and safe to run on every boot.
 */
import { pool } from "../db";

// ── Column additions ──────────────────────────────────────────────────────────

const COLUMN_MIGRATIONS: { table: string; column: string; type: string }[] = [
  { table: "shopify_installations", column: "customizer_hub_url",          type: "TEXT" },
  { table: "shopify_installations", column: "plan_name",                   type: "TEXT" },
  { table: "shopify_installations", column: "plan_status",                 type: "TEXT" },
  { table: "shopify_installations", column: "trial_started_at",            type: "TIMESTAMP" },
  { table: "shopify_installations", column: "billing_subscription_id",     type: "TEXT" },
  { table: "shopify_installations", column: "billing_usage_line_item_id",  type: "TEXT" },
  { table: "shopify_installations", column: "billing_current_period_end",  type: "TIMESTAMP" },
  { table: "shopify_installations", column: "generation_month",            type: "TEXT" },
  { table: "shopify_installations", column: "monthly_generations_used",    type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "shopify_installations", column: "monthly_overage_used",        type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "shopify_installations", column: "overage_opt_in_enabled",      type: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "shopify_installations", column: "overage_budget_cents",        type: "INTEGER" },
  { table: "shopify_installations", column: "overage_recurring",           type: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "shopify_installations", column: "overage_opt_in_at",           type: "TIMESTAMP" },
  { table: "shopify_installations", column: "overage_opt_in_bucket_key",   type: "TEXT" },
  { table: "shopify_installations", column: "quota_alert_90_bucket_key",   type: "TEXT" },
  { table: "shopify_installations", column: "quota_alert_100_bucket_key",  type: "TEXT" },
  { table: "shopify_installations", column: "pending_plan_name",           type: "TEXT" },
  { table: "shopify_installations", column: "pending_plan_effective_at",   type: "TIMESTAMP" },
  { table: "style_presets",         column: "prompt_prefix_dark",          type: "TEXT" },
  { table: "generation_jobs",       column: "billing_mode",                type: "TEXT" },
  { table: "customizer_pages",      column: "base_product_handle",         type: "TEXT" },
  { table: "customizer_pages",      column: "style_config",                type: "JSONB" },
  { table: "generation_jobs",       column: "session_id",                  type: "TEXT" },
  { table: "generation_jobs",       column: "customer_id",                 type: "TEXT" },
  { table: "generation_jobs",       column: "creator_id",                  type: "TEXT" },
  { table: "generation_jobs",       column: "creator_session_id",          type: "TEXT" },
  { table: "product_types",         column: "printify_costs",              type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "variant_prices_both",         type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "is_all_over_print",           type: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "product_types",         column: "placeholder_positions",       type: "TEXT DEFAULT '[]'" },
  { table: "style_presets",         column: "base_image_url",              type: "TEXT" },
  { table: "merchants",             column: "branding_settings",           type: "JSONB" },
  { table: "customers",              column: "email",                       type: "TEXT" },
  { table: "customers",              column: "otp_code",                    type: "TEXT" },
  { table: "customers",              column: "otp_expires_at",              type: "TIMESTAMP" },
  { table: "generation_jobs",       column: "mockup_urls",                 type: "JSON" },
  { table: "generation_jobs",       column: "design_state",                type: "JSON" },
  { table: 'generation_jobs',       column: 'user_prompt',                 type: 'TEXT' },
  { table: 'style_presets',         column: 'prompt_placeholder',          type: 'TEXT' },
  { table: 'style_presets',         column: 'options',                     type: 'JSONB' },
  { table: 'style_presets',         column: 'description_optional',        type: 'BOOLEAN NOT NULL DEFAULT FALSE' },
  { table: 'published_products',    column: 'expires_at',                  type: 'TIMESTAMP' },
  { table: 'published_products',    column: 'cart_added_at',               type: 'TIMESTAMP' },
  { table: 'generation_jobs',       column: 'shadow_product_id',           type: 'TEXT' },
  { table: 'generation_jobs',       column: 'shadow_variant_id',           type: 'TEXT' },
  { table: 'generation_jobs',       column: 'shadow_expires_at',           type: 'TIMESTAMP' },
  { table: 'product_types',         column: 'panel_flat_lay_images',       type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "aop_template_id",             type: "TEXT" },
  { table: "product_types",         column: "panel_mapping_template",      type: "TEXT" },
  { table: "product_types",         column: "on_the_fly_tier",             type: "TEXT" },
  { table: "product_types",         column: "flat_calibration_status",     type: "TEXT" },
  { table: "product_types",         column: "flat_calibration",            type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "storefront_mockup_mode",      type: "TEXT" },
  { table: "product_types",         column: "fulfillment_layout",        type: "TEXT" },
  { table: "product_types",         column: "fabric_weave_texture",      type: "BOOLEAN" },
  { table: "platform_catalog_blueprints", column: "storefront_mockup_mode", type: "TEXT" },
  { table: "platform_catalog_blueprints", column: "fulfillment_layout",       type: "TEXT" },
  { table: "platform_catalog_blueprints", column: "force_flat_harvest",       type: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "aop_calibration_runs",  column: "export_url",                  type: "TEXT" },
  { table: "design_products",       column: "printify_product_id",         type: "TEXT" },
  { table: "shopify_installations", column: "embed_confirmed_at",          type: "TIMESTAMP" },
  { table: "product_types",         column: "last_oos_scan_at",            type: "TIMESTAMP" },
  { table: "product_types",         column: "oos_available_variants",      type: "INTEGER" },
  { table: "product_types",         column: "oos_total_variants",          type: "INTEGER" },
  { table: "product_types",         column: "oos_status",                  type: "TEXT" },
  { table: "product_types",         column: "oos_detail",                  type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "pricing_version",             type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "product_types",         column: "last_product_sync_at",        type: "TIMESTAMP" },
  { table: "product_types",         column: "default_markup_percent",      type: "INTEGER" },
  { table: "product_types",         column: "pricing_strategy",            type: "TEXT NOT NULL DEFAULT 'notify_only'" },
  { table: "product_types",         column: "min_margin_percent",          type: "INTEGER" },
  { table: "product_types",         column: "product_health",              type: "TEXT NOT NULL DEFAULT 'healthy'" },
  { table: "product_types",         column: "variant_availability",        type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "shipping_snapshot",           type: "TEXT DEFAULT '{}'" },
  { table: "product_types",         column: "is_platform_catalog_ref",     type: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { table: "shopify_installations", column: "storefront_free_gens_per_visitor", type: "INTEGER NOT NULL DEFAULT 2" },
  { table: "shopify_installations", column: "leftover_gens_reminder_bucket_key", type: "TEXT" },
  { table: "shopify_installations", column: "wholesale_credit_cents", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "shopify_installations", column: "pricing_version", type: "INTEGER DEFAULT 0" },
  { table: "shopify_installations", column: "refresh_token", type: "TEXT" },
  { table: "shopify_installations", column: "access_token_expires_at", type: "TIMESTAMP" },
  { table: "shopify_installations", column: "refresh_token_expires_at", type: "TIMESTAMP" },
  { table: "credit_balances",        column: "earned_credits",             type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "credit_balances",        column: "pack_credits",               type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "credit_ledger",          column: "source",                     type: "TEXT" },
  { table: "credit_ledger",          column: "shop",                       type: "TEXT" },
  { table: "credit_ledger",          column: "related_entity_id",          type: "TEXT" },
  { table: "credit_ledger",          column: "quota_bucket_key",           type: "TEXT" },
  { table: "shared_designs",         column: "owner_customer_id",          type: "VARCHAR" },
];

/** One-time data fixes (idempotent WHERE clauses). */
const DATA_MIGRATIONS: string[] = [
  `ALTER TABLE customers ALTER COLUMN credits SET DEFAULT 0`,
  `ALTER TABLE shopify_installations ALTER COLUMN storefront_free_gens_per_visitor SET DEFAULT 2`,
  `UPDATE shopify_installations SET storefront_free_gens_per_visitor = 2`,
  // Required: every installation must have a pricing catalogue stamp for enforcement.
  `UPDATE shopify_installations SET pricing_version = 0 WHERE pricing_version IS NULL`,
  `ALTER TABLE shopify_installations ALTER COLUMN pricing_version SET DEFAULT 0`,
  // Trial allotment: 20 → 10 included generations (operator decision 2026-08).
  `UPDATE pricing_catalogue_plans
   SET generation_quota = 10
   WHERE plan_key = 'trial' AND generation_quota = 20`,
  // Adjustable tote: folded fulfillment + flat storefront mockups (override AOP name defaults).
  `UPDATE platform_catalog_blueprints
   SET fulfillment_layout = 'tote_folded_v1',
       storefront_mockup_mode = 'flat',
       force_flat_harvest = true
   WHERE printify_blueprint_id = 1300
     AND (fulfillment_layout IS NULL OR fulfillment_layout = '' OR fulfillment_layout = 'auto')`,
  `UPDATE platform_catalog_blueprints
   SET force_flat_harvest = true
   WHERE printify_blueprint_id = 1300
      OR fulfillment_layout = 'tote_folded_v1'`,
  `UPDATE product_types SET aop_template_id = 'leggings_v1'
   WHERE is_all_over_print = true
     AND printify_blueprint_id IN (256, 1050)
     AND (aop_template_id IS NULL OR aop_template_id = '')`,
  // Pin product 20 (unisex zip hoodie) to the new mesh-warp panel-mapping
  // template. When this is set, embed-design.tsx renders the new
  // HoodieAopPlacer instead of the legacy PatternCustomizer for this product.
  `UPDATE product_types SET panel_mapping_template = 'unisex-zip-hoodie-aop-L'
   WHERE id = 20
     AND (panel_mapping_template IS NULL OR panel_mapping_template = '')`,
  // Woven wall tapestry: enable procedural fabric weave on flat mockups.
  `UPDATE product_types SET fabric_weave_texture = true
   WHERE printify_blueprint_id = 1649
     AND fabric_weave_texture IS NULL`,
  // Vintage Poster: drop "travel poster" portrait bias — follow canvas orientation.
  `UPDATE style_presets
   SET prompt_prefix = 'A full-bleed vintage travel illustration in classic Art Deco advertising-lithograph style (flat color fields, bold graphic shapes, period typography) that fills the entire canvas edge-to-edge in the canvas orientation — wider-than-tall when the canvas is landscape, taller-than-wide when portrait — with color and scene extending to all edges of'
   WHERE LOWER(name) = 'vintage poster'
     AND (
       prompt_prefix ILIKE '%vintage travel poster%'
       OR prompt_prefix NOT ILIKE '%canvas orientation%'
     )`,
  // Wall Decals: product-level AR was portrait 2:3; per-size ARs are authoritative.
  `UPDATE product_types
   SET aspect_ratio = '1:1'
   WHERE printify_blueprint_id = 759
     AND aspect_ratio = '2:3'`,
  // Backfill materialized balances from the legacy customer columns.
  `INSERT INTO credit_balances (
      customer_id,
      credits,
      earned_credits,
      pack_credits,
      free_generations_used,
      version,
      updated_at
    )
    SELECT
      id,
      COALESCE(credits, 0),
      0,
      0,
      COALESCE(free_generations_used, 0),
      0,
      NOW()
    FROM customers
    ON CONFLICT (customer_id) DO NOTHING`,
  // Backfill identity aliases from legacy user_id values.
  `INSERT INTO customer_aliases (customer_id, alias_type, alias_value, shop)
    SELECT
      id,
      'shopify',
      split_part(user_id, ':', 4),
      split_part(user_id, ':', 2) || ':' || split_part(user_id, ':', 3)
    FROM customers
    WHERE user_id LIKE 'shopify:%:%'
    ON CONFLICT DO NOTHING`,
  `INSERT INTO customer_aliases (customer_id, alias_type, alias_value, shop)
    SELECT
      id,
      'otp_email',
      split_part(user_id, ':', 4),
      split_part(user_id, ':', 2) || ':' || split_part(user_id, ':', 3)
    FROM customers
    WHERE user_id LIKE 'email:%:%'
    ON CONFLICT DO NOTHING`,
  // Replay legacy credit transactions into the append-only ledger with stable
  // synthetic idempotency keys. This is only for audit/history; balances are
  // backfilled from customers above to preserve the currently visible state.
  `INSERT INTO credit_ledger (
      customer_id,
      delta_credits,
      source,
      reason,
      idempotency_key,
      external_ref,
      metadata,
      created_at
    )
    SELECT
      customer_id,
      amount,
      CASE WHEN type = 'purchase' THEN 'pack' ELSE NULL END,
      type,
      'legacy:credit_transaction:' || id,
      CASE WHEN order_id IS NULL THEN NULL ELSE 'legacy_order:' || order_id END,
      jsonb_build_object('description', description, 'priceInCents', price_in_cents),
      created_at
    FROM credit_transactions
    ON CONFLICT (idempotency_key) DO NOTHING`,
  // Repair balances affected by legacy decrement-only paths that lowered
  // customers.credits without lowering credit_balances.credits. Purchases and
  // coupon grants dual-write both columns, so the legacy column being lower is
  // a strong signal that credits were already consumed.
  `UPDATE credit_balances cb
    SET credits = c.credits,
        updated_at = NOW(),
        version = cb.version + 1
    FROM customers c
    WHERE cb.customer_id = c.id
      AND c.credits < cb.credits`,
  // Canonical hot-pink chroma prefixes for merchant apparel styles (matting-critical).
  `UPDATE style_presets
   SET prompt_prefix = 'T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors (avoid white, light colors, and hot pink/magenta in the design), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of',
       category = 'apparel'
   WHERE lower(name) = 'centered graphic'
     AND (prompt_prefix ILIKE '%white%' OR prompt_prefix NOT ILIKE '%#FF00FF%')`,
  `UPDATE style_presets
   SET prompt_prefix = 'T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors (avoid white, light colors, and hot pink/magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of',
       category = 'apparel'
   WHERE lower(name) = 'illustrated motif'
     AND (prompt_prefix ILIKE '%white%' OR prompt_prefix NOT ILIKE '%#FF00FF%')`,
  // Allow white inside subject (teeth, eyes) — matting now preserves connected-only removal.
  `UPDATE style_presets
   SET prompt_prefix = 'T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (avoid hot pink/magenta in the design), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of'
   WHERE lower(name) = 'centered graphic'
     AND prompt_prefix ILIKE '%avoid white, light colors%'`,
  `UPDATE style_presets
   SET prompt_prefix = 'T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (avoid hot pink/magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of'
   WHERE lower(name) = 'illustrated motif'
     AND prompt_prefix ILIKE '%avoid white, light colors%'`,
  `UPDATE style_presets
   SET prompt_prefix = 'T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (avoid hot pink/magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of'
   WHERE lower(name) = 'pet portraits'
     AND category = 'apparel'
     AND prompt_prefix ILIKE '%avoid white, light colors%'`,
  // Stronger DO NOT use hot pink language + dark-tier DB column (editable in Admin without redeploy).
  `UPDATE style_presets SET prompt_prefix = 'T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of', prompt_prefix_dark = 'T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of' WHERE lower(name) = 'illustrated motif'`,
  `UPDATE style_presets SET prompt_prefix = 'T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of', prompt_prefix_dark = 'T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of' WHERE lower(name) = 'centered graphic'`,
  `UPDATE style_presets SET prompt_prefix = 'T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of', prompt_prefix_dark = 'T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, clean illustrated style. Create a pet portrait of' WHERE lower(name) = 'pet portraits' AND category = 'apparel'`,
  // Creator Marketplace: seed accounting cost ($0.05). Do not overwrite if already set.
  `INSERT INTO platform_config ("key", "value", "updated_at")
   VALUES ('AI_GENERATION_COST_USD', '0.05', NOW())
   ON CONFLICT ("key") DO NOTHING`,
];

// ── Table creation ─────────────────────────────────────────────────────────────
// SQL matches shared/schema.ts exactly.
//
// Fresh environments (e.g. Railway Staging Postgres) have ZERO tables.
// drizzle-kit push is NOT run at deploy time — these CREATE TABLE IF NOT EXISTS
// statements (plus COLUMN_MIGRATIONS) are what bootstrap an empty database.
// Core tables that predate this file MUST be listed here or staging breaks.

const TABLE_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "pgcrypto_extension",
    sql: `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
  },
  {
    name: "users",
    sql: `
      CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar UNIQUE,
        "first_name" varchar,
        "last_name" varchar,
        "profile_image_url" varchar,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `,
  },
  {
    name: "merchants",
    sql: `
      CREATE TABLE IF NOT EXISTS "merchants" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL UNIQUE,
        "store_name" text,
        "printify_api_token" text,
        "printify_shop_id" text,
        "use_built_in_nano_banana" boolean NOT NULL DEFAULT true,
        "custom_nano_banana_token" text,
        "subscription_tier" text NOT NULL DEFAULT 'free',
        "monthly_generation_limit" integer NOT NULL DEFAULT 100,
        "generations_this_month" integer NOT NULL DEFAULT 0,
        "branding_settings" json,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "shopify_installations",
    sql: `
      CREATE TABLE IF NOT EXISTS "shopify_installations" (
        "id" serial PRIMARY KEY,
        "merchant_id" varchar,
        "shop_domain" text NOT NULL UNIQUE,
        "access_token" text NOT NULL,
        "refresh_token" text,
        "access_token_expires_at" timestamp,
        "refresh_token_expires_at" timestamp,
        "scope" text,
        "status" text NOT NULL DEFAULT 'active',
        "installed_at" timestamp DEFAULT now() NOT NULL,
        "uninstalled_at" timestamp,
        "customizer_hub_url" text,
        "plan_name" text,
        "plan_status" text,
        "trial_started_at" timestamp,
        "billing_subscription_id" text,
        "billing_usage_line_item_id" text,
        "billing_current_period_end" timestamp,
        "generation_month" text,
        "monthly_generations_used" integer NOT NULL DEFAULT 0,
        "monthly_overage_used" integer NOT NULL DEFAULT 0,
        "overage_opt_in_enabled" boolean NOT NULL DEFAULT false,
        "overage_budget_cents" integer,
        "overage_recurring" boolean NOT NULL DEFAULT false,
        "overage_opt_in_at" timestamp,
        "overage_opt_in_bucket_key" text,
        "quota_alert_90_bucket_key" text,
        "quota_alert_100_bucket_key" text,
        "pending_plan_name" text,
        "pending_plan_effective_at" timestamp,
        "embed_confirmed_at" timestamp,
        "storefront_free_gens_per_visitor" integer NOT NULL DEFAULT 2,
        "leftover_gens_reminder_bucket_key" text,
        "wholesale_credit_cents" integer NOT NULL DEFAULT 0,
        "pricing_version" integer DEFAULT 0
      )
    `,
  },
  {
    name: "pricing_catalogues",
    sql: `
      CREATE TABLE IF NOT EXISTS "pricing_catalogues" (
        "id" serial PRIMARY KEY,
        "label" text NOT NULL,
        "status" text NOT NULL,
        "overage_schedule" jsonb NOT NULL,
        "ai_cost_per_gen_usd" numeric(10, 4) NOT NULL DEFAULT 0.0450,
        "committed_at" timestamp DEFAULT now() NOT NULL,
        "activated_at" timestamp,
        "created_by" text
      )
    `,
  },
  {
    name: "pricing_catalogue_plans",
    sql: `
      CREATE TABLE IF NOT EXISTS "pricing_catalogue_plans" (
        "id" serial PRIMARY KEY,
        "catalogue_id" integer NOT NULL REFERENCES "pricing_catalogues"("id") ON DELETE CASCADE,
        "plan_key" text NOT NULL,
        "display_name" text NOT NULL,
        "price_usd" numeric(10, 2) NOT NULL,
        "generation_quota" integer NOT NULL,
        "page_limit" integer NOT NULL,
        "design_product_limit" integer NOT NULL DEFAULT 0,
        "overage_cap_units" integer NOT NULL DEFAULT 0,
        "margin_over_ai_cost_pct" numeric(6, 2) NOT NULL DEFAULT 50,
        "self_serve" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0
      )
    `,
  },
  {
    name: "customers",
    sql: `
      CREATE TABLE IF NOT EXISTS "customers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL UNIQUE,
        "credits" integer NOT NULL DEFAULT 0,
        "free_generations_used" integer NOT NULL DEFAULT 0,
        "total_generations" integer NOT NULL DEFAULT 0,
        "total_spent" numeric(10, 2) NOT NULL DEFAULT '0.00',
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "style_presets",
    sql: `
      CREATE TABLE IF NOT EXISTS "style_presets" (
        "id" serial PRIMARY KEY,
        "merchant_id" varchar NOT NULL,
        "name" text NOT NULL,
        "prompt_prefix" text NOT NULL,
        "prompt_prefix_dark" text,
        "category" text NOT NULL DEFAULT 'all',
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "base_image_url" text,
        "prompt_placeholder" text,
        "description_optional" boolean NOT NULL DEFAULT false,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "product_types",
    sql: `
      CREATE TABLE IF NOT EXISTS "product_types" (
        "id" serial PRIMARY KEY,
        "merchant_id" varchar,
        "name" text NOT NULL,
        "description" text,
        "printify_blueprint_id" integer,
        "printify_provider_id" integer,
        "mockup_template_url" text,
        "sizes" text NOT NULL DEFAULT '[]',
        "frame_colors" text NOT NULL DEFAULT '[]',
        "variant_map" text NOT NULL DEFAULT '{}',
        "selected_size_ids" text NOT NULL DEFAULT '[]',
        "selected_color_ids" text NOT NULL DEFAULT '[]',
        "aspect_ratio" text NOT NULL DEFAULT '3:4',
        "print_shape" text NOT NULL DEFAULT 'rectangle',
        "print_area_width" integer,
        "print_area_height" integer,
        "bleed_margin_percent" integer NOT NULL DEFAULT 5,
        "designer_type" text NOT NULL DEFAULT 'generic',
        "size_type" text NOT NULL DEFAULT 'dimensional',
        "has_printify_mockups" boolean NOT NULL DEFAULT false,
        "base_mockup_images" text NOT NULL DEFAULT '{}',
        "primary_mockup_index" integer NOT NULL DEFAULT 0,
        "double_sided_print" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "shopify_product_id" text,
        "shopify_product_handle" text,
        "shopify_product_url" text,
        "shopify_shop_domain" text,
        "shopify_variant_ids" json,
        "last_pushed_to_shopify" timestamp,
        "printify_costs" text DEFAULT '{}',
        "variant_prices_both" text DEFAULT '{}',
        "is_all_over_print" boolean NOT NULL DEFAULT false,
        "placeholder_positions" text DEFAULT '[]',
        "panel_flat_lay_images" text DEFAULT '{}',
        "aop_template_id" text,
        "panel_mapping_template" text,
        "on_the_fly_tier" text,
        "flat_calibration_status" text,
        "flat_calibration" text DEFAULT '{}',
        "storefront_mockup_mode" text,
        "fulfillment_layout" text,
        "fabric_weave_texture" boolean,
        "color_option_name" text,
        "last_oos_scan_at" timestamp,
        "oos_available_variants" integer,
        "oos_total_variants" integer,
        "oos_status" text,
        "oos_detail" text DEFAULT '{}',
        "pricing_version" integer NOT NULL DEFAULT 0,
        "last_product_sync_at" timestamp,
        "default_markup_percent" integer,
        "pricing_strategy" text NOT NULL DEFAULT 'notify_only',
        "min_margin_percent" integer,
        "product_health" text NOT NULL DEFAULT 'healthy',
        "variant_availability" text DEFAULT '{}',
        "shipping_snapshot" text DEFAULT '{}',
        "is_platform_catalog_ref" boolean NOT NULL DEFAULT false,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "credit_transactions",
    sql: `
      CREATE TABLE IF NOT EXISTS "credit_transactions" (
        "id" serial PRIMARY KEY,
        "customer_id" varchar NOT NULL,
        "type" text NOT NULL,
        "amount" integer NOT NULL,
        "price_in_cents" integer,
        "order_id" integer,
        "description" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    name: "design_sku_mappings",
    sql: `
      CREATE TABLE IF NOT EXISTS "design_sku_mappings" (
        "id"                         SERIAL PRIMARY KEY,
        "shop_domain"                TEXT NOT NULL,
        "source_variant_id"          TEXT NOT NULL,
        "design_id"                  TEXT NOT NULL,
        "mockup_url"                 TEXT NOT NULL,
        "shadow_shopify_product_id"  TEXT NOT NULL,
        "shadow_shopify_variant_id"  TEXT NOT NULL,
        "created_at"                 TIMESTAMP DEFAULT NOW() NOT NULL,
        "expires_at"                 TIMESTAMP NOT NULL
      )
    `,
  },
  {
    name: "customizer_pages",
    sql: `
      CREATE TABLE IF NOT EXISTS "customizer_pages" (
        "id"                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "shop"                  TEXT NOT NULL,
        "shopify_page_id"       TEXT,
        "handle"                TEXT NOT NULL,
        "title"                 TEXT NOT NULL,
        "base_product_id"       TEXT,
        "base_variant_id"       TEXT NOT NULL,
        "base_product_title"    TEXT,
        "base_variant_title"    TEXT,
        "base_product_price"    TEXT,
        "base_product_handle"   TEXT,
        "product_type_id"       INTEGER,
        "status"                TEXT NOT NULL DEFAULT 'active',
        "created_at"            TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"            TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "customizer_designs",
    sql: `
      CREATE TABLE IF NOT EXISTS "customizer_designs" (
        "id"                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "shop"                 TEXT NOT NULL,
        "shopify_customer_id"  TEXT,
        "customer_key"         TEXT,
        "base_product_id"      TEXT,
        "base_variant_id"      TEXT NOT NULL,
        "base_title"           TEXT,
        "prompt"               TEXT NOT NULL,
        "options"              JSON,
        "artwork_url"          TEXT,
        "mockup_url"           TEXT,
        "mockup_urls"          JSON,
        "status"               TEXT NOT NULL DEFAULT 'GENERATING',
        "error_message"        TEXT,
        "created_at"           TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"           TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "generation_jobs",
    sql: `
      CREATE TABLE IF NOT EXISTS "generation_jobs" (
        "id"                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "shop"                TEXT NOT NULL,
        "session_id"          TEXT,
        "customer_id"         TEXT,
        "status"              TEXT NOT NULL DEFAULT 'pending',
        "prompt"              TEXT NOT NULL,
        "style_preset"        TEXT,
        "size"                TEXT,
        "frame_color"         TEXT,
        "product_type_id"     TEXT,
        "reference_image_url" TEXT,
        "design_image_url"    TEXT,
        "thumbnail_url"       TEXT,
        "design_id"           TEXT,
        "error_message"       TEXT,
        "expires_at"          TIMESTAMP NOT NULL,
        "created_at"          TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"          TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "published_products",
    sql: `
      CREATE TABLE IF NOT EXISTS "published_products" (
        "id"                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "shop"                     TEXT NOT NULL,
        "design_id"                TEXT NOT NULL,
        "customer_key"             TEXT,
        "shopify_product_id"       TEXT NOT NULL,
        "shopify_variant_id"       TEXT NOT NULL,
        "shopify_product_handle"   TEXT,
        "base_variant_id"          TEXT NOT NULL,
        "status"                   TEXT NOT NULL DEFAULT 'active',
        "created_at"               TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"               TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "customer_aliases",
    sql: `
      CREATE TABLE IF NOT EXISTS "customer_aliases" (
        "id"          SERIAL PRIMARY KEY,
        "customer_id" VARCHAR NOT NULL,
        "alias_type"  TEXT NOT NULL,
        "alias_value" TEXT NOT NULL,
        "shop"        TEXT,
        "created_at"  TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "credit_balances",
    sql: `
      CREATE TABLE IF NOT EXISTS "credit_balances" (
        "customer_id"                 VARCHAR PRIMARY KEY,
        "credits"                     INTEGER NOT NULL DEFAULT 0 CHECK ("credits" >= 0),
        "earned_credits"              INTEGER NOT NULL DEFAULT 0 CHECK ("earned_credits" >= 0),
        "pack_credits"                INTEGER NOT NULL DEFAULT 0 CHECK ("pack_credits" >= 0),
        "free_generations_used"       INTEGER NOT NULL DEFAULT 0 CHECK ("free_generations_used" >= 0),
        "version"                     INTEGER NOT NULL DEFAULT 0,
        "updated_at"                  TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "credit_ledger",
    sql: `
      CREATE TABLE IF NOT EXISTS "credit_ledger" (
        "id"                       SERIAL PRIMARY KEY,
        "customer_id"              VARCHAR NOT NULL,
        "delta_credits"            INTEGER NOT NULL,
        "source"                   TEXT,
        "shop"                     TEXT,
        "related_entity_id"        TEXT,
        "quota_bucket_key"         TEXT,
        "reason"                   TEXT NOT NULL,
        "idempotency_key"          TEXT NOT NULL UNIQUE,
        "external_ref"             TEXT,
        "metadata"                 JSONB,
        "created_at"               TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "reward_ladder_rungs",
    sql: `
      CREATE TABLE IF NOT EXISTS "reward_ladder_rungs" (
        "id"              SERIAL PRIMARY KEY,
        "shop"            TEXT NOT NULL,
        "rung_key"        TEXT NOT NULL,
        "enabled"         BOOLEAN NOT NULL DEFAULT TRUE,
        "credit_amount"   INTEGER NOT NULL DEFAULT 1,
        "threshold_cents" INTEGER,
        "sort_order"      INTEGER NOT NULL DEFAULT 0,
        "created_at"      TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"      TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE ("shop", "rung_key")
      )
    `,
  },
  {
    name: "reward_grants",
    sql: `
      CREATE TABLE IF NOT EXISTS "reward_grants" (
        "id"                SERIAL PRIMARY KEY,
        "shop"              TEXT NOT NULL,
        "customer_id"       VARCHAR NOT NULL,
        "rung_key"          TEXT NOT NULL,
        "credits_granted"   INTEGER NOT NULL DEFAULT 0,
        "related_entity_id" TEXT,
        "idempotency_key"   TEXT NOT NULL UNIQUE,
        "created_at"        TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE ("shop", "customer_id", "rung_key")
      )
    `,
  },
  {
    name: "aop_calibration_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS "aop_calibration_runs" (
        "id"                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_type_id"      INTEGER,
        "blueprint_id"         INTEGER NOT NULL,
        "provider_id"          INTEGER NOT NULL,
        "variant_id"           INTEGER,
        "size"                 TEXT,
        "status"               TEXT NOT NULL DEFAULT 'pending',
        "printify_product_id"  TEXT,
        "printify_mockup_urls" JSONB,
        "print_areas_payload"  JSONB,
        "export_url"           TEXT,
        "error"                TEXT,
        "created_at"           TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"           TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "aop_calibration_panels",
    sql: `
      CREATE TABLE IF NOT EXISTS "aop_calibration_panels" (
        "id"                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id"                VARCHAR NOT NULL REFERENCES "aop_calibration_runs"("id") ON DELETE CASCADE,
        "panel_key"             TEXT NOT NULL,
        "width"                 INTEGER NOT NULL,
        "height"                INTEGER NOT NULL,
        "calibration_image_url" TEXT NOT NULL,
        "placement"             JSONB,
        "created_at"            TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "merchant_usage_charges",
    sql: `
      CREATE TABLE IF NOT EXISTS "merchant_usage_charges" (
        "id"                         SERIAL PRIMARY KEY,
        "installation_id"            INTEGER NOT NULL,
        "shop_domain"                TEXT NOT NULL,
        "bucket_key"                 TEXT NOT NULL,
        "overage_seq"                INTEGER NOT NULL,
        "subscription_line_item_id"  TEXT,
        "price_usd"                  NUMERIC(10,4) NOT NULL,
        "status"                     TEXT NOT NULL DEFAULT 'pending',
        "shopify_usage_record_id"    TEXT,
        "attempts"                   INTEGER NOT NULL DEFAULT 0,
        "error"                      TEXT,
        "created_at"                 TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"                 TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "aop_projection_maps",
    sql: `
      CREATE TABLE IF NOT EXISTS "aop_projection_maps" (
        "id"              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_type_id" INTEGER,
        "blueprint_id"    INTEGER NOT NULL,
        "provider_id"     INTEGER NOT NULL,
        "size"            TEXT,
        "map_json"        JSONB NOT NULL,
        "created_at"      TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"      TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "flat_order_submissions",
    sql: `
      CREATE TABLE IF NOT EXISTS "flat_order_submissions" (
        "id"                  SERIAL PRIMARY KEY,
        "idempotency_key"     TEXT NOT NULL UNIQUE,
        "shop"                TEXT,
        "shopify_order_id"    TEXT,
        "shopify_line_id"     TEXT,
        "design_id"           TEXT,
        "product_type_id"     INTEGER,
        "printify_shop_id"    TEXT,
        "printify_order_id"   TEXT,
        "status"              TEXT NOT NULL DEFAULT 'pending',
        "sent_to_production"  BOOLEAN NOT NULL DEFAULT FALSE,
        "is_test"             BOOLEAN NOT NULL DEFAULT FALSE,
        "print_file_urls"     JSONB,
        "error"               TEXT,
        "metadata"            JSONB,
        "created_at"          TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"          TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "merchant_generation_health",
    sql: `
      CREATE TABLE IF NOT EXISTS "merchant_generation_health" (
        "id"                   SERIAL PRIMARY KEY,
        "installation_id"      INTEGER NOT NULL UNIQUE,
        "shop_domain"          TEXT NOT NULL,
        "window_start"         TIMESTAMP NOT NULL,
        "success_count"        INTEGER NOT NULL DEFAULT 0,
        "failure_count"        INTEGER NOT NULL DEFAULT 0,
        "last_failure_at"      TIMESTAMP,
        "founder_alert_sent_at" TIMESTAMP,
        "updated_at"           TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "founder_alerts",
    sql: `
      CREATE TABLE IF NOT EXISTS "founder_alerts" (
        "id"               SERIAL PRIMARY KEY,
        "installation_id"  INTEGER,
        "shop_domain"      TEXT NOT NULL,
        "alert_type"       TEXT NOT NULL,
        "failure_rate"     NUMERIC(5,4),
        "attempts"         INTEGER,
        "email_sent"       BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"       TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "design_products",
    sql: `
      CREATE TABLE IF NOT EXISTS "design_products" (
        "id"                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchant_id"         VARCHAR NOT NULL,
        "shop"                TEXT NOT NULL,
        "job_id"              VARCHAR NOT NULL,
        "product_type_id"     INTEGER,
        "shopify_product_id"  TEXT,
        "handle"              TEXT,
        "title"               TEXT NOT NULL,
        "status"              TEXT NOT NULL DEFAULT 'active',
        "variant_map"         JSON,
        "mockup_urls"         JSON,
        "created_at"          TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"          TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "design_product_events",
    sql: `
      CREATE TABLE IF NOT EXISTS "design_product_events" (
        "id"                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "design_product_id"   VARCHAR NOT NULL,
        "event_type"          TEXT NOT NULL,
        "quantity"            INTEGER NOT NULL DEFAULT 1,
        "amount_cents"        INTEGER,
        "shopify_order_id"    TEXT,
        "cart_token"          TEXT,
        "created_at"          TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "oos_catalogue_scans",
    sql: `
      CREATE TABLE IF NOT EXISTS "oos_catalogue_scans" (
        "id"                SERIAL PRIMARY KEY,
        "ran_at"            TIMESTAMP DEFAULT NOW() NOT NULL,
        "products_scanned"  INTEGER NOT NULL DEFAULT 0,
        "fully_oos_count"   INTEGER NOT NULL DEFAULT 0,
        "critical_count"    INTEGER NOT NULL DEFAULT 0,
        "error_count"       INTEGER NOT NULL DEFAULT 0,
        "email_sent"        BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"        TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "platform_catalog_blueprints",
    sql: `
      CREATE TABLE IF NOT EXISTS "platform_catalog_blueprints" (
        "printify_blueprint_id"   INTEGER PRIMARY KEY,
        "label"                   TEXT NOT NULL,
        "brand"                   TEXT,
        "category"                TEXT,
        "kind"                    TEXT NOT NULL,
        "status"                  TEXT NOT NULL DEFAULT 'draft',
        "panel_mapping_template"  TEXT,
        "notes"                   TEXT,
        "tagged_at"               TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"              TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "catalog_variant_costs",
    sql: `
      CREATE TABLE IF NOT EXISTS "catalog_variant_costs" (
        "id"                            SERIAL PRIMARY KEY,
        "product_type_id"               INTEGER NOT NULL,
        "supplier"                      TEXT NOT NULL DEFAULT 'printify',
        "blueprint_id"                  INTEGER,
        "provider_id"                   INTEGER,
        "supplier_product_id"           TEXT,
        "supplier_variant_id"           TEXT NOT NULL,
        "product_name"                  TEXT,
        "variant_name"                  TEXT,
        "size"                          TEXT,
        "color"                         TEXT,
        "print_area_key"                TEXT NOT NULL DEFAULT 'front',
        "print_areas_json"              TEXT DEFAULT '[]',
        "base_cogs_cents"               INTEGER,
        "previous_cogs_cents"           INTEGER,
        "shipping_first_item_us_cents"  INTEGER,
        "currency"                      TEXT NOT NULL DEFAULT 'USD',
        "available"                     BOOLEAN NOT NULL DEFAULT TRUE,
        "availability_status"           TEXT NOT NULL DEFAULT 'unknown',
        "price_changed"                 BOOLEAN NOT NULL DEFAULT FALSE,
        "availability_changed"          BOOLEAN NOT NULL DEFAULT FALSE,
        "is_new_variant"                BOOLEAN NOT NULL DEFAULT FALSE,
        "is_removed"                    BOOLEAN NOT NULL DEFAULT FALSE,
        "pricing_version"               INTEGER NOT NULL DEFAULT 1,
        "cost_checksum"                 TEXT,
        "last_synced_at"                TIMESTAMP DEFAULT NOW() NOT NULL,
        "price_last_changed_at"         TIMESTAMP,
        "created_at"                    TIMESTAMP DEFAULT NOW() NOT NULL,
        "updated_at"                    TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "catalog_sync_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS "catalog_sync_runs" (
        "id"                      SERIAL PRIMARY KEY,
        "scope"                   TEXT NOT NULL DEFAULT 'catalogue',
        "product_type_id"         INTEGER,
        "source"                  TEXT NOT NULL DEFAULT 'manual',
        "status"                  TEXT NOT NULL DEFAULT 'running',
        "products_checked"        INTEGER NOT NULL DEFAULT 0,
        "variants_checked"        INTEGER NOT NULL DEFAULT 0,
        "price_changes"           INTEGER NOT NULL DEFAULT 0,
        "availability_changes"    INTEGER NOT NULL DEFAULT 0,
        "new_variants"            INTEGER NOT NULL DEFAULT 0,
        "removed_variants"        INTEGER NOT NULL DEFAULT 0,
        "sync_failures"           INTEGER NOT NULL DEFAULT 0,
        "summary_json"            TEXT DEFAULT '{}',
        "error"                   TEXT,
        "started_at"              TIMESTAMP DEFAULT NOW() NOT NULL,
        "finished_at"             TIMESTAMP,
        "created_at"              TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "catalog_variant_cost_history",
    sql: `
      CREATE TABLE IF NOT EXISTS "catalog_variant_cost_history" (
        "id"                           SERIAL PRIMARY KEY,
        "product_type_id"              INTEGER NOT NULL,
        "supplier"                     TEXT NOT NULL DEFAULT 'printify',
        "supplier_variant_id"          TEXT NOT NULL,
        "print_area_key"               TEXT NOT NULL DEFAULT 'front',
        "pricing_version"              INTEGER NOT NULL,
        "previous_cogs_cents"          INTEGER,
        "new_cogs_cents"               INTEGER,
        "previous_shipping_us_cents"   INTEGER,
        "new_shipping_us_cents"        INTEGER,
        "change_reason"                TEXT NOT NULL,
        "sync_run_id"                  INTEGER,
        "changed_at"                   TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "catalog_sync_events",
    sql: `
      CREATE TABLE IF NOT EXISTS "catalog_sync_events" (
        "id"                   SERIAL PRIMARY KEY,
        "product_type_id"      INTEGER,
        "sync_run_id"          INTEGER,
        "pricing_version"      INTEGER,
        "event_type"           TEXT NOT NULL,
        "supplier_variant_id"  TEXT,
        "print_area_key"       TEXT,
        "payload_json"         TEXT DEFAULT '{}',
        "created_at"           TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "platform_config",
    sql: `
      CREATE TABLE IF NOT EXISTS "platform_config" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creators",
    sql: `
      CREATE TABLE IF NOT EXISTS "creators" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" text NOT NULL,
        "subdomain" text NOT NULL,
        "display_name" text NOT NULL,
        "email" text NOT NULL,
        "first_name" text,
        "last_name" text,
        "social_platform" text,
        "social_username" text,
        "social_url" text,
        "follower_count" integer,
        "niche" text,
        "audience_description" text,
        "profile_image_url" text,
        "bio" text,
        "status" text NOT NULL DEFAULT 'application',
        "creator_type" text NOT NULL DEFAULT 'creator',
        "shop_domain" text,
        "onboarding_status" text NOT NULL DEFAULT 'pending',
        "onboarding_checklist" jsonb,
        "branding" jsonb,
        "beta_start_at" timestamp,
        "beta_end_at" timestamp,
        "free_gens_per_customer" integer NOT NULL DEFAULT 2,
        "monthly_generation_allowance" integer NOT NULL DEFAULT 250,
        "generation_month" text,
        "monthly_generations_used" integer NOT NULL DEFAULT 0,
        "overage_cap" integer NOT NULL DEFAULT 0,
        "share_basis" text NOT NULL DEFAULT 'net_contribution',
        "revenue_share_creator_pct" integer NOT NULL DEFAULT 100,
        "revenue_share_aas_pct" integer NOT NULL DEFAULT 0,
        "agreement_status" text,
        "agreement_start_at" timestamp,
        "agreement_end_at" timestamp,
        "email_automation_toggles" jsonb,
        "application_id" varchar,
        "created_at" timestamp DEFAULT NOW() NOT NULL,
        "updated_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_applications",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_applications" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "first_name" text NOT NULL,
        "last_name" text NOT NULL,
        "email" text NOT NULL,
        "social_platform" text NOT NULL,
        "social_username" text NOT NULL,
        "social_url" text,
        "follower_count" integer,
        "niche" text NOT NULL,
        "audience_description" text,
        "has_shopify_store" boolean NOT NULL DEFAULT FALSE,
        "shopify_store_url" text,
        "interested_products" text,
        "preferred_category" text,
        "why_participate" text,
        "expected_reach" text,
        "additional_info" text,
        "status" text NOT NULL DEFAULT 'submitted',
        "assigned_username" text,
        "creator_id" varchar,
        "admin_notes" text,
        "reviewed_at" timestamp,
        "reviewed_by" text,
        "created_at" timestamp DEFAULT NOW() NOT NULL,
        "updated_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_customizer_pages",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_customizer_pages" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar NOT NULL,
        "customizer_page_id" varchar NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "title_override" text,
        "description_override" text,
        "enabled" boolean NOT NULL DEFAULT TRUE,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_sessions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "creator_id" varchar NOT NULL,
        "first_seen_at" timestamp DEFAULT NOW() NOT NULL,
        "last_seen_at" timestamp DEFAULT NOW() NOT NULL,
        "landing_path" text,
        "referrer" text,
        "utm_source" text,
        "utm_medium" text,
        "utm_campaign" text,
        "utm_content" text,
        "device" text,
        "country" text
      )
    `,
  },
  {
    name: "creator_events",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_events" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar NOT NULL,
        "session_id" varchar,
        "event_type" text NOT NULL,
        "customizer_page_id" varchar,
        "product_type_id" integer,
        "generation_job_id" varchar,
        "style_preset" text,
        "metadata" jsonb,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_customer_free_gens",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_customer_free_gens" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar NOT NULL,
        "customer_id" text NOT NULL,
        "used" integer NOT NULL DEFAULT 0,
        "updated_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_generation_costs",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_generation_costs" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar NOT NULL,
        "generation_job_id" varchar NOT NULL,
        "session_id" varchar,
        "customer_id" text,
        "customizer_page_id" varchar,
        "cost_cents" integer NOT NULL,
        "billing_mode" text,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_daily_stats",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_daily_stats" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar NOT NULL,
        "day" text NOT NULL,
        "visitors" integer NOT NULL DEFAULT 0,
        "sessions" integer NOT NULL DEFAULT 0,
        "page_views" integer NOT NULL DEFAULT 0,
        "generations" integer NOT NULL DEFAULT 0,
        "gen_cost_cents" integer NOT NULL DEFAULT 0,
        "atc_count" integer NOT NULL DEFAULT 0,
        "orders" integer NOT NULL DEFAULT 0,
        "gross_cents" integer NOT NULL DEFAULT 0,
        "product_profit_cents" integer NOT NULL DEFAULT 0,
        "net_contribution_cents" integer NOT NULL DEFAULT 0,
        "updated_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_orders",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_orders" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "creator_id" varchar NOT NULL,
        "shopify_order_id" text NOT NULL,
        "shopify_order_name" text,
        "session_id" varchar,
        "attribution_snapshot" jsonb,
        "gross_cents" integer NOT NULL DEFAULT 0,
        "discount_cents" integer NOT NULL DEFAULT 0,
        "shipping_collected_cents" integer NOT NULL DEFAULT 0,
        "fulfilment_cost_cents" integer NOT NULL DEFAULT 0,
        "transaction_fee_cents" integer NOT NULL DEFAULT 0,
        "product_profit_cents" integer NOT NULL DEFAULT 0,
        "ai_gen_cost_cents" integer NOT NULL DEFAULT 0,
        "net_contribution_cents" integer NOT NULL DEFAULT 0,
        "creator_share_cents" integer NOT NULL DEFAULT 0,
        "aas_share_cents" integer NOT NULL DEFAULT 0,
        "refund_cents" integer NOT NULL DEFAULT 0,
        "status" text NOT NULL DEFAULT 'paid',
        "payout_id" varchar,
        "created_at" timestamp DEFAULT NOW() NOT NULL,
        "updated_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_order_lines",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_order_lines" (
        "id" serial PRIMARY KEY,
        "creator_order_id" varchar NOT NULL,
        "shopify_line_id" text,
        "product_type_id" integer,
        "generation_job_id" varchar,
        "quantity" integer NOT NULL DEFAULT 1,
        "unit_revenue_cents" integer NOT NULL DEFAULT 0,
        "unit_cogs_cents" integer NOT NULL DEFAULT 0,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_rank_snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_rank_snapshots" (
        "id" serial PRIMARY KEY,
        "period_type" text NOT NULL,
        "period_key" text NOT NULL,
        "metric_key" text NOT NULL,
        "creator_id" varchar NOT NULL,
        "value_cents" integer,
        "value" numeric(18, 6),
        "rank" integer NOT NULL,
        "of_count" integer NOT NULL,
        "percentile" numeric(8, 4),
        "share_pct" numeric(8, 4),
        "computed_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_payouts",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_payouts" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "creator_id" varchar NOT NULL,
        "period_start" timestamp,
        "period_end" timestamp,
        "amount_cents" integer NOT NULL,
        "method" text,
        "status" text NOT NULL DEFAULT 'pending',
        "admin_note" text,
        "paid_at" timestamp,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_notes",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_notes" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar,
        "application_id" varchar,
        "author" text,
        "body" text NOT NULL,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    name: "creator_email_log",
    sql: `
      CREATE TABLE IF NOT EXISTS "creator_email_log" (
        "id" serial PRIMARY KEY,
        "creator_id" varchar,
        "application_id" varchar,
        "template_key" text NOT NULL,
        "recipient" text NOT NULL,
        "status" text NOT NULL DEFAULT 'skipped',
        "error" text,
        "sent_at" timestamp,
        "created_at" timestamp DEFAULT NOW() NOT NULL
      )
    `,
  },
];

const INDEX_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "customer_aliases_alias_unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "customer_aliases_alias_unique"
      ON "customer_aliases" ("alias_type", "alias_value", COALESCE("shop", ''))`,
  },
  {
    name: "customer_aliases_customer_idx",
    sql: `CREATE INDEX IF NOT EXISTS "customer_aliases_customer_idx"
      ON "customer_aliases" ("customer_id")`,
  },
  {
    name: "credit_ledger_customer_created_idx",
    sql: `CREATE INDEX IF NOT EXISTS "credit_ledger_customer_created_idx"
      ON "credit_ledger" ("customer_id", "created_at")`,
  },
  {
    name: "credit_ledger_related_entity_idx",
    sql: `CREATE INDEX IF NOT EXISTS "credit_ledger_related_entity_idx"
      ON "credit_ledger" ("related_entity_id")`,
  },
  {
    name: "reward_ladder_rungs_shop_idx",
    sql: `CREATE INDEX IF NOT EXISTS "reward_ladder_rungs_shop_idx"
      ON "reward_ladder_rungs" ("shop")`,
  },
  {
    name: "reward_grants_customer_idx",
    sql: `CREATE INDEX IF NOT EXISTS "reward_grants_customer_idx"
      ON "reward_grants" ("customer_id")`,
  },
  {
    name: "aop_calibration_runs_product_type_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_calibration_runs_product_type_idx"
      ON "aop_calibration_runs" ("product_type_id")`,
  },
  {
    name: "aop_calibration_runs_created_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_calibration_runs_created_idx"
      ON "aop_calibration_runs" ("created_at")`,
  },
  {
    name: "aop_calibration_panels_run_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_calibration_panels_run_idx"
      ON "aop_calibration_panels" ("run_id")`,
  },
  {
    name: "aop_calibration_panels_panel_key_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_calibration_panels_panel_key_idx"
      ON "aop_calibration_panels" ("panel_key")`,
  },
  {
    name: "aop_projection_maps_product_type_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_projection_maps_product_type_idx"
      ON "aop_projection_maps" ("product_type_id")`,
  },
  {
    name: "aop_projection_maps_blueprint_provider_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_projection_maps_blueprint_provider_idx"
      ON "aop_projection_maps" ("blueprint_id", "provider_id")`,
  },
  {
    name: "aop_projection_maps_created_idx",
    sql: `CREATE INDEX IF NOT EXISTS "aop_projection_maps_created_idx"
      ON "aop_projection_maps" ("created_at")`,
  },
  {
    name: "merchant_usage_charges_unit_unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "merchant_usage_charges_unit_unique"
      ON "merchant_usage_charges" ("installation_id", "bucket_key", "overage_seq")`,
  },
  {
    name: "merchant_usage_charges_status_idx",
    sql: `CREATE INDEX IF NOT EXISTS "merchant_usage_charges_status_idx"
      ON "merchant_usage_charges" ("installation_id", "status")`,
  },
  {
    name: "flat_order_submissions_order_idx",
    sql: `CREATE INDEX IF NOT EXISTS "flat_order_submissions_order_idx"
      ON "flat_order_submissions" ("shopify_order_id")`,
  },
  {
    name: "flat_order_submissions_product_type_idx",
    sql: `CREATE INDEX IF NOT EXISTS "flat_order_submissions_product_type_idx"
      ON "flat_order_submissions" ("product_type_id")`,
  },
  {
    name: "merchant_generation_health_shop_idx",
    sql: `CREATE INDEX IF NOT EXISTS "merchant_generation_health_shop_idx"
      ON "merchant_generation_health" ("shop_domain")`,
  },
  {
    name: "founder_alerts_shop_idx",
    sql: `CREATE INDEX IF NOT EXISTS "founder_alerts_shop_idx"
      ON "founder_alerts" ("shop_domain", "created_at")`,
  },
  {
    name: "catalog_variant_costs_product_type_idx",
    sql: `CREATE INDEX IF NOT EXISTS "catalog_variant_costs_product_type_idx"
      ON "catalog_variant_costs" ("product_type_id")`,
  },
  {
    name: "catalog_variant_costs_variant_unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "catalog_variant_costs_variant_unique"
      ON "catalog_variant_costs" ("product_type_id", "supplier", "supplier_variant_id", "print_area_key")`,
  },
  {
    name: "catalog_variant_cost_history_product_idx",
    sql: `CREATE INDEX IF NOT EXISTS "catalog_variant_cost_history_product_idx"
      ON "catalog_variant_cost_history" ("product_type_id")`,
  },
  {
    name: "catalog_sync_events_product_idx",
    sql: `CREATE INDEX IF NOT EXISTS "catalog_sync_events_product_idx"
      ON "catalog_sync_events" ("product_type_id")`,
  },
  {
    name: "catalog_sync_events_run_idx",
    sql: `CREATE INDEX IF NOT EXISTS "catalog_sync_events_run_idx"
      ON "catalog_sync_events" ("sync_run_id")`,
  },
  {
    name: "pricing_catalogue_plans_catalogue_plan_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_catalogue_plans_catalogue_plan_uidx"
      ON "pricing_catalogue_plans" ("catalogue_id", "plan_key")`,
  },
  {
    name: "pricing_catalogues_status_idx",
    sql: `CREATE INDEX IF NOT EXISTS "pricing_catalogues_status_idx"
      ON "pricing_catalogues" ("status")`,
  },

  {
    name: "design_products_merchant_idx",
    sql: `CREATE INDEX IF NOT EXISTS "design_products_merchant_idx"
      ON "design_products" ("merchant_id", "status")`,
  },
  {
    name: "design_products_shop_idx",
    sql: `CREATE INDEX IF NOT EXISTS "design_products_shop_idx"
      ON "design_products" ("shop")`,
  },
  {
    name: "design_products_job_idx",
    sql: `CREATE INDEX IF NOT EXISTS "design_products_job_idx"
      ON "design_products" ("job_id")`,
  },
  {
    name: "design_product_events_product_idx",
    sql: `CREATE INDEX IF NOT EXISTS "design_product_events_product_idx"
      ON "design_product_events" ("design_product_id", "event_type", "created_at")`,
  },
  {
    name: "design_product_events_cart_token_idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "design_product_events_cart_token_idx"
      ON "design_product_events" ("design_product_id", "cart_token")
      WHERE "event_type" = 'atc' AND "cart_token" IS NOT NULL`,
  },
  {
    // "cart_token" is reused for sale events as a per-line dedupe key (shopify line_item id)
    // so replayed orders/paid webhooks never double-count revenue for the same order line.
    name: "design_product_events_sale_dedupe_idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "design_product_events_sale_dedupe_idx"
      ON "design_product_events" ("design_product_id", "shopify_order_id", "cart_token")
      WHERE "event_type" = 'sale' AND "shopify_order_id" IS NOT NULL AND "cart_token" IS NOT NULL`,
  },
  {
    name: "creators_username_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creators_username_uidx" ON "creators" ("username")`,
  },
  {
    name: "creators_subdomain_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creators_subdomain_uidx" ON "creators" ("subdomain")`,
  },
  {
    name: "creators_status_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creators_status_idx" ON "creators" ("status")`,
  },
  {
    name: "creators_email_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creators_email_idx" ON "creators" ("email")`,
  },
  {
    name: "creator_applications_status_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creator_applications_status_idx" ON "creator_applications" ("status")`,
  },
  {
    name: "creator_applications_email_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creator_applications_email_idx" ON "creator_applications" ("email")`,
  },
  {
    name: "creator_applications_created_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creator_applications_created_idx" ON "creator_applications" ("created_at")`,
  },
  {
    name: "creator_customizer_pages_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_customizer_pages_uidx"
      ON "creator_customizer_pages" ("creator_id", "customizer_page_id")`,
  },
  {
    name: "creator_sessions_creator_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creator_sessions_creator_idx"
      ON "creator_sessions" ("creator_id", "last_seen_at")`,
  },
  {
    name: "creator_events_creator_idx",
    sql: `CREATE INDEX IF NOT EXISTS "creator_events_creator_idx"
      ON "creator_events" ("creator_id", "created_at")`,
  },
  {
    name: "creator_customer_free_gens_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_customer_free_gens_uidx"
      ON "creator_customer_free_gens" ("creator_id", "customer_id")`,
  },
  {
    name: "creator_generation_costs_job_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_generation_costs_job_uidx"
      ON "creator_generation_costs" ("generation_job_id")`,
  },
  {
    name: "creator_daily_stats_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_daily_stats_uidx"
      ON "creator_daily_stats" ("creator_id", "day")`,
  },
  {
    name: "creator_orders_shopify_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_orders_shopify_uidx"
      ON "creator_orders" ("creator_id", "shopify_order_id")`,
  },
  {
    name: "creator_rank_snapshots_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "creator_rank_snapshots_uidx"
      ON "creator_rank_snapshots" ("period_type", "period_key", "metric_key", "creator_id")`,
  },
];

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runStartupMigrations(): Promise<void> {
  const tag = "[startup-migration]";
  console.log(`${tag} Running idempotent schema checks…`);

  let applied = 0;
  let errors  = 0;

  // 1) Create tables
  for (const m of TABLE_MIGRATIONS) {
    try {
      await pool.query(m.sql);
      applied++;
    } catch (err: any) {
      errors++;
      console.error(`${tag} FAILED creating table ${m.name}: ${err.message ?? err}`);
    }
  }

  // 2) Add indexes
  for (const m of INDEX_MIGRATIONS) {
    try {
      await pool.query(m.sql);
      applied++;
    } catch (err: any) {
      errors++;
      console.error(`${tag} FAILED creating index ${m.name}: ${err.message ?? err}`);
    }
  }

  // 3) Add columns
  for (const m of COLUMN_MIGRATIONS) {
    try {
      await pool.query(
        `ALTER TABLE "${m.table}" ADD COLUMN IF NOT EXISTS "${m.column}" ${m.type}`
      );
      applied++;
    } catch (err: any) {
      errors++;
      console.error(`${tag} FAILED adding column ${m.table}.${m.column}: ${err.message ?? err}`);
    }
  }

  // 4) Data migrations (safe re-runs)
  for (const sql of DATA_MIGRATIONS) {
    try {
      const r = await pool.query(sql);
      applied++;
      const n = (r as { rowCount?: number }).rowCount;
      if (n && n > 0) {
        console.log(`${tag} Data migration updated ${n} row(s)`);
      }
    } catch (err: any) {
      errors++;
      console.error(`${tag} FAILED data migration: ${err.message ?? err}`);
    }
  }

  const total = TABLE_MIGRATIONS.length + INDEX_MIGRATIONS.length + COLUMN_MIGRATIONS.length + DATA_MIGRATIONS.length;
  console.log(`${tag} Done. total=${total} applied=${applied} errors=${errors}`);
  if (errors > 0) {
    console.error(`${tag} WARNING: ${errors} statement(s) failed — some routes may be degraded.`);
  }
}
