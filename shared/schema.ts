import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean, decimal, json, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";
export * from "./colorUtils";
export {
  APPAREL_CHROMA_STYLE_BY_NAME,
  APPAREL_DARK_TIER_PROMPTS,
  NO_HOT_PINK_IN_DESIGN,
} from "./apparel-chroma-prompts";
import { APPAREL_CHROMA_STYLE_BY_NAME, APPAREL_DARK_TIER_PROMPTS } from "./apparel-chroma-prompts";
import { GRAPHICS_CHROMA_STYLE_BY_ID } from "./graphics-chroma-prompts";
import { literalUserSlotSchema } from "./promptLayers";

// Customer table extending auth users with credits
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  credits: integer("credits").notNull().default(0),
  freeGenerationsUsed: integer("free_generations_used").notNull().default(0),
  totalGenerations: integer("total_generations").notNull().default(0),
  totalSpent: decimal("total_spent", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

// Stable customer identity aliases. Every storefront identifier (Shopify
// customer id, OTP email, anonymous session) resolves to one internal customer.
export const customerAliases = pgTable("customer_aliases", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  aliasType: text("alias_type").notNull(), // shopify | otp_email | anon_session
  aliasValue: text("alias_value").notNull(),
  shop: text("shop"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("customer_aliases_alias_unique").on(table.aliasType, table.aliasValue, table.shop),
  index("customer_aliases_customer_idx").on(table.customerId),
]);

export const insertCustomerAliasSchema = createInsertSchema(customerAliases).omit({
  id: true,
  createdAt: true,
});
export type CustomerAlias = typeof customerAliases.$inferSelect;
export type InsertCustomerAlias = z.infer<typeof insertCustomerAliasSchema>;

// Materialized credit balance. Atomic enforcement point for Studio Credits;
// credit_ledger is the audit + idempotency trail.
export const creditBalances = pgTable("credit_balances", {
  customerId: varchar("customer_id").primaryKey(),
  /** Total Studio Credits (earned + pack). Authoritative for spend checks. */
  credits: integer("credits").notNull().default(0),
  /** Credits earned via Reward Ladder (burn merchant quota at spend). */
  earnedCredits: integer("earned_credits").notNull().default(0),
  /** Credits from merchant-mediated packs (billed wholesale at grant; no quota burn). */
  packCredits: integer("pack_credits").notNull().default(0),
  freeGenerationsUsed: integer("free_generations_used").notNull().default(0),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCreditBalanceSchema = createInsertSchema(creditBalances);
export type CreditBalance = typeof creditBalances.$inferSelect;
export type InsertCreditBalance = z.infer<typeof insertCreditBalanceSchema>;

// Append-only credit ledger. Every mutation must have a stable idempotency key.
export const creditLedger = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  deltaCredits: integer("delta_credits").notNull(),
  /** Bucket this delta applies to: earned | pack (null for free_generation bookkeeping). */
  source: text("source"),
  shop: text("shop"),
  relatedEntityId: text("related_entity_id"),
  quotaBucketKey: text("quota_bucket_key"),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  externalRef: text("external_ref"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("credit_ledger_customer_created_idx").on(table.customerId, table.createdAt),
  index("credit_ledger_related_entity_idx").on(table.relatedEntityId),
]);

export const insertCreditLedgerSchema = createInsertSchema(creditLedger).omit({
  id: true,
  createdAt: true,
});
export type CreditLedger = typeof creditLedger.$inferSelect;
export type InsertCreditLedger = z.infer<typeof insertCreditLedgerSchema>;

/** Per-shop Reward Ladder rung configuration. */
export const rewardLadderRungs = pgTable("reward_ladder_rungs", {
  id: serial("id").primaryKey(),
  shop: text("shop").notNull(),
  /** free_anonymous | email_signup | share_design | purchase_threshold */
  rungKey: text("rung_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Credits granted when the rung is completed (free_anonymous uses free-gen limit instead). */
  creditAmount: integer("credit_amount").notNull().default(1),
  /** For purchase_threshold: minimum order subtotal in cents. */
  thresholdCents: integer("threshold_cents"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reward_ladder_rungs_shop_key").on(table.shop, table.rungKey),
  index("reward_ladder_rungs_shop_idx").on(table.shop),
]);

export const insertRewardLadderRungSchema = createInsertSchema(rewardLadderRungs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type RewardLadderRung = typeof rewardLadderRungs.$inferSelect;
export type InsertRewardLadderRung = z.infer<typeof insertRewardLadderRungSchema>;

/**
 * Reward Ladder grants.
 * Intended uniqueness (see server/migrations/reward-grants-repeatable-rungs.sql — not auto-run):
 *   email_signup / other: UNIQUE (shop, customer_id, rung_key)
 *   share_design / purchase_threshold: UNIQUE (shop, customer_id, rung_key, related_entity_id)
 * Drizzle still declares the old once-per-rung index so `drizzle-kit push` does not drop it first.
 */
export const rewardGrants = pgTable("reward_grants", {
  id: serial("id").primaryKey(),
  shop: text("shop").notNull(),
  customerId: varchar("customer_id").notNull(),
  rungKey: text("rung_key").notNull(),
  creditsGranted: integer("credits_granted").notNull().default(0),
  relatedEntityId: text("related_entity_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reward_grants_shop_customer_rung").on(table.shop, table.customerId, table.rungKey),
  index("reward_grants_customer_idx").on(table.customerId),
]);

export const insertRewardGrantSchema = createInsertSchema(rewardGrants).omit({
  id: true,
  createdAt: true,
});
export type RewardGrant = typeof rewardGrants.$inferSelect;
export type InsertRewardGrant = z.infer<typeof insertRewardGrantSchema>;

// Merchant settings
export const merchants = pgTable("merchants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  storeName: text("store_name"),
  printifyApiToken: text("printify_api_token"),
  printifyShopId: text("printify_shop_id"),
  useBuiltInNanoBanana: boolean("use_built_in_nano_banana").notNull().default(true),
  customNanoBananaToken: text("custom_nano_banana_token"),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  monthlyGenerationLimit: integer("monthly_generation_limit").notNull().default(100),
  generationsThisMonth: integer("generations_this_month").notNull().default(0),
  brandingSettings: json("branding_settings"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Shopify app installations - separate from merchants for multi-shop support
export const shopifyInstallations = pgTable("shopify_installations", {
  id: serial("id").primaryKey(),
  merchantId: varchar("merchant_id"),
  shopDomain: text("shop_domain").notNull().unique(),
  accessToken: text("access_token").notNull(),
  /** Refresh token for Shopify expiring offline access tokens (null = legacy non-expiring). */
  refreshToken: text("refresh_token"),
  /** When accessToken expires (null = non-expiring / unknown). */
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  /** When refreshToken expires (typically ~90 days). */
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  status: text("status").notNull().default("active"),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
  uninstalledAt: timestamp("uninstalled_at"),
  // Per-shop customizer settings
  customizerHubUrl: text("customizer_hub_url"), // Fallback redirect URL for disabled customizer pages; defaults to "/"
  // Billing / plan state
  // planName: trial | starter | dabbler | pro | pro_plus  (null = no plan selected yet)
  // planStatus: trialing | active | expired | cancelled   (null = no plan)
  planName: text("plan_name"),
  planStatus: text("plan_status"),
  trialStartedAt: timestamp("trial_started_at"),
  billingSubscriptionId: text("billing_subscription_id"), // Shopify AppSubscription GID
  // Shopify AppSubscriptionLineItem GID for the metered (usage) pricing line.
  // Set when a paid subscription is created/approved with an overage usage line.
  // Null for trial subscriptions (no overage) and for legacy subscribers who
  // subscribed before usage-charge billing existed — those merchants must
  // re-subscribe to enable overage billing (see /api/appai/billing/plan).
  billingUsageLineItemId: text("billing_usage_line_item_id"),
  billingCurrentPeriodEnd: timestamp("billing_current_period_end"),
  // Per-merchant generation metering (plan quota enforcement).
  // generationMonth is the bucket key the counters belong to:
  //   - "YYYY-MM" (UTC) for paid plans (resets each calendar month)
  //   - "trial"          for trial / no-plan (cumulative — 20 free total, never resets)
  // monthlyGenerationsUsed counts ALL generations (free + overage) in the bucket.
  // monthlyOverageUsed counts only the overage units (for billing tally).
  generationMonth: text("generation_month"),
  monthlyGenerationsUsed: integer("monthly_generations_used").notNull().default(0),
  monthlyOverageUsed: integer("monthly_overage_used").notNull().default(0),
  // Merchant opt-in for pay-as-you-go overage (USD; billed per generation after included quota).
  overageOptInEnabled: boolean("overage_opt_in_enabled").notNull().default(false),
  overageBudgetCents: integer("overage_budget_cents"),
  overageRecurring: boolean("overage_recurring").notNull().default(false),
  overageOptInAt: timestamp("overage_opt_in_at"),
  overageOptInBucketKey: text("overage_opt_in_bucket_key"),
  quotaAlert90BucketKey: text("quota_alert_90_bucket_key"),
  quotaAlert100BucketKey: text("quota_alert_100_bucket_key"),
  /** Deferred plan change (downgrades take effect at billing period end). */
  pendingPlanName: text("pending_plan_name"),
  pendingPlanEffectiveAt: timestamp("pending_plan_effective_at"),
  /** Merchant clicked "I've enabled it" on the setup rail's App Embed step. */
  embedConfirmedAt: timestamp("embed_confirmed_at"),
  /**
   * Free AI generations each unique storefront visitor gets before paid credits.
   * Clamped 1–10 in app code; default 2.
   */
  storefrontFreeGensPerVisitor: integer("storefront_free_gens_per_visitor").notNull().default(2),
  /** Bucket key of last "leftover gens / coupon promo" reminder email (YYYY-MM). */
  leftoverGensReminderBucketKey: text("leftover_gens_reminder_bucket_key"),
  /**
   * Wholesale credit cents owed back to the merchant after pack refunds
   * (netted off against future usage charges). Phase 2.
   */
  wholesaleCreditCents: integer("wholesale_credit_cents").notNull().default(0),
  /**
   * Which pricing catalogue this installation is enforced under.
   * Always stamped (backfilled to 0). Offer/new-sub uses the active catalogue;
   * enforcement uses this stamp until the shop re-subscribes.
   */
  pricingVersion: integer("pricing_version").default(0),
});

/** Versioned SaaS plan catalogue (commit ≠ activate). */
export const pricingCatalogues = pgTable("pricing_catalogues", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  status: text("status").notNull(), // committed | active | superseded
  overageSchedule: jsonb("overage_schedule").notNull().$type<
    Array<{ upToInclusive: number | null; priceUsd: number }>
  >(),
  aiCostPerGenUsd: decimal("ai_cost_per_gen_usd", { precision: 10, scale: 4 }).notNull().default("0.0450"),
  committedAt: timestamp("committed_at").defaultNow().notNull(),
  activatedAt: timestamp("activated_at"),
  createdBy: text("created_by"),
});

export const pricingCataloguePlans = pgTable(
  "pricing_catalogue_plans",
  {
    id: serial("id").primaryKey(),
    catalogueId: integer("catalogue_id")
      .notNull()
      .references(() => pricingCatalogues.id, { onDelete: "cascade" }),
    planKey: text("plan_key").notNull(),
    displayName: text("display_name").notNull(),
    priceUsd: decimal("price_usd", { precision: 10, scale: 2 }).notNull(),
    generationQuota: integer("generation_quota").notNull(),
    pageLimit: integer("page_limit").notNull(),
    designProductLimit: integer("design_product_limit").notNull().default(0),
    overageCapUnits: integer("overage_cap_units").notNull().default(0),
    marginOverAiCostPct: decimal("margin_over_ai_cost_pct", { precision: 6, scale: 2 }).notNull().default("50"),
    selfServe: boolean("self_serve").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("pricing_catalogue_plans_catalogue_plan_uidx").on(t.catalogueId, t.planKey),
  ],
);

export type PricingCatalogue = typeof pricingCatalogues.$inferSelect;
export type PricingCataloguePlan = typeof pricingCataloguePlans.$inferSelect;

export const insertShopifyInstallationSchema = createInsertSchema(shopifyInstallations).omit({
  id: true,
});
export type ShopifyInstallation = typeof shopifyInstallations.$inferSelect;
export type InsertShopifyInstallation = z.infer<typeof insertShopifyInstallationSchema>;

// One row per overage AI-generation that should be billed to the merchant via a
// Shopify usage charge. Each row is the audit + idempotency + retry record for a
// single appUsageRecordCreate call.
//   - (installation_id, bucket_key, overage_seq) is UNIQUE: overage_seq is the
//     merchant's running overage count within the month bucket (1..overageCap),
//     so each overage unit is billed at most once even under retries/races.
//   - status: pending → charged | failed | skipped
//       pending  = recorded, charge not yet confirmed
//       charged  = Shopify accepted the usage record (shopify_usage_record_id set)
//       failed   = Shopify/API error; eligible for retry
//       skipped  = no usage line on the subscription (legacy subscriber) — the
//                  generation was still allowed; merchant must re-subscribe.
export const merchantUsageCharges = pgTable("merchant_usage_charges", {
  id: serial("id").primaryKey(),
  installationId: integer("installation_id").notNull(),
  shopDomain: text("shop_domain").notNull(),
  bucketKey: text("bucket_key").notNull(),
  overageSeq: integer("overage_seq").notNull(),
  subscriptionLineItemId: text("subscription_line_item_id"),
  priceUsd: decimal("price_usd", { precision: 10, scale: 4 }).notNull(),
  status: text("status").notNull().default("pending"),
  shopifyUsageRecordId: text("shopify_usage_record_id"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  unitUnique: uniqueIndex("merchant_usage_charges_unit_unique").on(
    t.installationId, t.bucketKey, t.overageSeq,
  ),
  statusIdx: index("merchant_usage_charges_status_idx").on(t.installationId, t.status),
}));

export type MerchantUsageCharge = typeof merchantUsageCharges.$inferSelect;

/** Rolling failure-rate window per shop (founder monitoring). */
export const merchantGenerationHealth = pgTable("merchant_generation_health", {
  id: serial("id").primaryKey(),
  installationId: integer("installation_id").notNull().unique(),
  shopDomain: text("shop_domain").notNull(),
  windowStart: timestamp("window_start").notNull(),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastFailureAt: timestamp("last_failure_at"),
  founderAlertSentAt: timestamp("founder_alert_sent_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MerchantGenerationHealth = typeof merchantGenerationHealth.$inferSelect;

/** Audit log of founder alert emails sent. */
export const founderAlerts = pgTable("founder_alerts", {
  id: serial("id").primaryKey(),
  installationId: integer("installation_id"),
  shopDomain: text("shop_domain").notNull(),
  alertType: text("alert_type").notNull(),
  failureRate: decimal("failure_rate", { precision: 5, scale: 4 }),
  attempts: integer("attempts"),
  emailSent: boolean("email_sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FounderAlert = typeof founderAlerts.$inferSelect;

/**
 * Audit log + dedupe guard for the daily Printify catalogue OOS scan
 * (server/oos-catalogue-report.ts). One row per run; `ranAt` is checked
 * before starting a new scan so the in-process daily interval and an
 * external cron trigger never double-run (and double-email) on the same day.
 */
export const oosCatalogueScans = pgTable("oos_catalogue_scans", {
  id: serial("id").primaryKey(),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
  productsScanned: integer("products_scanned").notNull().default(0),
  fullyOosCount: integer("fully_oos_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  emailSent: boolean("email_sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OosCatalogueScan = typeof oosCatalogueScans.$inferSelect;

export const insertMerchantSchema = createInsertSchema(merchants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = z.infer<typeof insertMerchantSchema>;

// Design source types
export const DESIGN_SOURCES = ["ai", "upload", "kittl"] as const;
export type DesignSource = typeof DESIGN_SOURCES[number];

// Designs created by customers
export const designs = pgTable("designs", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  merchantId: varchar("merchant_id"),
  productTypeId: integer("product_type_id"),
  prompt: text("prompt").notNull(),
  stylePreset: text("style_preset"),
  referenceImageUrl: text("reference_image_url"),
  generatedImageUrl: text("generated_image_url"),
  thumbnailImageUrl: text("thumbnail_image_url"),
  size: text("size").notNull(),
  frameColor: text("frame_color").notNull().default("black"),
  aspectRatio: text("aspect_ratio").notNull().default("3:4"),
  transformScale: integer("transform_scale").notNull().default(100),
  transformX: integer("transform_x").notNull().default(50),
  transformY: integer("transform_y").notNull().default(50),
  colorTier: text("color_tier"),
  alternateImageUrl: text("alternate_image_url"),
  designSource: text("design_source").notNull().default("ai"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDesignSchema = createInsertSchema(designs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Design = typeof designs.$inferSelect;
export type InsertDesign = z.infer<typeof insertDesignSchema>;

// Orders sent to Printify
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  designId: integer("design_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  merchantId: varchar("merchant_id"),
  printifyOrderId: text("printify_order_id"),
  status: text("status").notNull().default("pending"),
  size: text("size").notNull(),
  frameColor: text("frame_color").notNull(),
  quantity: integer("quantity").notNull().default(1),
  priceInCents: integer("price_in_cents").notNull(),
  shippingInCents: integer("shipping_in_cents").notNull().default(0),
  creditRefundInCents: integer("credit_refund_in_cents").notNull().default(0),
  shippingAddress: text("shipping_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

// Generation logs for admin stats
export const generationLogs = pgTable("generation_logs", {
  id: serial("id").primaryKey(),
  merchantId: varchar("merchant_id"),
  customerId: varchar("customer_id"),
  designId: integer("design_id"),
  promptLength: integer("prompt_length"),
  hadReferenceImage: boolean("had_reference_image").notNull().default(false),
  stylePreset: text("style_preset"),
  size: text("size"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGenerationLogSchema = createInsertSchema(generationLogs).omit({
  id: true,
  createdAt: true,
});
export type GenerationLog = typeof generationLogs.$inferSelect;
export type InsertGenerationLog = z.infer<typeof insertGenerationLogSchema>;

// Coupon codes for credits
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  merchantId: varchar("merchant_id").notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  creditAmount: integer("credit_amount").notNull(),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCouponSchema = createInsertSchema(coupons).omit({
  id: true,
  usedCount: true,
  createdAt: true,
});
export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = z.infer<typeof insertCouponSchema>;

// Coupon redemptions tracking
export const couponRedemptions = pgTable("coupon_redemptions", {
  id: serial("id").primaryKey(),
  couponId: integer("coupon_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCouponRedemptionSchema = createInsertSchema(couponRedemptions).omit({
  id: true,
  createdAt: true,
});
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type InsertCouponRedemption = z.infer<typeof insertCouponRedemptionSchema>;

// Merchant style presets (customizable)
export const stylePresets = pgTable("style_presets", {
  id: serial("id").primaryKey(),
  merchantId: varchar("merchant_id").notNull(),
  name: text("name").notNull(),
  promptPrefix: text("prompt_prefix").notNull(),
  promptPrefixDark: text("prompt_prefix_dark"),
  category: text("category").notNull().default("all"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  baseImageUrl: text("base_image_url"),
  promptPlaceholder: text("prompt_placeholder"),
  descriptionOptional: boolean("description_optional").notNull().default(false),
  /** merchant = Shopify app row; global/custom = creator-platform catalog eligibility. */
  creatorScope: text("creator_scope").notNull().default("merchant"),
  /**
   * Slot-composed base prompt. Null on every existing row and the version switch for the
   * new composition path: null = legacy `promptPrefix` concatenation, byte-identical to
   * today. `promptPrefix` / `promptPrefixDark` are frozen and never read or written here.
   * Clearing this column reverts a style to legacy handling.
   */
  promptTemplate: text("prompt_template"),
  /** APPAREL_TRANSPARENT | FULL_BLEED. Null = fall back to `category` behaviour. */
  outputMode: text("output_mode"),
  negativePrompt: text("negative_prompt"),
  /** Per-style chroma plate colour. Null = global #FF00FF. */
  chromaHex: text("chroma_hex"),
  paletteMaxColors: integer("palette_max_colors"),
  /** Max coverage before crackle risk. */
  inkLoadCeilingPercent: integer("ink_load_ceiling_percent"),
  /** Per-style override of the APPAREL_VECTORIZE env. Null = use env. */
  vectorizeEnabled: boolean("vectorize_enabled"),
  /** gpt-image-2 or null = current nano-banana. */
  generationModel: text("generation_model"),
  /** low (default) | medium | high | auto. Null = low for gpt-image-2. */
  generationQuality: text("generation_quality"),
  /** Supported ratios for full-bleed output. */
  aspectRatios: jsonb("aspect_ratios"),
  /** Slot definitions the customer fills. */
  userSlotSchema: jsonb("user_slot_schema"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertStylePresetSchema = createInsertSchema(stylePresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StylePresetDB = typeof stylePresets.$inferSelect;
export type InsertStylePreset = z.infer<typeof insertStylePresetSchema>;

/** One-tap starting points for a style: a complete slot set, not a prompt fragment. */
export const stylePromptSuggestions = pgTable(
  "style_prompt_suggestions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    stylePresetId: integer("style_preset_id").notNull(),
    /** User-facing chip text. */
    label: text("label").notNull(),
    /** Complete slot set — one tap must yield a viable design. */
    slotValues: jsonb("slot_values").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    timesUsed: integer("times_used").notNull().default(0),
    timesPublished: integer("times_published").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("style_prompt_suggestions_style_idx").on(table.stylePresetId)],
);

export const insertStylePromptSuggestionSchema = createInsertSchema(stylePromptSuggestions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StylePromptSuggestion = typeof stylePromptSuggestions.$inferSelect;
export type InsertStylePromptSuggestion = z.infer<typeof insertStylePromptSuggestionSchema>;

/** Reusable blocked-term sets. Separate table so one set can back several stores. */
export const ipGuardrails = pgTable("ip_guardrails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  /** String array — exact + fuzzy terms. */
  blockedTerms: jsonb("blocked_terms").notNull().default(sql`'[]'::jsonb`),
  /** Appended to every negative prompt in scope. */
  negativeInjection: text("negative_injection"),
  postGenOcrCheck: boolean("post_gen_ocr_check").notNull().default(false),
  /** BLOCK | FLAG_FOR_REVIEW */
  severity: text("severity").notNull().default("BLOCK"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIpGuardrailSchema = createInsertSchema(ipGuardrails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type IpGuardrail = typeof ipGuardrails.$inferSelect;
export type InsertIpGuardrail = z.infer<typeof insertIpGuardrailSchema>;

/** Per-creator niche storefront identity. `ipGuardrailId` points at ip_guardrails (no FK, repo convention). */
export const nicheStoreConfigs = pgTable(
  "niche_store_configs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    brandName: text("brand_name").notNull(),
    niche: text("niche").notNull(),
    voiceGuidelines: text("voice_guidelines"),
    printedInUsa: boolean("printed_in_usa").notNull().default(false),
    /** Badges, shipping copy, claims. */
    trustConfig: jsonb("trust_config"),
    ipGuardrailId: varchar("ip_guardrail_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("niche_store_configs_creator_uidx").on(table.creatorId)],
);

export const insertNicheStoreConfigSchema = createInsertSchema(nicheStoreConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NicheStoreConfig = typeof nicheStoreConfigs.$inferSelect;
export type InsertNicheStoreConfig = z.infer<typeof insertNicheStoreConfigSchema>;

// Product types for different customizable products (Framed Prints, Pillows, Mugs, etc.)
export const productTypes = pgTable("product_types", {
  id: serial("id").primaryKey(),
  merchantId: varchar("merchant_id"),
  name: text("name").notNull(),
  description: text("description"),
  printifyBlueprintId: integer("printify_blueprint_id"),
  printifyProviderId: integer("printify_provider_id"),
  mockupTemplateUrl: text("mockup_template_url"),
  sizes: text("sizes").notNull().default("[]"),
  frameColors: text("frame_colors").notNull().default("[]"),
  variantMap: text("variant_map").notNull().default("{}"),
  selectedSizeIds: text("selected_size_ids").notNull().default("[]"),
  selectedColorIds: text("selected_color_ids").notNull().default("[]"),
  aspectRatio: text("aspect_ratio").notNull().default("3:4"),
  printShape: text("print_shape").notNull().default("rectangle"),
  printAreaWidth: integer("print_area_width"),
  printAreaHeight: integer("print_area_height"),
  bleedMarginPercent: integer("bleed_margin_percent").notNull().default(5),
  designerType: text("designer_type").notNull().default("generic"),
  sizeType: text("size_type").notNull().default("dimensional"),
  hasPrintifyMockups: boolean("has_printify_mockups").notNull().default(false),
  baseMockupImages: text("base_mockup_images").notNull().default("{}"),
  primaryMockupIndex: integer("primary_mockup_index").notNull().default(0),
  doubleSidedPrint: boolean("double_sided_print").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  shopifyProductId: text("shopify_product_id"),
  shopifyProductHandle: text("shopify_product_handle"),
  shopifyProductUrl: text("shopify_product_url"),
  shopifyShopDomain: text("shopify_shop_domain"), // Which shop this product was published to
  shopifyVariantIds: json("shopify_variant_ids"), // Maps size:color to Shopify variant ID
  lastPushedToShopify: timestamp("last_pushed_to_shopify"),
  printifyCosts: text("printify_costs").default("{}"),
  /**
   * Retail prices for front+back (or Print Side = both) keyed like shopifyVariantIds
   * (`sizeName:colorName` or blank variant id). Front-only retail lives on the Shopify
   * variant price; this map is the surcharge tier used for “from $X” + live ATC.
   */
  variantPricesBoth: text("variant_prices_both").default("{}"),
  isAllOverPrint: boolean("is_all_over_print").notNull().default(false),
  placeholderPositions: text("placeholder_positions").default("[]"),
  /**
   * Flat-lay SVG/PNG URLs for each panel position — used as panel backgrounds in the
   * Place on Item viewer. Stored as JSON object: { "front_right": "https://...", ... }
   * Populated at product import time from the Printify blueprint variants `views` field.
   */
  panelFlatLayImages: text("panel_flat_lay_images").default("{}"),
  /** Optional AOP layout template (e.g. leggings_v1) — overrides name-based layout inference in PatternCustomizer. */
  aopTemplateId: text("aop_template_id"),
  /**
   * Optional published hoodie panel-mapping template name (e.g.
   * `unisex-zip-hoodie-aop-L`). When set, the storefront uses the new
   * mesh-warp HoodieAopPlacer instead of the legacy PatternCustomizer for
   * this product. Looked up in the Supabase `hoodie-templates` bucket via
   * `server/hoodieTemplateStore.ts`. Server-side handle only — never shown
   * to customers.
   */
  panelMappingTemplate: text("panel_mapping_template"),
  /**
   * On-the-fly mockup eligibility tier, derived at import time by the flat
   * calibration harvest (`server/flat-calibration.ts`):
   *   - `flat`   : planar print surface -> homography composite locally
   *   - `mesh`   : mildly curved (e.g. cap front) -> low-density mesh warp
   *   - `reject` : curved/wrap/3D (mug, shoe) -> keep using Printify mockups
   * Null/empty means not yet calibrated (falls back to Printify).
   */
  onTheFlyTier: text("on_the_fly_tier"),
  /** Calibration lifecycle: pending | running | ready | failed | unsupported. */
  flatCalibrationStatus: text("flat_calibration_status"),
  /**
   * Flat-mockup calibration manifest (JSON). Per view (front/back): print-file
   * pixel dims, visible + bleed rects (normalized), mask/shading asset URLs,
   * optional mesh nodes (mesh tier), planarity score and coverage. Plus a
   * `blanks` map of {colorOrModelId: {view: blankUrl}}. Assets live in the
   * Supabase `flat-calibration` bucket (see server/supabaseFlatCalibration.ts).
   */
  flatCalibration: text("flat_calibration").default("{}"),
  /** Override storefront UX: auto | flat | aop | printify */
  storefrontMockupMode: text("storefront_mockup_mode"),
  /** Override order print-file layout: auto | standard | flat | aop | tote_folded_v1 */
  fulfillmentLayout: text("fulfillment_layout"),
  /**
   * Procedural woven-fabric texture on flat on-the-fly mockups (tapestry, etc.).
   * Defaults off; blueprint 1649 enables automatically unless explicitly set.
   */
  fabricWeaveTexture: boolean("fabric_weave_texture"),
  colorOptionName: text("color_option_name"), // Actual option name from Printify blueprint (e.g. "Material", "Fabric", "Color")
  /**
   * Daily Printify stock scan results (server/oos-catalogue-report.ts).
   * oosStatus: "ok" | "critical" | "fully_oos" | "error" | "unknown" (unscanned).
   * oosDetail: JSON { unavailableLabels: string[], error: string | null }.
   */
  lastOosScanAt: timestamp("last_oos_scan_at"),
  oosAvailableVariants: integer("oos_available_variants"),
  oosTotalVariants: integer("oos_total_variants"),
  oosStatus: text("oos_status"),
  oosDetail: text("oos_detail").default("{}"),
  /**
   * Product Intelligence (see docs/product-intelligence-architecture.md).
   * pricingStrategy: maintain_margin | maintain_price | notify_only
   * productHealth: healthy | needs_review | attention_required
   * variantAvailability: JSON map sizeId:colorId → in_stock | out_of_stock | removed
   */
  pricingVersion: integer("pricing_version").notNull().default(0),
  lastProductSyncAt: timestamp("last_product_sync_at"),
  defaultMarkupPercent: integer("default_markup_percent"),
  pricingStrategy: text("pricing_strategy").notNull().default("notify_only"),
  minMarginPercent: integer("min_margin_percent"),
  productHealth: text("product_health").notNull().default("healthy"),
  variantAvailability: text("variant_availability").default("{}"),
  shippingSnapshot: text("shipping_snapshot").default("{}"),
  /**
   * Platform catalogue reference row (not a merchant import). Used so daily
   * Product Sync / OOS cover every published blueprint for Profit Insights.
   */
  isPlatformCatalogRef: boolean("is_platform_catalog_ref").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProductTypeSchema = createInsertSchema(productTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ProductType = typeof productTypes.$inferSelect;
export type InsertProductType = z.infer<typeof insertProductTypeSchema>;

/** Current Product Intelligence row: one supplier variant × print-area config. */
export const catalogVariantCosts = pgTable(
  "catalog_variant_costs",
  {
    id: serial("id").primaryKey(),
    productTypeId: integer("product_type_id").notNull(),
    supplier: text("supplier").notNull().default("printify"),
    blueprintId: integer("blueprint_id"),
    providerId: integer("provider_id"),
    supplierProductId: text("supplier_product_id"),
    supplierVariantId: text("supplier_variant_id").notNull(),
    productName: text("product_name"),
    variantName: text("variant_name"),
    size: text("size"),
    color: text("color"),
    printAreaKey: text("print_area_key").notNull().default("front"),
    printAreasJson: text("print_areas_json").default("[]"),
    baseCogsCents: integer("base_cogs_cents"),
    previousCogsCents: integer("previous_cogs_cents"),
    shippingFirstItemUsCents: integer("shipping_first_item_us_cents"),
    currency: text("currency").notNull().default("USD"),
    available: boolean("available").notNull().default(true),
    availabilityStatus: text("availability_status").notNull().default("unknown"),
    priceChanged: boolean("price_changed").notNull().default(false),
    availabilityChanged: boolean("availability_changed").notNull().default(false),
    isNewVariant: boolean("is_new_variant").notNull().default(false),
    isRemoved: boolean("is_removed").notNull().default(false),
    pricingVersion: integer("pricing_version").notNull().default(1),
    costChecksum: text("cost_checksum"),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
    priceLastChangedAt: timestamp("price_last_changed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("catalog_variant_costs_product_type_idx").on(table.productTypeId),
    index("catalog_variant_costs_variant_idx").on(
      table.productTypeId,
      table.supplier,
      table.supplierVariantId,
      table.printAreaKey,
    ),
  ],
);

export type CatalogVariantCost = typeof catalogVariantCosts.$inferSelect;
export type InsertCatalogVariantCost = typeof catalogVariantCosts.$inferInsert;

/** One Product Sync run (catalogue-wide or single product). */
export const catalogSyncRuns = pgTable("catalog_sync_runs", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("catalogue"), // catalogue | product
  productTypeId: integer("product_type_id"),
  source: text("source").notNull().default("manual"), // manual | daily | backfill | import
  status: text("status").notNull().default("running"), // running | complete | failed
  productsChecked: integer("products_checked").notNull().default(0),
  variantsChecked: integer("variants_checked").notNull().default(0),
  priceChanges: integer("price_changes").notNull().default(0),
  availabilityChanges: integer("availability_changes").notNull().default(0),
  newVariants: integer("new_variants").notNull().default(0),
  removedVariants: integer("removed_variants").notNull().default(0),
  syncFailures: integer("sync_failures").notNull().default(0),
  summaryJson: text("summary_json").default("{}"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CatalogSyncRun = typeof catalogSyncRuns.$inferSelect;

/** Per-variant cost history for pricing_version audit trail. */
export const catalogVariantCostHistory = pgTable(
  "catalog_variant_cost_history",
  {
    id: serial("id").primaryKey(),
    productTypeId: integer("product_type_id").notNull(),
    supplier: text("supplier").notNull().default("printify"),
    supplierVariantId: text("supplier_variant_id").notNull(),
    printAreaKey: text("print_area_key").notNull().default("front"),
    pricingVersion: integer("pricing_version").notNull(),
    previousCogsCents: integer("previous_cogs_cents"),
    newCogsCents: integer("new_cogs_cents"),
    previousShippingUsCents: integer("previous_shipping_us_cents"),
    newShippingUsCents: integer("new_shipping_us_cents"),
    changeReason: text("change_reason").notNull(),
    syncRunId: integer("sync_run_id"),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
  },
  (table) => [
    index("catalog_variant_cost_history_product_idx").on(table.productTypeId),
  ],
);

export type CatalogVariantCostHistory = typeof catalogVariantCostHistory.$inferSelect;

/** Granular Product Intelligence change feed. */
export const catalogSyncEvents = pgTable(
  "catalog_sync_events",
  {
    id: serial("id").primaryKey(),
    productTypeId: integer("product_type_id"),
    syncRunId: integer("sync_run_id"),
    pricingVersion: integer("pricing_version"),
    eventType: text("event_type").notNull(),
    supplierVariantId: text("supplier_variant_id"),
    printAreaKey: text("print_area_key"),
    payloadJson: text("payload_json").default("{}"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("catalog_sync_events_product_idx").on(table.productTypeId),
    index("catalog_sync_events_run_idx").on(table.syncRunId),
  ],
);

export type CatalogSyncEvent = typeof catalogSyncEvents.$inferSelect;

// Shared designs for public sharing via URLs
export const sharedDesigns = pgTable("shared_designs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designId: integer("design_id"), // Nullable for unsaved designs
  shopDomain: text("shop_domain"),
  productId: text("product_id"),
  productHandle: text("product_handle"),
  shareToken: text("share_token").notNull(),
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  prompt: text("prompt").notNull(),
  stylePreset: text("style_preset"),
  size: text("size").notNull(),
  frameColor: text("frame_color").notNull(),
  transformScale: integer("transform_scale").notNull().default(100),
  transformX: integer("transform_x").notNull().default(50),
  transformY: integer("transform_y").notNull().default(50),
  productTypeId: integer("product_type_id"),
  expiresAt: timestamp("expires_at"),
  viewCount: integer("view_count").notNull().default(0),
  /** Internal customer id of the sharer, if known — used by the Reward Ladder share_design rung. */
  ownerCustomerId: varchar("owner_customer_id"),
  /** Creator shop that issued the share (keeps share rewards on that store). */
  creatorId: varchar("creator_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSharedDesignSchema = createInsertSchema(sharedDesigns).omit({
  id: true,
  createdAt: true,
});
export type SharedDesign = typeof sharedDesigns.$inferSelect;
export type InsertSharedDesign = z.infer<typeof insertSharedDesignSchema>;

// Shadow SKU mappings — hidden Shopify products created per design for checkout thumbnail determinism
export const designSkuMappings = pgTable("design_sku_mappings", {
  id: serial("id").primaryKey(),
  shopDomain: text("shop_domain").notNull(),
  sourceVariantId: text("source_variant_id").notNull(),
  designId: text("design_id").notNull(),
  mockupUrl: text("mockup_url").notNull(),
  shadowShopifyProductId: text("shadow_shopify_product_id").notNull(),
  shadowShopifyVariantId: text("shadow_shopify_variant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertDesignSkuMappingSchema = createInsertSchema(designSkuMappings).omit({
  id: true,
  createdAt: true,
});
export type DesignSkuMapping = typeof designSkuMappings.$inferSelect;
export type InsertDesignSkuMapping = z.infer<typeof insertDesignSkuMappingSchema>;

// Customizer Pages — merchant-created pages that auto-mount the customizer via the App Embed.
// Each page is a real Shopify Page with a predetermined base product/variant.
// The App Embed script detects the URL handle and mounts the customizer UI automatically.
export const customizerPages = pgTable("customizer_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shop: text("shop").notNull(),
  shopifyPageId: text("shopify_page_id"),          // Shopify Admin page ID for updates/deletes
  handle: text("handle").notNull(),                // e.g. "customize-tumbler" → /pages/customize-tumbler
  title: text("title").notNull(),
  baseProductId: text("base_product_id"),
  baseVariantId: text("base_variant_id").notNull(),
  baseProductTitle: text("base_product_title"),    // cached display title
  baseVariantTitle: text("base_variant_title"),    // cached variant title (size/color)
  baseProductPrice: text("base_product_price"),    // cached price string
  /** Set when we emailed that this page was hidden for a $0 / missing retail price. */
  zeroPriceAlertSentAt: timestamp("zero_price_alert_sent_at"),
  baseProductHandle: text("base_product_handle"),  // Shopify product handle for embed iframe
  productTypeId: integer("product_type_id"),       // links to our product type for generation
  /** JSON: { mode: "category", category } | { mode: "selected", presetIds[] } */
  styleConfig: json("style_config"),
  /**
   * Regional sibling group link (PARKED design — docs/Shipping-rates-plan/
   * regional-siblings-choice-and-slugs-design-notes.md §1). Pure linking
   * metadata; resolution/redirect logic lands with Phase 4 geo-gating.
   */
  productGroupId: text("product_group_id"),
  /** Intended zones for this sibling (e.g. ["AU"]) — human/ops metadata, never enforcement. */
  intendedZones: jsonb("intended_zones").$type<string[]>(),
  /** preview = merchant-only draft; active = Live; disabled = off (settings retained). */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomizerPageSchema = createInsertSchema(customizerPages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CustomizerPage = typeof customizerPages.$inferSelect;
export type InsertCustomizerPage = z.infer<typeof insertCustomizerPageSchema>;

// Generation jobs — async job records for storefront artwork generation.
// POST /api/storefront/generate creates a job and returns immediately.
// GET /api/storefront/generate/status polls for completion.
export const generationJobs = pgTable("generation_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shop: text("shop").notNull(),
  sessionId: text("session_id"),
  customerId: text("customer_id"),
  /** Creator Marketplace attribution (nullable — merchant storefronts leave null). */
  creatorId: varchar("creator_id"),
  creatorSessionId: varchar("creator_session_id"),
  status: text("status").notNull().default("pending"), // pending | running | complete | failed
  prompt: text("prompt").notNull(),
  userPrompt: text("user_prompt"),               // User's original short prompt (without style prefix/suffix)
  stylePreset: text("style_preset"),
  size: text("size"),
  frameColor: text("frame_color"),
  productTypeId: text("product_type_id"),
  referenceImageUrl: text("reference_image_url"),
  designImageUrl: text("design_image_url"),
  thumbnailUrl: text("thumbnail_url"),
  mockupUrls: json("mockup_urls"),              // Saved Printify mockup URLs (array of strings)
  designState: json("design_state"),             // Full design state snapshot (transform, size, color, preset)
  designId: text("design_id"),
  errorMessage: text("error_message"),
  /** How merchant/customer billing applies on success: merchant | customer_paid | customer_free | session */
  billingMode: text("billing_mode"),
  // Pre-created shadow product for instant Add to Cart
  shadowProductId: text("shadow_product_id"),   // Shopify product GID (pre-created after generation)
  shadowVariantId: text("shadow_variant_id"),   // Shopify variant GID (used directly for cart add)
  shadowExpiresAt: timestamp("shadow_expires_at"), // 1h after creation; extended to 48h on cart add
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = typeof generationJobs.$inferInsert;

// Customizer designs — standalone design records created from the /pages/appai-customize page.
// These are NOT tied to the existing `designs` table (which requires a logged-in customer).
// Status lifecycle: GENERATING → READY | FAILED
export const customizerDesigns = pgTable("customizer_designs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shop: text("shop").notNull(),
  shopifyCustomerId: text("shopify_customer_id"), // optional — set if customer is logged in
  customerKey: text("customer_key"),              // appai_uid (localStorage) or "shopify:<customerId>"
  baseProductId: text("base_product_id"),         // product type ID (our DB) or Shopify product ID
  baseVariantId: text("base_variant_id").notNull(), // Shopify variant ID for add-to-cart
  baseTitle: text("base_title"),
  prompt: text("prompt").notNull(),
  options: json("options"),                        // { stylePreset, sizeId, colorId, productTypeId }
  artworkUrl: text("artwork_url"),                 // AI-generated print file URL
  mockupUrl: text("mockup_url"),                   // Primary mockup image URL (shown in cart/checkout)
  mockupUrls: json("mockup_urls"),                 // All mockup URLs (array of strings)
  status: text("status").notNull().default("GENERATING"), // GENERATING | READY | FAILED
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomizerDesignSchema = createInsertSchema(customizerDesigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CustomizerDesign = typeof customizerDesigns.$inferSelect;
export type InsertCustomizerDesign = z.infer<typeof insertCustomizerDesignSchema>;

// Published Products — maps a customizer design to its dedicated Shopify product.
// One product per design ensures mockup images are native Shopify product images,
// giving correct cart/checkout thumbnails without any hacks.
// The Shopify product is created with status="active", not in any collection, so
// it is purchasable via direct variant ID but hidden from storefront navigation.
export const publishedProducts = pgTable("published_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shop: text("shop").notNull(),
  designId: text("design_id").notNull(),           // references customizerDesigns.id
  customerKey: text("customer_key"),               // same key as customizerDesigns.customerKey
  shopifyProductId: text("shopify_product_id").notNull(),
  shopifyVariantId: text("shopify_variant_id").notNull(), // the purchasable variant for /cart/add.js
  shopifyProductHandle: text("shopify_product_handle"),
  baseVariantId: text("base_variant_id").notNull(), // the original base variant
  status: text("status").notNull().default("active"), // active | archived
  expiresAt: timestamp("expires_at"),                 // null = no expiry; set to 6h after creation, extended to 7d if added to cart
  cartAddedAt: timestamp("cart_added_at"),             // set when customer adds to cart (used to extend expiry to 7d)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPublishedProductSchema = createInsertSchema(publishedProducts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type PublishedProduct = typeof publishedProducts.$inferSelect;
export type InsertPublishedProduct = z.infer<typeof insertPublishedProductSchema>;

// Design Products — permanent, browsable Shopify products merchants publish from a saved
// My Designs studio design (generationJobs row). Unlike publishedProducts/customizerDesigns
// (ephemeral shadow SKUs for a single anonymous customer's cart), these are real catalog
// listings with a full size/color variant set, owned by the merchant, auto-fulfilled via
// the same artwork + placement stored on the source generation job. Plan-limited (see
// PLAN_DESIGN_PRODUCT_LIMITS in server/customizer-plans.ts) — only `status: "active"` rows
// count against that limit; "inactive" rows stay in the library unpublished (Shopify draft).
export const designProducts = pgTable("design_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  merchantId: varchar("merchant_id").notNull(),
  shop: text("shop").notNull(),
  jobId: varchar("job_id").notNull(),              // generationJobs.id — source artwork + placement
  productTypeId: integer("product_type_id"),
  shopifyProductId: text("shopify_product_id"),
  /** Persistent Printify product (NOT a temp/deleted one) — holds the print-ready artwork in
   *  the merchant's own Printify account and is the order-time fulfillment target. Null if
   *  Printify product creation failed at publish time (listing still exists as a Shopify draft). */
  printifyProductId: text("printify_product_id"),
  handle: text("handle"),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"), // active | inactive
  /** { [shopifyVariantId]: { sizeId, colorId, printifyVariantId } } */
  variantMap: json("variant_map"),
  mockupUrls: json("mockup_urls"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDesignProductSchema = createInsertSchema(designProducts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type DesignProduct = typeof designProducts.$inferSelect;
export type InsertDesignProduct = z.infer<typeof insertDesignProductSchema>;

// Design Product Events — lightweight sales/ATC analytics for design products, backing the
// My Orders stats dashboard. Populated from the orders/paid webhook (sale) and carts
// create/update webhooks (atc), matched by design_products.variantMap.
export const designProductEvents = pgTable("design_product_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designProductId: varchar("design_product_id").notNull(),
  eventType: text("event_type").notNull(),          // sale | atc
  quantity: integer("quantity").notNull().default(1),
  amountCents: integer("amount_cents"),              // only set for "sale" events
  shopifyOrderId: text("shopify_order_id"),          // set for "sale" events
  cartToken: text("cart_token"),                     // set for "atc" events (dedupe key)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDesignProductEventSchema = createInsertSchema(designProductEvents).omit({
  id: true,
  createdAt: true,
});
export type DesignProductEvent = typeof designProductEvents.$inferSelect;
export type InsertDesignProductEvent = z.infer<typeof insertDesignProductEventSchema>;

// Credit transactions
export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  priceInCents: integer("price_in_cents"),
  orderId: integer("order_id"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;

// Product size configurations for Blueprint 540
// Each size generates at its true aspect ratio for proper framing
export const PRINT_SIZES = [
  { id: "11x14", name: '11" x 14"', width: 11, height: 14, aspectRatio: "11:14", genWidth: 880, genHeight: 1120 },
  { id: "12x16", name: '12" x 16"', width: 12, height: 16, aspectRatio: "3:4", genWidth: 768, genHeight: 1024 },
  { id: "16x20", name: '16" x 20"', width: 16, height: 20, aspectRatio: "4:5", genWidth: 896, genHeight: 1120 },
  { id: "20x30", name: '20" x 30"', width: 20, height: 30, aspectRatio: "2:3", genWidth: 768, genHeight: 1152 },
  { id: "16x16", name: '16" x 16"', width: 16, height: 16, aspectRatio: "1:1", genWidth: 1024, genHeight: 1024 },
] as const;

export const FRAME_COLORS = [
  { id: "black", name: "Black", hex: "#1a1a1a" },
  { id: "white", name: "White", hex: "#f5f5f5" },
] as const;

/** Treatment-only Opinionated sub-style. Intent to render words lives on the style layer. */
export const OPINIONATED_TYPEWRITER_FRAGMENT =
  "Typewriter lettering — monospaced characters with even mechanical spacing, struck-ink texture with slight uneven inking and small imperfections, as if typed on paper with an old manual typewriter.";

// IMPORTANT: Style presets are categorized by product type
// Decor styles create full-bleed, edge-to-edge artwork for prints and wall art
// Apparel styles create centered graphics/motifs suitable for t-shirts, etc.
export const STYLE_PRESETS = [
  // Universal - works for all product types
  { id: "none", name: "No Style (Custom Prompt)", promptPrefix: "", category: "all" },
  
  // Decor Artwork - Full-bleed styles for prints, posters, wall art
  { id: "royal-pet", name: "Royal Pet Portrait", promptPrefix: "Transform this pet into a regal royal portrait from the 1800s, dressed in elegant period clothing with an ornate aristocratic backdrop filling the entire canvas. The portrait should look like a classic oil painting of nobility with the background extending to all edges. Create full-bleed artwork of", category: "decor" },
  { id: "watercolor", name: "Watercolor", promptPrefix: "A beautiful full-bleed watercolor painting that fills the entire canvas edge-to-edge, with the colors and brushwork extending to all edges of", category: "decor" },
  { id: "oil-painting", name: "Oil Painting", promptPrefix: "A classic full-bleed oil painting in the style of impressionism that fills the entire canvas with rich brushstrokes extending to all edges of", category: "decor" },
  { id: "pop-art", name: "Pop Art", promptPrefix: "A vibrant full-bleed pop art illustration in the style of Andy Warhol that fills the entire canvas with bold colors reaching all edges of", category: "decor" },
  { id: "minimal-line", name: "Minimal Line Art", promptPrefix: "A minimalist full-bleed single-line art drawing with a complete background that extends to all edges of the canvas of", category: "decor" },
  { id: "abstract", name: "Abstract", promptPrefix: "A full-bleed abstract modern art piece with bold colors filling the entire canvas edge-to-edge representing", category: "decor" },
  { id: "vintage-poster", name: "Vintage Poster", promptPrefix: "A full-bleed vintage travel illustration in classic Art Deco advertising-lithograph style (flat color fields, bold graphic shapes, period typography) that fills the entire canvas edge-to-edge in the canvas orientation — wider-than-tall when the canvas is landscape, taller-than-wide when portrait — with color and scene extending to all edges of", category: "decor" },
  { id: "photorealistic", name: "Photorealistic", promptPrefix: "A photorealistic full-bleed high-quality image that fills the entire canvas with the scene extending to all edges of", category: "decor" },
  
  // Apparel Artwork - Centered vector graphics for t-shirts, hoodies, etc.
  // All apparel styles use #FF00FF hot pink chroma key background for precise removal
  // baseImageUrl: optional style reference image sent to AI alongside customer's own reference
  {
    id: "free-4-all",
    name: "Free 4 All",
    promptPrefix: "",
    category: "apparel",
    promptPlaceholder: "Your prompt will have no base style applied. Describe your design freely...",
  },
  {
    id: "pattern-maker",
    name: "Pattern Maker",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME["pattern maker"],
    category: "apparel",
    promptPlaceholder: "Describe your pattern idea (e.g. tiny tacos and hot sauce bottles)",
  },
  {
    id: "opinionated",
    name: "Opinionated",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
    category: "apparel",
    promptPlaceholder: "Write your text here (up to 6 words)",
    userSlotSchema: literalUserSlotSchema(6),
    options: {
      label: "Choose Layout",
      required: true,
      choices: [
        { id: "retro", name: "Retro", promptFragment: "vintage worn letterpress typography, aged poster feel, distressed texture", baseImageUrl: "" },
        { id: "bold", name: "Bold", promptFragment: "heavy block type, maximum impact, ultra-thick sans-serif, stacked layout", baseImageUrl: "" },
        { id: "street", name: "Street", promptFragment: "graffiti spray paint urban style, drip effects, raw street art typography", baseImageUrl: "" },
        { id: "minimal", name: "Minimal", promptFragment: "clean modern sans-serif, simple layout, balanced whitespace, understated elegance", baseImageUrl: "" },
        { id: "handwritten", name: "Handwritten", promptFragment: "casual hand-lettered script, organic brush strokes, personal handwriting feel", baseImageUrl: "" },
        { id: "typewriter", name: "Typewriter", promptFragment: OPINIONATED_TYPEWRITER_FRAGMENT, baseImageUrl: "" },
      ],
    },
  },
  {
    id: "quotes",
    name: "Quotes",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME.quotes,
    category: "apparel",
    promptPlaceholder: "Enter your topic (e.g. life, cats, Monday mornings, coffee addiction)",
    options: {
      label: "Quote Style",
      required: true,
      choices: [
        { id: "profound", name: "Profound", promptFragment: "a profound, thoughtful, deep quote on", baseImageUrl: "" },
        { id: "quirky", name: "Quirky", promptFragment: "a quirky, offbeat, unexpected quote on", baseImageUrl: "" },
        { id: "weird", name: "Weird", promptFragment: "a weird, absurd, surreal quote on", baseImageUrl: "" },
        { id: "funny", name: "Funny", promptFragment: "a funny, humorous, comedic quote on", baseImageUrl: "" },
      ],
    },
  },
  {
    id: "pet-portraits",
    name: "Pet Portraits",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME["pet portraits"],
    category: "apparel",
    promptPlaceholder: "What's the pet's name?",
    options: {
      label: "Portrait Style",
      required: true,
      choices: [
        { id: "king", name: "King", promptFragment: "dressed as a majestic king with crown and royal robes", baseImageUrl: "" },
        { id: "queen", name: "Queen", promptFragment: "dressed as an elegant queen with tiara and royal gown", baseImageUrl: "" },
        { id: "red-carpet", name: "Red Carpet", promptFragment: "dressed in glamorous red carpet fashion, celebrity style", baseImageUrl: "" },
        { id: "ramen-bowl", name: "Ramen Bowl", promptFragment: "sitting in a ramen bowl, surrounded by noodles and chopsticks", baseImageUrl: "" },
        { id: "mugshot", name: "Mugshot", promptFragment: "in a funny police mugshot lineup, holding a name placard", baseImageUrl: "" },
      ],
    },
  },
  {
    id: "centered-graphic",
    name: "Centered Graphic",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME["centered graphic"],
    category: "apparel",
    promptPlaceholder: "Describe your centered graphic (e.g. scary bear standing up, vintage skull, geometric wolf)",
  },
  {
    id: "illustrated-motif",
    name: "Illustrated Motif",
    promptPrefix: APPAREL_CHROMA_STYLE_BY_NAME["illustrated motif"],
    category: "apparel",
    promptPlaceholder: "Describe your illustrated motif (e.g. scary grizzly bear standing up, retro robot, floral skull)",
  },

  // Graphics — isolated motifs for blankets, totes, patterns (chroma + SVG pipeline)
  {
    id: "graphics-centered-graphic",
    name: "Centered Graphic (Graphics)",
    promptPrefix: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-centered-graphic"],
    category: "graphics",
    promptPlaceholder:
      "Describe your centered graphic (e.g. geometric wolf, vintage skull, botanical emblem)",
  },
  {
    id: "graphics-illustrated-motif",
    name: "Illustrated Motif (Graphics)",
    promptPrefix: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-illustrated-motif"],
    category: "graphics",
    promptPlaceholder:
      "Describe your illustrated motif (e.g. retro robot, floral skull, camping bear)",
  },
  {
    id: "graphics-pattern-maker",
    name: "Pattern Maker (Graphics)",
    promptPrefix: GRAPHICS_CHROMA_STYLE_BY_ID["graphics-pattern-maker"],
    category: "graphics",
    promptPlaceholder:
      "Describe your pattern idea (e.g. tiny tacos, scattered leaves, geometric tiles)",
  },

  // Decor Pet Portraits - Full-bleed scenic versions (no chroma key needed)
  {
    id: "pet-portraits-decor",
    name: "Pet Portraits",
    promptPrefix: "A beautifully detailed full-bleed pet portrait illustration that fills the entire canvas edge-to-edge, rich artistic style with a complete scenic background, of",
    category: "decor",
    promptPlaceholder: "What's the pet's name?",
    options: {
      label: "Portrait Style",
      required: true,
      choices: [
        { id: "king", name: "King", promptFragment: "dressed as a majestic king with crown and royal robes, seated on an ornate throne in a grand palace hall", baseImageUrl: "" },
        { id: "queen", name: "Queen", promptFragment: "dressed as an elegant queen with tiara and royal gown, in a luxurious palace garden setting", baseImageUrl: "" },
        { id: "red-carpet", name: "Red Carpet", promptFragment: "dressed in glamorous red carpet fashion with paparazzi camera flashes and velvet rope backdrop", baseImageUrl: "" },
        { id: "ramen-bowl", name: "Ramen Bowl", promptFragment: "sitting in a giant ramen bowl surrounded by noodles, chopsticks, and steam in a cozy Japanese ramen shop", baseImageUrl: "" },
        { id: "mugshot", name: "Mugshot", promptFragment: "in a funny police mugshot lineup holding a name placard, against a height chart wall background", baseImageUrl: "" },
      ],
    },
  },
] as const;

export type StyleOptionsBlob = {
  label?: string;
  required?: boolean;
  choices?: Array<{
    id?: string;
    name?: string;
    promptFragment?: string;
    baseImageUrl?: string;
    baseImageUrls?: string[];
  }>;
};

/** Keep merchant-saved options, append any catalog choices the DB row is missing (e.g. Typewriter). */
export function mergeCatalogStyleOptions(
  dbOptions: StyleOptionsBlob | null | undefined,
  hardcodedOptions: StyleOptionsBlob | null | undefined,
): StyleOptionsBlob | null {
  if (!dbOptions) return hardcodedOptions ?? null;
  const catalog = hardcodedOptions?.choices || [];
  if (catalog.length === 0) return dbOptions;
  const have = new Set((dbOptions.choices || []).map((c) => String(c?.id || "")));
  const extras = catalog.filter((c) => c?.id && !have.has(String(c.id)));
  if (extras.length === 0) return dbOptions;
  return { ...dbOptions, choices: [...(dbOptions.choices || []), ...extras] };
}

export type PrintSize = typeof PRINT_SIZES[number];
export type FrameColor = typeof FRAME_COLORS[number];
export type StylePreset = typeof STYLE_PRESETS[number];

export type PrintShape = "rectangle" | "square" | "circle";
export type DesignerType = "framed-print" | "pillow" | "mug" | "apparel" | "generic";

export interface DesignerConfig {
  id: number;
  name: string;
  description: string | null;
  printifyBlueprintId: number | null;
  aspectRatio: string;
  printShape: PrintShape;
  printAreaWidth: number | null;
  printAreaHeight: number | null;
  bleedMarginPercent: number;
  designerType: DesignerType;
  hasPrintifyMockups: boolean;
  sizes: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    aspectRatio?: string;
  }>;
  frameColors: Array<{
    id: string;
    name: string;
    hex: string;
  }>;
  canvasConfig: {
    maxDimension: number;
    width: number;
    height: number;
    safeZoneMargin: number;
  };
}

// Cached masked panel images for AOP products (e.g., leggings)
// Pre-renders the SVG sew patterns with clipping masks applied, stored as PNG data URLs
// Keyed by blueprint ID + panel name, generated once and reused for all designs
export const cachedPanelImages = pgTable("cached_panel_images", {
  id: serial("id").primaryKey(),
  blueprintId: integer("blueprint_id").notNull(), // Printify blueprint ID (e.g., 1050 for leggings)
  panelName: text("panel_name").notNull(), // e.g., "left_leg", "right_leg"
  panelWidth: integer("panel_width").notNull(), // Rendered width in pixels
  panelHeight: integer("panel_height").notNull(), // Rendered height in pixels
  imageDataUrl: text("image_data_url").notNull(), // PNG as data URL
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCachedPanelImageSchema = createInsertSchema(cachedPanelImages).omit({
  id: true,
  createdAt: true,
});
export type CachedPanelImage = typeof cachedPanelImages.$inferSelect;
export type InsertCachedPanelImage = z.infer<typeof insertCachedPanelImageSchema>;

// Internal AOP calibration captures. These are debug/training artifacts only;
// they are never published to Shopify and should not affect customer flows.
export const aopCalibrationRuns = pgTable("aop_calibration_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productTypeId: integer("product_type_id"),
  blueprintId: integer("blueprint_id").notNull(),
  providerId: integer("provider_id").notNull(),
  variantId: integer("variant_id"),
  size: text("size"),
  status: text("status").notNull().default("pending"),
  printifyProductId: text("printify_product_id"),
  printifyMockupUrls: jsonb("printify_mockup_urls"),
  printAreasPayload: jsonb("print_areas_payload"),
  exportUrl: text("export_url"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("aop_calibration_runs_product_type_idx").on(table.productTypeId),
  index("aop_calibration_runs_created_idx").on(table.createdAt),
]);

export const aopCalibrationPanels = pgTable("aop_calibration_panels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aopCalibrationRuns.id, { onDelete: "cascade" }),
  panelKey: text("panel_key").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  calibrationImageUrl: text("calibration_image_url").notNull(),
  placement: jsonb("placement"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("aop_calibration_panels_run_idx").on(table.runId),
  index("aop_calibration_panels_panel_key_idx").on(table.panelKey),
]);

export const insertAopCalibrationRunSchema = createInsertSchema(aopCalibrationRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AopCalibrationRun = typeof aopCalibrationRuns.$inferSelect;
export type InsertAopCalibrationRun = z.infer<typeof insertAopCalibrationRunSchema>;

export const insertAopCalibrationPanelSchema = createInsertSchema(aopCalibrationPanels).omit({
  id: true,
  createdAt: true,
});
export type AopCalibrationPanel = typeof aopCalibrationPanels.$inferSelect;
export type InsertAopCalibrationPanel = z.infer<typeof insertAopCalibrationPanelSchema>;

export const aopProjectionMaps = pgTable("aop_projection_maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productTypeId: integer("product_type_id"),
  blueprintId: integer("blueprint_id").notNull(),
  providerId: integer("provider_id").notNull(),
  size: text("size"),
  mapJson: jsonb("map_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("aop_projection_maps_product_type_idx").on(table.productTypeId),
  index("aop_projection_maps_blueprint_provider_idx").on(table.blueprintId, table.providerId),
  index("aop_projection_maps_created_idx").on(table.createdAt),
]);

export const insertAopProjectionMapSchema = createInsertSchema(aopProjectionMaps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AopProjectionMap = typeof aopProjectionMaps.$inferSelect;
export type InsertAopProjectionMap = z.infer<typeof insertAopProjectionMapSchema>;

// Audit + idempotency record for flat/mesh on-the-fly print files pushed to
// Printify at order time. One row per (shopify order line / test submission).
// `idempotencyKey` mirrors the credit-ledger idempotency pattern:
//   - live  : shopify-order-fulfill:{orderId}:{lineId}
//   - test  : flat-test-order:{productTypeId}:{designId}:{timestamp}
// `status`: pending → submitted | failed | skipped
//   skipped = the line was resolved but is not an eligible flat/mesh on-the-fly
//             product (mixed carts / normal products / AOP), recorded for audit.
export const flatOrderSubmissions = pgTable("flat_order_submissions", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  shop: text("shop"),
  shopifyOrderId: text("shopify_order_id"),
  shopifyLineId: text("shopify_line_id"),
  designId: text("design_id"),
  productTypeId: integer("product_type_id"),
  printifyShopId: text("printify_shop_id"),
  printifyOrderId: text("printify_order_id"),
  status: text("status").notNull().default("pending"),
  sentToProduction: boolean("sent_to_production").notNull().default(false),
  isTest: boolean("is_test").notNull().default(false),
  printFileUrls: jsonb("print_file_urls"),
  error: text("error"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("flat_order_submissions_order_idx").on(table.shopifyOrderId),
  index("flat_order_submissions_product_type_idx").on(table.productTypeId),
]);

export const insertFlatOrderSubmissionSchema = createInsertSchema(flatOrderSubmissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FlatOrderSubmission = typeof flatOrderSubmissions.$inferSelect;
export type InsertFlatOrderSubmission = z.infer<typeof insertFlatOrderSubmissionSchema>;

/** Platform-curated Printify catalog tags (operator UI — no deploy to add products). */
export const platformCatalogBlueprints = pgTable("platform_catalog_blueprints", {
  printifyBlueprintId: integer("printify_blueprint_id").primaryKey(),
  label: text("label").notNull(),
  brand: text("brand"),
  category: text("category"),
  /** printify = Printify mockup API; flat | aop = platform calibration queue; blocked = deny */
  kind: text("kind").notNull(),
  /** draft until operator publishes calibration; printify tags publish immediately */
  status: text("status").notNull().default("draft"),
  panelMappingTemplate: text("panel_mapping_template"),
  /** auto | flat | aop | printify — how merchants preview in the editor */
  storefrontMockupMode: text("storefront_mockup_mode"),
  /** auto | standard | flat | aop | tote_folded_v1 — how print files are built */
  fulfillmentLayout: text("fulfillment_layout"),
  /** When true, allow flat catalog tag/harvest despite (AOP) in the Printify title */
  forceFlatHarvest: boolean("force_flat_harvest").notNull().default(false),
  /** Procedural woven-fabric texture on flat mockups. Null = blueprint default (tapestry 1649 on). */
  fabricWeaveTexture: boolean("fabric_weave_texture"),
  notes: text("notes"),
  taggedAt: timestamp("tagged_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlatformCatalogBlueprintSchema = createInsertSchema(platformCatalogBlueprints).omit({
  taggedAt: true,
  updatedAt: true,
});
export type PlatformCatalogBlueprint = typeof platformCatalogBlueprints.$inferSelect;
export type InsertPlatformCatalogBlueprint = z.infer<typeof insertPlatformCatalogBlueprintSchema>;

// ── Creator Marketplace ───────────────────────────────────────────────────────

/** Global platform key/value config (e.g. AI_GENERATION_COST_USD). */
export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PlatformConfigRow = typeof platformConfig.$inferSelect;

/**
 * First-class creator / beta merchant identity.
 * Subdomain storefronts resolve to this row; attribution never depends on URL alone.
 */
export const creators = pgTable(
  "creators",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username").notNull(),
    previousUsername: text("previous_username"),
    subdomain: text("subdomain").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    socialPlatform: text("social_platform"),
    socialUsername: text("social_username"),
    socialUrl: text("social_url"),
    socials: jsonb("socials").$type<Array<{ platform: string; username: string; url?: string | null }>>(),
    followerCount: integer("follower_count"),
    niche: text("niche"),
    audienceDescription: text("audience_description"),
    profileImageUrl: text("profile_image_url"),
    bio: text("bio"),
    status: text("status").notNull().default("application"),
    creatorType: text("creator_type").notNull().default("creator"),
    shopDomain: text("shop_domain"),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
    onboardingChecklist: jsonb("onboarding_checklist").$type<Record<string, boolean>>(),
    branding: jsonb("branding").$type<Record<string, unknown>>(),
    betaStartAt: timestamp("beta_start_at"),
    betaEndAt: timestamp("beta_end_at"),
    freeGensPerCustomer: integer("free_gens_per_customer").notNull().default(2),
    monthlyGenerationAllowance: integer("monthly_generation_allowance").notNull().default(250),
    generationMonth: text("generation_month"),
    monthlyGenerationsUsed: integer("monthly_generations_used").notNull().default(0),
    overageCap: integer("overage_cap").notNull().default(0),
    shareBasis: text("share_basis").notNull().default("net_contribution"),
    revenueShareCreatorPct: integer("revenue_share_creator_pct").notNull().default(100),
    revenueShareAasPct: integer("revenue_share_aas_pct").notNull().default(0),
    agreementStatus: text("agreement_status"),
    agreementStartAt: timestamp("agreement_start_at"),
    agreementEndAt: timestamp("agreement_end_at"),
    emailAutomationToggles: jsonb("email_automation_toggles").$type<Record<string, boolean>>(),
    applicationId: varchar("application_id"),
    /** Creator Portal OTP (Phase 6) — cleared after verify. */
    otpCode: text("otp_code"),
    otpExpiresAt: timestamp("otp_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creators_username_uidx").on(table.username),
    uniqueIndex("creators_subdomain_uidx").on(table.subdomain),
    index("creators_status_idx").on(table.status),
    index("creators_email_idx").on(table.email),
  ],
);

export type Creator = typeof creators.$inferSelect;

export const creatorApplications = pgTable(
  "creator_applications",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    socialPlatform: text("social_platform").notNull(),
    socialUsername: text("social_username").notNull(),
    socialUrl: text("social_url"),
    socials: jsonb("socials").$type<Array<{ platform: string; username: string; url?: string | null }>>(),
    followerCount: integer("follower_count"),
    niche: text("niche").notNull(),
    audienceDescription: text("audience_description"),
    hasShopifyStore: boolean("has_shopify_store").notNull().default(false),
    shopifyStoreUrl: text("shopify_store_url"),
    interestedProducts: text("interested_products"),
    preferredCategory: text("preferred_category"),
    whyParticipate: text("why_participate"),
    expectedReach: text("expected_reach"),
    additionalInfo: text("additional_info"),
    applyTrack: text("apply_track").notNull().default("creator"),
    payoutMethod: text("payout_method"),
    payoutDetail: text("payout_detail"),
    termsAcceptedAt: timestamp("terms_accepted_at"),
    /** Requested public shop name — source of the URL handle, not the legal name. */
    shopName: text("shop_name"),
    status: text("status").notNull().default("submitted"),
    assignedUsername: text("assigned_username"),
    creatorId: varchar("creator_id"),
    adminNotes: text("admin_notes"),
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("creator_applications_status_idx").on(table.status),
    index("creator_applications_email_idx").on(table.email),
    index("creator_applications_created_idx").on(table.createdAt),
  ],
);

export type CreatorApplication = typeof creatorApplications.$inferSelect;

export const creatorCustomizerPages = pgTable(
  "creator_customizer_pages",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id").notNull(),
    customizerPageId: varchar("customizer_page_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    titleOverride: text("title_override"),
    descriptionOverride: text("description_override"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_customizer_pages_uidx").on(table.creatorId, table.customizerPageId),
    index("creator_customizer_pages_creator_idx").on(table.creatorId),
  ],
);

export const creatorSessions = pgTable(
  "creator_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    landingPath: text("landing_path"),
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    device: text("device"),
    country: text("country"),
  },
  (table) => [
    index("creator_sessions_creator_idx").on(table.creatorId, table.lastSeenAt),
  ],
);

export const creatorEvents = pgTable(
  "creator_events",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id").notNull(),
    sessionId: varchar("session_id"),
    eventType: text("event_type").notNull(),
    customizerPageId: varchar("customizer_page_id"),
    productTypeId: integer("product_type_id"),
    generationJobId: varchar("generation_job_id"),
    stylePreset: text("style_preset"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("creator_events_creator_idx").on(table.creatorId, table.createdAt),
    index("creator_events_type_idx").on(table.creatorId, table.eventType, table.createdAt),
  ],
);

export const creatorCustomerFreeGens = pgTable(
  "creator_customer_free_gens",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id").notNull(),
    customerId: text("customer_id").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_customer_free_gens_uidx").on(table.creatorId, table.customerId),
  ],
);

/** Reward-ladder credits that must stay on the creator shop that issued them. */
export const creatorCustomerEarned = pgTable(
  "creator_customer_earned",
  {
    creatorId: varchar("creator_id").notNull(),
    customerId: text("customer_id").notNull(),
    earnedCredits: integer("earned_credits").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_customer_earned_uidx").on(table.creatorId, table.customerId),
  ],
);

export const creatorGenerationCosts = pgTable(
  "creator_generation_costs",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id").notNull(),
    generationJobId: varchar("generation_job_id").notNull(),
    sessionId: varchar("session_id"),
    customerId: text("customer_id"),
    customizerPageId: varchar("customizer_page_id"),
    costCents: integer("cost_cents").notNull(),
    billingMode: text("billing_mode"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_generation_costs_job_uidx").on(table.generationJobId),
    index("creator_generation_costs_creator_idx").on(table.creatorId, table.createdAt),
  ],
);

export const creatorDailyStats = pgTable(
  "creator_daily_stats",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id").notNull(),
    day: text("day").notNull(),
    visitors: integer("visitors").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
    generations: integer("generations").notNull().default(0),
    genCostCents: integer("gen_cost_cents").notNull().default(0),
    atcCount: integer("atc_count").notNull().default(0),
    orders: integer("orders").notNull().default(0),
    grossCents: integer("gross_cents").notNull().default(0),
    productProfitCents: integer("product_profit_cents").notNull().default(0),
    netContributionCents: integer("net_contribution_cents").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_daily_stats_uidx").on(table.creatorId, table.day),
  ],
);

export const creatorOrders = pgTable(
  "creator_orders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    shopifyOrderId: text("shopify_order_id").notNull(),
    shopifyOrderName: text("shopify_order_name"),
    sessionId: varchar("session_id"),
    attributionSnapshot: jsonb("attribution_snapshot"),
    grossCents: integer("gross_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    shippingCollectedCents: integer("shipping_collected_cents").notNull().default(0),
    fulfilmentCostCents: integer("fulfilment_cost_cents").notNull().default(0),
    transactionFeeCents: integer("transaction_fee_cents").notNull().default(0),
    productProfitCents: integer("product_profit_cents").notNull().default(0),
    aiGenCostCents: integer("ai_gen_cost_cents").notNull().default(0),
    netContributionCents: integer("net_contribution_cents").notNull().default(0),
    creatorShareCents: integer("creator_share_cents").notNull().default(0),
    aasShareCents: integer("aas_share_cents").notNull().default(0),
    refundCents: integer("refund_cents").notNull().default(0),
    status: text("status").notNull().default("paid"),
    payoutId: varchar("payout_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_orders_shopify_uidx").on(table.creatorId, table.shopifyOrderId),
    index("creator_orders_creator_idx").on(table.creatorId, table.createdAt),
  ],
);

export const creatorOrderLines = pgTable(
  "creator_order_lines",
  {
    id: serial("id").primaryKey(),
    creatorOrderId: varchar("creator_order_id").notNull(),
    shopifyLineId: text("shopify_line_id"),
    productTypeId: integer("product_type_id"),
    generationJobId: varchar("generation_job_id"),
    quantity: integer("quantity").notNull().default(1),
    unitRevenueCents: integer("unit_revenue_cents").notNull().default(0),
    unitCogsCents: integer("unit_cogs_cents").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("creator_order_lines_order_idx").on(table.creatorOrderId)],
);

export const creatorRankSnapshots = pgTable(
  "creator_rank_snapshots",
  {
    id: serial("id").primaryKey(),
    periodType: text("period_type").notNull(),
    periodKey: text("period_key").notNull(),
    metricKey: text("metric_key").notNull(),
    creatorId: varchar("creator_id").notNull(),
    valueCents: integer("value_cents"),
    value: decimal("value", { precision: 18, scale: 6 }),
    rank: integer("rank").notNull(),
    ofCount: integer("of_count").notNull(),
    percentile: decimal("percentile", { precision: 8, scale: 4 }),
    sharePct: decimal("share_pct", { precision: 8, scale: 4 }),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_rank_snapshots_uidx").on(
      table.periodType,
      table.periodKey,
      table.metricKey,
      table.creatorId,
    ),
    index("creator_rank_snapshots_lookup_idx").on(
      table.periodType,
      table.periodKey,
      table.metricKey,
      table.rank,
    ),
  ],
);

export const creatorPayouts = pgTable(
  "creator_payouts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    amountCents: integer("amount_cents").notNull(),
    method: text("method"),
    status: text("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("creator_payouts_creator_idx").on(table.creatorId)],
);

/** Creator Marketplace Phase 8 — customer generation pack purchases (platform shop). */
export const creatorPackPurchases = pgTable(
  "creator_pack_purchases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    customerId: text("customer_id").notNull(),
    sessionId: varchar("session_id"),
    shopifyOrderId: text("shopify_order_id").notNull(),
    shopifyLineId: text("shopify_line_id").notNull(),
    packId: text("pack_id").notNull(),
    credits: integer("credits").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    creditsClawed: integer("credits_clawed").notNull().default(0),
    status: text("status").notNull().default("paid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_pack_purchases_line_uidx").on(
      table.shopifyOrderId,
      table.shopifyLineId,
    ),
    index("creator_pack_purchases_creator_idx").on(table.creatorId, table.createdAt),
    index("creator_pack_purchases_customer_idx").on(table.customerId),
  ],
);

/** Operator-curated style visibility per creator (globals and customs). */
export const creatorStyleAssignments = pgTable(
  "creator_style_assignments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id").notNull(),
    stylePresetId: integer("style_preset_id").notNull(),
    /** Creator on/off. */
    enabled: boolean("enabled").notNull().default(true),
    /** Operator offer. Retire/unassign sets false; do not delete the row. */
    available: boolean("available").notNull().default(true),
    /** Creator storefront style dropdown order (0 = first). */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_style_assignments_uidx").on(table.creatorId, table.stylePresetId),
    index("creator_style_assignments_style_idx").on(table.stylePresetId),
  ],
);

export const creatorNotes = pgTable(
  "creator_notes",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id"),
    applicationId: varchar("application_id"),
    author: text("author"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("creator_notes_creator_idx").on(table.creatorId),
    index("creator_notes_application_idx").on(table.applicationId),
  ],
);

export const creatorEmailLog = pgTable(
  "creator_email_log",
  {
    id: serial("id").primaryKey(),
    creatorId: varchar("creator_id"),
    applicationId: varchar("application_id"),
    templateKey: text("template_key").notNull(),
    recipient: text("recipient").notNull(),
    status: text("status").notNull().default("skipped"),
    error: text("error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("creator_email_log_creator_idx").on(table.creatorId)],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("open"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    reporterEmail: text("reporter_email").notNull(),
    reporterName: text("reporter_name"),
    creatorId: varchar("creator_id"),
    merchantId: varchar("merchant_id"),
    shopDomain: text("shop_domain"),
    pageUrl: text("page_url"),
    userAgent: text("user_agent"),
    generationJobId: varchar("generation_job_id"),
    generationSnapshot: jsonb("generation_snapshot"),
    attachmentUrls: jsonb("attachment_urls").$type<string[]>(),
    lastReplyRole: text("last_reply_role"),
    lastReplyAt: timestamp("last_reply_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("support_tickets_source_idx").on(table.source, table.status),
    index("support_tickets_creator_idx").on(table.creatorId),
    index("support_tickets_merchant_idx").on(table.merchantId),
    index("support_tickets_shop_idx").on(table.shopDomain),
    index("support_tickets_updated_idx").on(table.updatedAt),
  ],
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type InsertSupportTicketRow = typeof supportTickets.$inferInsert;

export const supportTicketReplies = pgTable(
  "support_ticket_replies",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    authorRole: text("author_role").notNull(),
    authorName: text("author_name"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("support_ticket_replies_ticket_idx").on(table.ticketId, table.createdAt)],
);

export type SupportTicketReplyRow = typeof supportTicketReplies.$inferSelect;

export const helpArticles = pgTable(
  "help_articles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    demoUrl: text("demo_url"),
    audience: text("audience").notNull().default("both"),
    category: text("category").notNull().default("other"),
    published: boolean("published").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("help_articles_slug_uidx").on(table.slug),
    index("help_articles_audience_idx").on(table.audience, table.published),
  ],
);

export type HelpArticleRow = typeof helpArticles.$inferSelect;
export type InsertHelpArticleRow = typeof helpArticles.$inferInsert;

/** Studio Art Class newsletter — platform-owned list (not merchant quota). */
export const studioNewsletterSubscribers = pgTable(
  "studio_newsletter_subscribers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    /** merchant | creator | store_user */
    source: text("source").notNull(),
    shopDomain: text("shop_domain"),
    creatorUsername: text("creator_username"),
    customerId: varchar("customer_id"),
    creditGranted: boolean("credit_granted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("studio_newsletter_email_uidx").on(table.email),
    index("studio_newsletter_source_idx").on(table.source, table.createdAt),
  ],
);

export type StudioNewsletterSubscriber = typeof studioNewsletterSubscribers.$inferSelect;

/** Per-shop Shopify variant ids for merchant-sold Studio Credit packs. */
export const merchantPackVariants = pgTable(
  "merchant_pack_variants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    shopDomain: text("shop_domain").notNull(),
    packId: text("pack_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("merchant_pack_variants_shop_pack_uidx").on(table.shopDomain, table.packId),
    index("merchant_pack_variants_shop_idx").on(table.shopDomain),
  ],
);

export type MerchantPackVariant = typeof merchantPackVariants.$inferSelect;

/** Merchant shop generation-pack purchases (customer pays store; wholesale to merchant). */
export const merchantPackPurchases = pgTable(
  "merchant_pack_purchases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    shopDomain: text("shop_domain").notNull(),
    customerId: text("customer_id").notNull(),
    shopifyOrderId: text("shopify_order_id").notNull(),
    shopifyLineId: text("shopify_line_id").notNull(),
    packId: text("pack_id").notNull(),
    credits: integer("credits").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    wholesaleCents: integer("wholesale_cents").notNull().default(0),
    creditsClawed: integer("credits_clawed").notNull().default(0),
    status: text("status").notNull().default("paid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("merchant_pack_purchases_line_uidx").on(
      table.shopifyOrderId,
      table.shopifyLineId,
    ),
    index("merchant_pack_purchases_shop_idx").on(table.shopDomain, table.createdAt),
    index("merchant_pack_purchases_customer_idx").on(table.customerId),
  ],
);

export type MerchantPackPurchase = typeof merchantPackPurchases.$inferSelect;

/** Creator shops a signed-in customer has opened (gallery “shops you've used”). */
export const creatorCustomerShopVisits = pgTable(
  "creator_customer_shop_visits",
  {
    id: serial("id").primaryKey(),
    customerId: varchar("customer_id").notNull(),
    creatorId: varchar("creator_id").notNull(),
    creatorUsername: text("creator_username").notNull(),
    shopName: text("shop_name"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("creator_customer_shop_visits_uidx").on(table.customerId, table.creatorId),
    index("creator_customer_shop_visits_customer_idx").on(table.customerId, table.lastSeenAt),
  ],
);

export type CreatorCustomerShopVisit = typeof creatorCustomerShopVisits.$inferSelect;

// ── Shipping Coverage Service (Printify table ingestion + geo-gating) ─────────
// See docs/Shipping-rates-plan/shipping-rates-and-geo-gating-spec.md.
// All money columns are USD cents (Printify v2 ceiling table). Standard tier only.

/** One (blueprint, print provider) pair = one shipping class. */
export const shippingClasses = pgTable(
  "shipping_classes",
  {
    id: serial("id").primaryKey(),
    blueprintId: integer("blueprint_id").notNull(),
    providerId: integer("provider_id").notNull(),
    name: text("name").notNull().default(""),
    /** Printify shipping method actually ingested (e.g. "standard"). */
    shippingMethod: text("shipping_method").notNull().default("standard"),
    tableHash: text("table_hash"),
    /**
     * Cross-zone variant groups (JSON): [{ group: "g1", label: "11\" x 14\"…",
     * printifyVariantIds: [..] }] sorted cheapest-first by US first-item rate.
     * Two variants share a group iff their (first, additional) pair matches in
     * EVERY zone of the table.
     */
    variantGroupsJson: text("variant_groups_json").notNull().default("[]"),
    /** Manual per-class overrides for tier evaluation (null = platform defaults). */
    absoluteCapCentsOverride: integer("absolute_cap_cents_override"),
    typicalRetailCentsOverride: integer("typical_retail_cents_override"),
    /**
     * Per-class override of BandConfig.groupDeltaSplitThresholdCents (null =
     * default 200). Interim merge lever for profile-budget pressure: raising it
     * merges a class's per-group profiles into shared ones (cheaper on the
     * 99-profile cap, worse tolerance). 493:36 (Framed Vertical, Choice) stays
     * 6-way split by default — monitor mixed-size framed cart frequency
     * post-launch before touching this.
     */
    groupDeltaSplitThresholdCents: integer("group_delta_split_threshold_cents"),
    lastFetchedAt: timestamp("last_fetched_at"),
    lastChangedAt: timestamp("last_changed_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_classes_bp_provider_uidx").on(table.blueprintId, table.providerId),
  ],
);

export type ShippingClass = typeof shippingClasses.$inferSelect;

/** Normalised per-zone per-variant-group rate with exclusion-tier verdict. */
export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: serial("id").primaryKey(),
    shippingClassId: integer("shipping_class_id").notNull(),
    /** ISO 3166-1 alpha-2, or "ROW" for rest-of-world. */
    countryCode: text("country_code").notNull(),
    /** Cross-zone variant group key ("g1"…), never null — single-group classes use "g1". */
    variantGroup: text("variant_group").notNull(),
    firstItemCents: integer("first_item_cents").notNull(),
    additionalCents: integer("additional_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    shippable: boolean("shippable").notNull().default(true),
    /** normal | warned | excluded (spec 0.4 tiers). */
    tier: text("tier").notNull().default("normal"),
    /** Diagnostics: firstItem / typicalRetail in basis points; null when retail unknown. */
    ratioBp: integer("ratio_bp"),
    /** Typical retail used for the ratio (median group retail or COGS fallback). */
    typicalRetailCents: integer("typical_retail_cents"),
    /** Why this tier: threshold | absolute_cap | manual_block | manual_allow | no_retail. */
    tierReason: text("tier_reason"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_rates_class_country_group_uidx").on(
      table.shippingClassId,
      table.countryCode,
      table.variantGroup,
    ),
    index("shipping_rates_class_idx").on(table.shippingClassId),
  ],
);

export type ShippingRate = typeof shippingRates.$inferSelect;

/** Our catalogue variant → shipping class/group mapping (+ Phase 2 pseudo-weight). */
export const variantShipping = pgTable(
  "variant_shipping",
  {
    id: serial("id").primaryKey(),
    shippingClassId: integer("shipping_class_id").notNull(),
    productTypeId: integer("product_type_id").notNull(),
    /** variantMap key on the product type, e.g. "sizeId:colorId". */
    sizeColorKey: text("size_color_key").notNull(),
    printifyVariantId: text("printify_variant_id").notNull(),
    shopifyVariantId: text("shopify_variant_id"),
    variantGroup: text("variant_group").notNull(),
    /** Phase 2: additionalCents in the reference zone (1 gram = 1 cent). */
    pseudoWeightGrams: integer("pseudo_weight_grams"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("variant_shipping_product_variant_uidx").on(
      table.productTypeId,
      table.printifyVariantId,
    ),
    index("variant_shipping_class_idx").on(table.shippingClassId),
  ],
);

export type VariantShipping = typeof variantShipping.$inferSelect;

/** Raw Printify table snapshots (one per hash change) for audit/replay. */
export const shippingTableSnapshots = pgTable(
  "shipping_table_snapshots",
  {
    id: serial("id").primaryKey(),
    shippingClassId: integer("shipping_class_id").notNull(),
    tableHash: text("table_hash").notNull(),
    rawJson: text("raw_json").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [index("shipping_table_snapshots_class_idx").on(table.shippingClassId, table.fetchedAt)],
);

export type ShippingTableSnapshot = typeof shippingTableSnapshots.$inferSelect;

/** Audit log: every rate/zone/group/tier change from a sync (spec 0.1). */
export const shippingRateAudit = pgTable(
  "shipping_rate_audit",
  {
    id: serial("id").primaryKey(),
    shippingClassId: integer("shipping_class_id").notNull(),
    syncRunId: integer("sync_run_id"),
    countryCode: text("country_code"),
    variantGroup: text("variant_group"),
    /** class_added | rate_changed | zone_added | zone_removed | grouping_changed | tier_changed */
    changeType: text("change_type").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("shipping_rate_audit_class_idx").on(table.shippingClassId, table.createdAt)],
);

export type ShippingRateAudit = typeof shippingRateAudit.$inferSelect;

/** Manual per-class (or global, shippingClassId=0) country block/allow overrides. */
export const shippingZoneRules = pgTable(
  "shipping_zone_rules",
  {
    id: serial("id").primaryKey(),
    /** 0 = applies to every class. */
    shippingClassId: integer("shipping_class_id").notNull().default(0),
    countryCode: text("country_code").notNull(),
    /** block | allow — overrides tier thresholds in both directions. */
    action: text("action").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_zone_rules_class_country_uidx").on(table.shippingClassId, table.countryCode),
  ],
);

export type ShippingZoneRule = typeof shippingZoneRules.$inferSelect;

/** Materialised coverage matrix: (product, country) → shippable/tier/from-price. */
export const shippingCoverage = pgTable(
  "shipping_coverage",
  {
    id: serial("id").primaryKey(),
    productTypeId: integer("product_type_id").notNull(),
    countryCode: text("country_code").notNull(),
    shippable: boolean("shippable").notNull(),
    /** normal | warned | excluded — best (least severe) tier among the product's shippable groups. */
    tier: text("tier").notNull(),
    /** "from $X" price: min first-item cents among the product's shippable groups. */
    firstItemCents: integer("first_item_cents"),
    additionalCents: integer("additional_cents"),
    shippingClassId: integer("shipping_class_id").notNull(),
    tableHash: text("table_hash"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_coverage_product_country_uidx").on(table.productTypeId, table.countryCode),
    index("shipping_coverage_country_idx").on(table.countryCode, table.shippable),
  ],
);

export type ShippingCoverage = typeof shippingCoverage.$inferSelect;

/** One shipping-tables sync run (nightly | boot | manual | seed). */
export const shippingSyncRuns = pgTable("shipping_sync_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("running"), // running | complete | failed
  classesChecked: integer("classes_checked").notNull().default(0),
  classesChanged: integer("classes_changed").notNull().default(0),
  classesFailed: integer("classes_failed").notNull().default(0),
  summaryJson: text("summary_json").notNull().default("{}"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export type ShippingSyncRun = typeof shippingSyncRuns.$inferSelect;

// ── Phase 3: Shopify delivery-profile reconciler (per-shop) ──────────────────

/** Per-shop shipping sync mode + reconcile bookkeeping. */
export const shippingStoreSettings = pgTable(
  "shipping_store_settings",
  {
    id: serial("id").primaryKey(),
    shopDomain: text("shop_domain").notNull(),
    /**
     * off   → reconciler never applies (dry-run allowed); checkout unchanged.
     * table → weight-banded delivery profiles managed by the reconciler.
     * exact → CarrierService quotes (Exact Mode, later). Mutually exclusive
     *         with table: table mode must not attach the carrier.
     */
    shippingMode: text("shipping_mode").notNull().default("off"),
    /** When ON, reconciler writes pseudo-weights to app-created variants. */
    manageVariantWeights: boolean("manage_variant_weights").notNull().default(true),
    /** Per-shop re-validated rates-per-zone cap (scratch-profile probe on first apply). */
    probedMaxRatesPerZone: integer("probed_max_rates_per_zone"),
    probedAt: timestamp("probed_at"),
    /**
     * Pinned buffered USD→shop-unit FX rate (string decimal; "1" for USD).
     * Pinned so daily FX noise does not rewrite every rate; re-pinned only
     * when drift exceeds SHIPPING_FX_REPIN_DRIFT (default 7.5%).
     */
    pinnedFxRate: text("pinned_fx_rate"),
    /** ISO-4217 the pin converts into (USD→this). Needed so rewards display can reuse the shop pin. */
    pinnedFxCurrency: text("pinned_fx_currency"),
    pinnedFxAt: timestamp("pinned_fx_at"),
    lastReconcileAt: timestamp("last_reconcile_at"),
    /** ok | error | partial */
    lastReconcileStatus: text("last_reconcile_status"),
    lastReconcileError: text("last_reconcile_error"),
    lastReconcileSummaryJson: text("last_reconcile_summary_json").notNull().default("{}"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shipping_store_settings_shop_uidx").on(table.shopDomain)],
);

export type ShippingStoreSettings = typeof shippingStoreSettings.$inferSelect;

/** ID map: one app-owned Shopify delivery profile per (shop, profileKey). */
export const shippingStoreProfiles = pgTable(
  "shipping_store_profiles",
  {
    id: serial("id").primaryKey(),
    shopDomain: text("shop_domain").notNull(),
    /** Phase 2 profile key, e.g. "540:99#g4" or "6:99#all". */
    profileKey: text("profile_key").notNull(),
    shippingClassId: integer("shipping_class_id").notNull(),
    /** null = shared "#all" profile. */
    variantGroup: text("variant_group"),
    shopifyProfileId: text("shopify_profile_id"),
    shopifyLocationGroupId: text("shopify_location_group_id"),
    /** Hash of the desired zones+rates+name; matching hash → zones/rates are a no-op. */
    desiredHash: text("desired_hash"),
    /** pending | synced | error */
    status: text("status").notNull().default("pending"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_store_profiles_shop_key_uidx").on(table.shopDomain, table.profileKey),
    index("shipping_store_profiles_shop_idx").on(table.shopDomain),
  ],
);

export type ShippingStoreProfile = typeof shippingStoreProfiles.$inferSelect;

/** ID map: zones inside an app-owned profile (collapsed country groups / ROW). */
export const shippingStoreZones = pgTable(
  "shipping_store_zones",
  {
    id: serial("id").primaryKey(),
    storeProfileId: integer("store_profile_id").notNull(),
    /** Stable key: "ROW", "BLOCKED", or sha1 of the sorted country list. */
    zoneKey: text("zone_key").notNull(),
    shopifyZoneId: text("shopify_zone_id"),
    countriesJson: text("countries_json").notNull().default("[]"),
    restOfWorld: boolean("rest_of_world").notNull().default(false),
    /** Hash of the zone's rate list — skip method-definition writes when equal. */
    desiredHash: text("desired_hash"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_store_zones_profile_key_uidx").on(table.storeProfileId, table.zoneKey),
  ],
);

export type ShippingStoreZone = typeof shippingStoreZones.$inferSelect;

/** ID map: weight-band method definitions inside a zone. */
export const shippingStoreRates = pgTable(
  "shipping_store_rates",
  {
    id: serial("id").primaryKey(),
    storeZoneId: integer("store_zone_id").notNull(),
    /** 0-based band index; the final open band is the highest index. */
    bandIndex: integer("band_index").notNull(),
    shopifyMethodDefinitionId: text("shopify_method_definition_id"),
    lowerGrams: integer("lower_grams").notNull(),
    /** null = unbounded open band. */
    upperGrams: integer("upper_grams"),
    /** Price in the SHOP's currency minor units (post-FX). */
    priceCents: integer("price_cents").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_store_rates_zone_band_uidx").on(table.storeZoneId, table.bandIndex),
  ],
);

export type ShippingStoreRate = typeof shippingStoreRates.$inferSelect;

/**
 * Variants the reconciler has associated into an app profile (base + shadow).
 * Needed for GC / kill-switch dissociation and idempotent weight writes.
 */
export const shippingStoreVariants = pgTable(
  "shipping_store_variants",
  {
    id: serial("id").primaryKey(),
    shopDomain: text("shop_domain").notNull(),
    storeProfileId: integer("store_profile_id").notNull(),
    /** Numeric Shopify variant id (no gid prefix). */
    shopifyVariantId: text("shopify_variant_id").notNull(),
    /** base | shadow */
    source: text("source").notNull().default("base"),
    pseudoWeightGrams: integer("pseudo_weight_grams"),
    weightWrittenAt: timestamp("weight_written_at"),
    associatedAt: timestamp("associated_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipping_store_variants_shop_variant_uidx").on(
      table.shopDomain,
      table.shopifyVariantId,
    ),
    index("shipping_store_variants_profile_idx").on(table.storeProfileId),
  ],
);

export type ShippingStoreVariant = typeof shippingStoreVariants.$inferSelect;
