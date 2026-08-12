/**
 * Creator Marketplace Phase 5 — financial ledger.
 * Accrues AI gen costs, records order P&L from orders/paid, adjusts refunds.
 */
import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import {
  computeCreatorOrderPnl,
  computeTransactionFeeCents,
  CREATOR_SHARE_BASES,
  type CreatorShareBasis,
} from "@shared/creatorMarketplace";
import {
  catalogVariantCosts,
  creatorGenerationCosts,
  creatorOrderLines,
  creatorOrders,
  creators,
  generationJobs,
  publishedProducts,
} from "@shared/schema";
import { resolveVariantFromMap } from "@shared/variantMapResolve";
import { db } from "./db";
import {
  aiCostUsdToCents,
  getAiGenerationCostUsd,
  getCreatorPlatformShopDomain,
  getCreatorTransactionFeeConfig,
  isCreatorMarketplaceEnabled,
} from "./creator-config";
import { normalizeShopifyOrderLine } from "./flat-order-fulfillment";
import { storage } from "./storage";
function dollarsToCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function normalizeShop(shop: string | null | undefined): string {
  return String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function isPlatformShop(shop: string): boolean {
  const platform = normalizeShop(getCreatorPlatformShopDomain());
  if (!platform) return false;
  const s = normalizeShop(shop);
  return s === platform || s === platform.replace(/\.myshopify\.com$/, "");
}

function parseShareBasis(raw: string | null | undefined): CreatorShareBasis {
  const v = String(raw || "").trim();
  return (CREATOR_SHARE_BASES as readonly string[]).includes(v)
    ? (v as CreatorShareBasis)
    : "net_contribution";
}

function shopifyOrderIdKey(order: any): string {
  if (order?.admin_graphql_api_id) return String(order.admin_graphql_api_id);
  if (order?.id != null) return String(order.id);
  return "";
}

/** Accrue AI cost snapshot for a completed creator generation (idempotent per job). */
export async function recordCreatorGenerationCost(params: {
  creatorId: string;
  generationJobId: string;
  sessionId?: string | null;
  customerId?: string | null;
  customizerPageId?: string | null;
  billingMode?: string | null;
}): Promise<{ inserted: boolean; costCents: number }> {
  if (!isCreatorMarketplaceEnabled()) {
    return { inserted: false, costCents: 0 };
  }
  const costUsd = await getAiGenerationCostUsd();
  const costCents = aiCostUsdToCents(costUsd);
  try {
    await db.insert(creatorGenerationCosts).values({
      creatorId: params.creatorId,
      generationJobId: params.generationJobId,
      sessionId: params.sessionId || null,
      customerId: params.customerId || null,
      customizerPageId: params.customizerPageId || null,
      costCents,
      billingMode: params.billingMode || null,
    });
    return { inserted: true, costCents };
  } catch (e: any) {
    // Unique on generation_job_id — already accrued.
    if (String(e?.message || e).includes("unique") || e?.code === "23505") {
      return { inserted: false, costCents };
    }
    throw e;
  }
}

async function lookupUnitCogsCents(params: {
  productTypeId: number | null;
  sizeId: string | null;
  colorId: string | null;
}): Promise<{ unitCogsCents: number; shippingCents: number }> {
  if (!params.productTypeId || params.productTypeId <= 0) {
    return { unitCogsCents: 0, shippingCents: 0 };
  }
  try {
    const pt = await storage.getProductType(params.productTypeId);
    if (!pt) return { unitCogsCents: 0, shippingCents: 0 };

    let printifyVariantId: string | null = null;
    try {
      const map = JSON.parse(pt.variantMap || "{}");
      const resolved = resolveVariantFromMap(map, params.sizeId, params.colorId || "default");
      if (resolved?.entry?.printifyVariantId != null) {
        printifyVariantId = String(resolved.entry.printifyVariantId);
      }
    } catch {
      /* ignore */
    }

    if (printifyVariantId) {
      const [row] = await db
        .select({
          baseCogsCents: catalogVariantCosts.baseCogsCents,
          shipping: catalogVariantCosts.shippingFirstItemUsCents,
        })
        .from(catalogVariantCosts)
        .where(
          and(
            eq(catalogVariantCosts.productTypeId, params.productTypeId),
            eq(catalogVariantCosts.supplier, "printify"),
            eq(catalogVariantCosts.supplierVariantId, printifyVariantId),
            eq(catalogVariantCosts.isRemoved, false),
          ),
        )
        .limit(1);
      if (row?.baseCogsCents != null && row.baseCogsCents > 0) {
        return {
          unitCogsCents: row.baseCogsCents,
          shippingCents: Math.max(0, row.shipping ?? 0),
        };
      }
    }

    // Fallback: product_types.printify_costs JSON (dollars keyed by size or size:color).
    try {
      const costs = JSON.parse(pt.printifyCosts || "{}") as Record<string, number>;
      const size = String(params.sizeId || "").toLowerCase();
      const color = String(params.colorId || "default").toLowerCase();
      const candidates = [
        `${size}:${color}`,
        size,
        params.sizeId || "",
        `${params.sizeId}:${params.colorId || "default"}`,
      ];
      for (const key of candidates) {
        if (key && costs[key] != null && Number(costs[key]) > 0) {
          return {
            unitCogsCents: Math.round(Number(costs[key]) * 100),
            shippingCents: 0,
          };
        }
      }
      const first = Object.values(costs).find((v) => Number(v) > 0);
      if (first != null) {
        return { unitCogsCents: Math.round(Number(first) * 100), shippingCents: 0 };
      }
    } catch {
      /* ignore */
    }
  } catch (e: any) {
    console.warn("[creator-ledger] COGS lookup failed:", e?.message || e);
  }
  return { unitCogsCents: 0, shippingCents: 0 };
}

async function resolveJobIdFromLine(
  shop: string,
  props: Record<string, string>,
  variantId: string | null,
): Promise<string | null> {
  const fromProp = props._appai_job_id || null;
  if (fromProp) return fromProp;

  if (variantId) {
    const numeric = String(variantId).replace("gid://shopify/ProductVariant/", "");
    try {
      const [pp] = await db
        .select({ designId: publishedProducts.designId })
        .from(publishedProducts)
        .where(
          and(
            eq(publishedProducts.shop, normalizeShop(shop)),
            eq(publishedProducts.shopifyVariantId, numeric),
          ),
        )
        .limit(1);
      if (pp?.designId) {
        // designId may be readable label; prefer job if it looks like a job id.
        const job = await storage.getGenerationJob(pp.designId).catch(() => null);
        if (job) return job.id;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function resolveCreatorIdForLine(params: {
  props: Record<string, string>;
  jobId: string | null;
}): Promise<{ creatorId: string; sessionId: string | null } | null> {
  const fromProp = params.props._creator_id?.trim();
  if (fromProp) {
    const [row] = await db
      .select({ id: creators.id })
      .from(creators)
      .where(eq(creators.id, fromProp))
      .limit(1);
    if (row) {
      return {
        creatorId: row.id,
        sessionId: params.props._creator_session || null,
      };
    }
  }

  const username = params.props._creator_username?.trim().toLowerCase();
  if (username) {
    const [row] = await db
      .select({ id: creators.id })
      .from(creators)
      .where(eq(creators.username, username))
      .limit(1);
    if (row) {
      return {
        creatorId: row.id,
        sessionId: params.props._creator_session || null,
      };
    }
  }

  if (params.jobId) {
    try {
      const [job] = await db
        .select({
          creatorId: generationJobs.creatorId,
          creatorSessionId: generationJobs.creatorSessionId,
        })
        .from(generationJobs)
        .where(eq(generationJobs.id, params.jobId))
        .limit(1);
      if (job?.creatorId) {
        return {
          creatorId: job.creatorId,
          sessionId: job.creatorSessionId || params.props._creator_session || null,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

type LineDraft = {
  shopifyLineId: string | null;
  productTypeId: number | null;
  generationJobId: string | null;
  quantity: number;
  unitRevenueCents: number;
  unitCogsCents: number;
  lineDiscountCents: number;
  shippingCogsCents: number;
  sessionId: string | null;
};

/**
 * Record creator order P&L from a paid Shopify order (idempotent per creator+order).
 * Only lines with creator attribution are included; typically platform-shop checkouts.
 */
export async function recordCreatorOrdersFromPaidWebhook(
  shop: string,
  order: any,
): Promise<{ creatorsTouched: number; ordersUpserted: number }> {
  if (!isCreatorMarketplaceEnabled()) {
    return { creatorsTouched: 0, ordersUpserted: 0 };
  }
  // Creator checkouts use the platform shop. Skip unrelated merchant shops.
  if (!isPlatformShop(shop)) {
    return { creatorsTouched: 0, ordersUpserted: 0 };
  }

  const orderKey = shopifyOrderIdKey(order);
  if (!orderKey || !Array.isArray(order?.line_items)) {
    return { creatorsTouched: 0, ordersUpserted: 0 };
  }

  const feeCfg = await getCreatorTransactionFeeConfig();
  const byCreator = new Map<
    string,
    { lines: LineDraft[]; sessionId: string | null }
  >();

  for (const raw of order.line_items) {
    const line = normalizeShopifyOrderLine(raw);
    const props = line.properties;
    const qty = Math.max(1, Number(raw.quantity) || 1);
    const linePriceCents = dollarsToCents(raw.price);
    const lineDiscountCents = Array.isArray(raw.discount_allocations)
      ? raw.discount_allocations.reduce(
          (s: number, d: any) => s + dollarsToCents(d.amount),
          0,
        )
      : 0;

    const jobId = await resolveJobIdFromLine(shop, props, line.variantId);
    const creator = await resolveCreatorIdForLine({ props, jobId });
    if (!creator) continue;

    let productTypeId: number | null = null;
    let sizeId = props.Size || props.size || null;
    let colorId = props.Color || props.color || props.frameColor || "default";
    if (jobId) {
      try {
        const job = await storage.getGenerationJob(jobId);
        if (job?.productTypeId) productTypeId = Number(job.productTypeId) || null;
        if (!sizeId && job?.size) sizeId = String(job.size);
        if ((!colorId || colorId === "default") && (job as any)?.frameColor) {
          colorId = String((job as any).frameColor);
        }
      } catch {
        /* ignore */
      }
    }

    const cogs = await lookupUnitCogsCents({
      productTypeId,
      sizeId,
      colorId,
    });

    const draft: LineDraft = {
      shopifyLineId: raw.id != null ? String(raw.id) : null,
      productTypeId,
      generationJobId: jobId,
      quantity: qty,
      unitRevenueCents: linePriceCents,
      unitCogsCents: cogs.unitCogsCents,
      lineDiscountCents,
      shippingCogsCents: cogs.shippingCents,
      sessionId: creator.sessionId,
    };

    const bucket = byCreator.get(creator.creatorId) || {
      lines: [],
      sessionId: creator.sessionId,
    };
    bucket.lines.push(draft);
    if (!bucket.sessionId && creator.sessionId) bucket.sessionId = creator.sessionId;
    byCreator.set(creator.creatorId, bucket);
  }

  if (byCreator.size === 0) {
    return { creatorsTouched: 0, ordersUpserted: 0 };
  }

  let ordersUpserted = 0;
  for (const [creatorId, bucket] of byCreator) {
    const [creatorRow] = await db
      .select({
        shareBasis: creators.shareBasis,
        revenueShareCreatorPct: creators.revenueShareCreatorPct,
        revenueShareAasPct: creators.revenueShareAasPct,
      })
      .from(creators)
      .where(eq(creators.id, creatorId))
      .limit(1);
    if (!creatorRow) continue;

    const grossCents = bucket.lines.reduce(
      (s, l) => s + l.unitRevenueCents * l.quantity,
      0,
    );
    const discountCents = bucket.lines.reduce((s, l) => s + l.lineDiscountCents, 0);
    const fulfilmentCostCents = bucket.lines.reduce(
      (s, l) => s + l.unitCogsCents * l.quantity + l.shippingCogsCents,
      0,
    );
    const chargeable = Math.max(0, grossCents - discountCents);
    const transactionFeeCents = computeTransactionFeeCents({
      amountCents: chargeable,
      feePct: feeCfg.feePct,
      feeFixedCents: feeCfg.feeFixedCents,
    });

    const jobIds = [
      ...new Set(
        bucket.lines
          .map((l) => l.generationJobId)
          .filter((id): id is string => !!id),
      ),
    ];
    let aiGenCostCents = 0;
    if (jobIds.length > 0) {
      const costRows = await db
        .select({
          costCents: creatorGenerationCosts.costCents,
          jobId: creatorGenerationCosts.generationJobId,
        })
        .from(creatorGenerationCosts)
        .where(
          and(
            eq(creatorGenerationCosts.creatorId, creatorId),
            inArray(creatorGenerationCosts.generationJobId, jobIds),
          ),
        );
      aiGenCostCents = costRows.reduce((s, r) => s + (r.costCents || 0), 0);
    }

    const [existing] = await db
      .select({ id: creatorOrders.id, refundCents: creatorOrders.refundCents })
      .from(creatorOrders)
      .where(
        and(
          eq(creatorOrders.creatorId, creatorId),
          eq(creatorOrders.shopifyOrderId, orderKey),
        ),
      )
      .limit(1);

    const refundCents = existing?.refundCents ?? 0;
    const pnl = computeCreatorOrderPnl({
      grossCents,
      discountCents,
      fulfilmentCostCents,
      transactionFeeCents,
      aiGenCostCents,
      refundCents,
      shareBasis: parseShareBasis(creatorRow.shareBasis),
      revenueShareCreatorPct: creatorRow.revenueShareCreatorPct,
      revenueShareAasPct: creatorRow.revenueShareAasPct,
    });

    const shippingCollectedCents = dollarsToCents(
      order.total_shipping_price_set?.shop_money?.amount ??
        order.shipping_lines?.[0]?.price ??
        0,
    );

    const attributionSnapshot = {
      shop: normalizeShop(shop),
      orderName: order.name || null,
      lineCount: bucket.lines.length,
      jobIds,
      recordedAt: new Date().toISOString(),
    };

    let orderId = existing?.id;
    if (existing) {
      await db
        .update(creatorOrders)
        .set({
          shopifyOrderName: order.name || null,
          sessionId: bucket.sessionId,
          attributionSnapshot,
          grossCents,
          discountCents,
          shippingCollectedCents,
          fulfilmentCostCents,
          transactionFeeCents,
          productProfitCents: pnl.productProfitCents,
          aiGenCostCents,
          netContributionCents: pnl.netContributionCents,
          creatorShareCents: pnl.creatorShareCents,
          aasShareCents: pnl.aasShareCents,
          status: refundCents > 0 ? "partially_refunded" : "paid",
          updatedAt: new Date(),
        })
        .where(eq(creatorOrders.id, existing.id));
      await db
        .delete(creatorOrderLines)
        .where(eq(creatorOrderLines.creatorOrderId, existing.id));
    } else {
      const [inserted] = await db
        .insert(creatorOrders)
        .values({
          creatorId,
          shopifyOrderId: orderKey,
          shopifyOrderName: order.name || null,
          sessionId: bucket.sessionId,
          attributionSnapshot,
          grossCents,
          discountCents,
          shippingCollectedCents,
          fulfilmentCostCents,
          transactionFeeCents,
          productProfitCents: pnl.productProfitCents,
          aiGenCostCents,
          netContributionCents: pnl.netContributionCents,
          creatorShareCents: pnl.creatorShareCents,
          aasShareCents: pnl.aasShareCents,
          refundCents: 0,
          status: "paid",
        })
        .returning({ id: creatorOrders.id });
      orderId = inserted.id;
    }

    if (orderId) {
      await db.insert(creatorOrderLines).values(
        bucket.lines.map((l) => ({
          creatorOrderId: orderId!,
          shopifyLineId: l.shopifyLineId,
          productTypeId: l.productTypeId,
          generationJobId: l.generationJobId,
          quantity: l.quantity,
          unitRevenueCents: l.unitRevenueCents,
          unitCogsCents: l.unitCogsCents,
        })),
      );
      ordersUpserted++;
    }
  }

  return { creatorsTouched: byCreator.size, ordersUpserted };
}

async function findCreatorOrdersByShopifyId(orderId: string) {
  const orderKeys = [
    String(orderId),
    orderId.startsWith("gid://")
      ? orderId
      : `gid://shopify/Order/${String(orderId).replace(/\D/g, "")}`,
    String(orderId).replace(/\D/g, ""),
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(creatorOrders)
    .where(inArray(creatorOrders.shopifyOrderId, orderKeys));

  if (rows.length > 0) return rows;

  const digits = String(orderId).replace(/\D/g, "");
  if (!digits) return [];
  // Narrow scan fallback for mismatched gid vs numeric ids.
  const all = await db
    .select()
    .from(creatorOrders)
    .where(like(creatorOrders.shopifyOrderId, `%${digits}%`))
    .limit(20);
  return all.filter(
    (r) =>
      r.shopifyOrderId.includes(digits) ||
      String(r.shopifyOrderId).replace(/\D/g, "") === digits,
  );
}

/** Apply absolute refund total to an existing creator order (idempotent max). */
export async function applyCreatorOrderRefund(params: {
  shop: string;
  orderId: string;
  refundCents: number;
}): Promise<{ updated: number }> {
  if (!isCreatorMarketplaceEnabled()) return { updated: 0 };
  if (!isPlatformShop(params.shop)) return { updated: 0 };
  const rows = await findCreatorOrdersByShopifyId(params.orderId);
  if (rows.length === 0) return { updated: 0 };
  return applyRefundToRows(rows, params.refundCents);
}

/** Add a refund event amount onto existing refund_cents. */
export async function addCreatorOrderRefund(params: {
  shop: string;
  orderId: string;
  additionalRefundCents: number;
}): Promise<{ updated: number }> {
  if (!isCreatorMarketplaceEnabled()) return { updated: 0 };
  if (!isPlatformShop(params.shop)) return { updated: 0 };
  const rows = await findCreatorOrdersByShopifyId(params.orderId);
  if (rows.length === 0) return { updated: 0 };
  let updated = 0;
  for (const row of rows) {
    const r = await applyRefundToRows(
      [row],
      row.refundCents + Math.max(0, Math.round(params.additionalRefundCents || 0)),
    );
    updated += r.updated;
  }
  return { updated };
}

async function applyRefundToRows(
  rows: Array<typeof creatorOrders.$inferSelect>,
  refundCentsIn: number,
): Promise<{ updated: number }> {
  // Treat inbound amount as absolute total refunded on the order (Shopify refunds
  // webhooks often send the refund event amount; callers pass cumulative when known).
  const inbound = Math.max(0, Math.round(refundCentsIn || 0));
  let updated = 0;
  for (const row of rows) {
    const [creatorRow] = await db
      .select({
        shareBasis: creators.shareBasis,
        revenueShareCreatorPct: creators.revenueShareCreatorPct,
        revenueShareAasPct: creators.revenueShareAasPct,
      })
      .from(creators)
      .where(eq(creators.id, row.creatorId))
      .limit(1);
    if (!creatorRow) continue;

    const nextRefund = Math.min(
      row.grossCents,
      Math.max(row.refundCents, inbound),
    );

    const pnl = computeCreatorOrderPnl({
      grossCents: row.grossCents,
      discountCents: row.discountCents,
      fulfilmentCostCents: row.fulfilmentCostCents,
      transactionFeeCents: row.transactionFeeCents,
      aiGenCostCents: row.aiGenCostCents,
      refundCents: nextRefund,
      shareBasis: parseShareBasis(creatorRow.shareBasis),
      revenueShareCreatorPct: creatorRow.revenueShareCreatorPct,
      revenueShareAasPct: creatorRow.revenueShareAasPct,
    });

    const fullyRefunded = nextRefund >= Math.max(0, row.grossCents - row.discountCents);
    await db
      .update(creatorOrders)
      .set({
        refundCents: nextRefund,
        productProfitCents: pnl.productProfitCents,
        netContributionCents: pnl.netContributionCents,
        creatorShareCents: pnl.creatorShareCents,
        aasShareCents: pnl.aasShareCents,
        status: fullyRefunded ? "refunded" : "partially_refunded",
        updatedAt: new Date(),
      })
      .where(eq(creatorOrders.id, row.id));
    updated++;
  }
  return { updated };
}

/** Mark creator orders cancelled (full refund of remaining product profit impact). */
export async function applyCreatorOrderCancelled(params: {
  shop: string;
  orderId: string;
}): Promise<{ updated: number }> {
  if (!isCreatorMarketplaceEnabled()) return { updated: 0 };
  if (!isPlatformShop(params.shop)) return { updated: 0 };
  const matched = await findCreatorOrdersByShopifyId(params.orderId);
  if (matched.length === 0) return { updated: 0 };

  let updated = 0;
  for (const row of matched) {
    const refundTarget = Math.max(0, row.grossCents - row.discountCents);
    const r = await applyRefundToRows([row], refundTarget);
    if (r.updated > 0) {
      await db
        .update(creatorOrders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(creatorOrders.id, row.id));
      updated += r.updated;
    }
  }
  return { updated };
}

/** Sum money fields for daily rollup (gen costs + orders). */
export async function sumCreatorMoneyForDay(params: {
  day: string;
  creatorId?: string;
}): Promise<
  Map<
    string,
    {
      genCostCents: number;
      orders: number;
      grossCents: number;
      productProfitCents: number;
      netContributionCents: number;
    }
  >
> {
  const start = new Date(`${params.day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const out = new Map<
    string,
    {
      genCostCents: number;
      orders: number;
      grossCents: number;
      productProfitCents: number;
      netContributionCents: number;
    }
  >();

  const costWhere = params.creatorId
    ? and(
        gte(creatorGenerationCosts.createdAt, start),
        lt(creatorGenerationCosts.createdAt, end),
        eq(creatorGenerationCosts.creatorId, params.creatorId),
      )
    : and(
        gte(creatorGenerationCosts.createdAt, start),
        lt(creatorGenerationCosts.createdAt, end),
      );

  const costRows = await db
    .select({
      creatorId: creatorGenerationCosts.creatorId,
      genCostCents: sql<number>`coalesce(sum(${creatorGenerationCosts.costCents}), 0)::int`,
    })
    .from(creatorGenerationCosts)
    .where(costWhere)
    .groupBy(creatorGenerationCosts.creatorId);

  for (const row of costRows) {
    out.set(row.creatorId, {
      genCostCents: Number(row.genCostCents) || 0,
      orders: 0,
      grossCents: 0,
      productProfitCents: 0,
      netContributionCents: 0,
    });
  }

  const orderWhere = params.creatorId
    ? and(
        gte(creatorOrders.createdAt, start),
        lt(creatorOrders.createdAt, end),
        eq(creatorOrders.creatorId, params.creatorId),
      )
    : and(gte(creatorOrders.createdAt, start), lt(creatorOrders.createdAt, end));

  const orderRows = await db
    .select({
      creatorId: creatorOrders.creatorId,
      orders: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${creatorOrders.grossCents}), 0)::int`,
      productProfitCents: sql<number>`coalesce(sum(${creatorOrders.productProfitCents}), 0)::int`,
    })
    .from(creatorOrders)
    .where(orderWhere)
    .groupBy(creatorOrders.creatorId);

  for (const row of orderRows) {
    const cur = out.get(row.creatorId) || {
      genCostCents: 0,
      orders: 0,
      grossCents: 0,
      productProfitCents: 0,
      netContributionCents: 0,
    };
    cur.orders = Number(row.orders) || 0;
    cur.grossCents = Number(row.grossCents) || 0;
    cur.productProfitCents = Number(row.productProfitCents) || 0;
    // Period formula: Product Profit − AI gen costs (not sum of per-order net,
    // which only allocates AI to orders that linked a job).
    cur.netContributionCents = cur.productProfitCents - cur.genCostCents;
    out.set(row.creatorId, cur);
  }

  // Creators with gen costs but no orders still need net = 0 - genCost.
  for (const [id, cur] of out) {
    if (cur.orders === 0) {
      cur.netContributionCents = cur.productProfitCents - cur.genCostCents;
      out.set(id, cur);
    }
  }

  return out;
}
