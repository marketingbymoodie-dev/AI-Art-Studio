import { describe, expect, it } from "vitest";
import {
  applicationStatusForCreatorStatus,
  canCreatorAccessPortal,
  clampFreeGensPerCustomer,
  clampMonthlyGenerationAllowance,
  computeCreatorOrderPnl,
  computeCreatorRanks,
  computeTransactionFeeCents,
  creatorPublicName,
  extractSubdomainFromHost,
  extractUsernameFromPath,
  creatorStorefrontHomeUrl,
  findConflictingHandle,
  isSafeCreatorReturnUrl,
  sanitizeCreatorReturnUrl,
  isoWeekPeriodKey,
  isNumberedHandleVariant,
  mergeCreatorBranding,
  normalizeCreatorUsername,
  sanitizeCreatorShopName,
  shopNameToHandle,
  isApplyShopNameAllowed,
  sanitizeApplyShopNameInput,
  parseCreatorHeadingFontId,
  parseCreatorSocials,
  resolveCreatorHeadingFont,
  sanitizeCreatorBio,
  sanitizeCreatorImageUrl,
  formatSocialHandle,
  normalizeSocialHandle,
  socialProfileUrl,
  stripLeadingAtSigns,
  titleForRank,
} from "./creatorMarketplace";

describe("normalizeCreatorUsername", () => {
  it("normalizes and accepts valid handles", () => {
    expect(normalizeCreatorUsername("MaxPets")).toBe("maxpets");
    expect(normalizeCreatorUsername("skate-king")).toBe("skate-king");
  });

  it("rejects reserved and invalid names", () => {
    expect(normalizeCreatorUsername("www")).toBeNull();
    expect(normalizeCreatorUsername("a")).toBeNull();
    expect(normalizeCreatorUsername("admin")).toBeNull();
    expect(normalizeCreatorUsername("checkout")).toBeNull();
    expect(normalizeCreatorUsername("shop")).toBeNull();
    expect(normalizeCreatorUsername("")).toBeNull();
    // Leading/trailing hyphens are stripped → valid "bad"
    expect(normalizeCreatorUsername("-bad-")).toBe("bad");
  });
});

describe("shop name → handle", () => {
  it("slugs the shop name, not a personal name", () => {
    expect(shopNameToHandle("Mad Clown Core")).toBe("mad-clown-core");
    expect(shopNameToHandle("Max's Pets")).toBe("maxs-pets");
    expect(sanitizeCreatorShopName("  Mad   Clown Core  ")).toBe("Mad Clown Core");
  });

  it("apply shop names allow letters and spaces only", () => {
    expect(isApplyShopNameAllowed("Mad Clown Core")).toBe(true);
    expect(isApplyShopNameAllowed("Max's Pets")).toBe(false);
    expect(isApplyShopNameAllowed("Shop 2")).toBe(false);
    expect(isApplyShopNameAllowed("www")).toBe(false);
    expect(isApplyShopNameAllowed("Checkout")).toBe(false);
    expect(sanitizeApplyShopNameInput("Mad Clown 2!")).toBe("Mad Clown ");
  });

  it("flags exact and numbered-suffix duplicates", () => {
    expect(isNumberedHandleVariant("max-2", "max")).toBe(true);
    expect(isNumberedHandleVariant("max2", "max")).toBe(true);
    expect(isNumberedHandleVariant("max-studio", "max")).toBe(false);
    expect(findConflictingHandle("Mad Clown Core", ["mad-clown-core"])).toBe("mad-clown-core");
    expect(findConflictingHandle("mad-clown-core-2", ["mad-clown-core"])).toBe("mad-clown-core");
    expect(findConflictingHandle("Mad Clown Studio", ["mad-clown-core"])).toBeNull();
  });
});

describe("creator return URL", () => {
  it("allows app hosts and rejects strangers", () => {
    expect(isSafeCreatorReturnUrl("https://aiartstudio.app/c/max")).toBe(true);
    expect(isSafeCreatorReturnUrl("https://max.aiartstudio.app/")).toBe(true);
    expect(isSafeCreatorReturnUrl("https://evil.com/c/max")).toBe(false);
    expect(isSafeCreatorReturnUrl("javascript:alert(1)")).toBe(false);
  });

  it("prefers the live subdomain when the shopper is already on it", () => {
    expect(
      creatorStorefrontHomeUrl({
        username: "max",
        origin: "https://max.aiartstudio.app",
        hostname: "max.aiartstudio.app",
      }),
    ).toBe("https://max.aiartstudio.app/");
    expect(
      creatorStorefrontHomeUrl({
        username: "max",
        origin: "https://aiartstudio.app",
        hostname: "aiartstudio.app",
      }),
    ).toBe("https://aiartstudio.app/c/max");
    expect(
      creatorStorefrontHomeUrl({
        username: "max",
        origin: "https://max.staging.aiartstudio.app",
        hostname: "max.staging.aiartstudio.app",
      }),
    ).toBe("https://max.staging.aiartstudio.app/");
  });

  it("falls back when the client sends a bad URL", () => {
    expect(
      sanitizeCreatorReturnUrl("https://phish.test", "https://aiartstudio.app/c/max"),
    ).toBe("https://aiartstudio.app/c/max");
  });
});

describe("social handles", () => {
  it("strips every leading @ and rejects leftover @", () => {
    expect(stripLeadingAtSigns("@@bigmeltingpod")).toBe("bigmeltingpod");
    expect(normalizeSocialHandle("@@bigmeltingpod")).toBe("bigmeltingpod");
    expect(normalizeSocialHandle("@bigmeltingpod")).toBe("bigmeltingpod");
    expect(normalizeSocialHandle("bigmeltingpod")).toBe("bigmeltingpod");
    expect(normalizeSocialHandle("name@extra")).toBeNull();
    expect(formatSocialHandle("@@bigmeltingpod")).toBe("@bigmeltingpod");
  });

  it("extracts the handle from a profile URL", () => {
    expect(normalizeSocialHandle("https://instagram.com/@bigmeltingpod")).toBe("bigmeltingpod");
    expect(normalizeSocialHandle("https://www.tiktok.com/@bigmeltingpod")).toBe("bigmeltingpod");
    expect(socialProfileUrl("instagram", "@@bigmeltingpod")).toBe(
      "https://www.instagram.com/bigmeltingpod",
    );
  });

  it("keeps at most four unique socials and falls back to the legacy handle", () => {
    expect(
      parseCreatorSocials(null, { platform: "instagram", username: "@@bigmeltingpod" }),
    ).toEqual([
      {
        platform: "instagram",
        username: "bigmeltingpod",
        url: "https://www.instagram.com/bigmeltingpod",
      },
    ]);
    const many = parseCreatorSocials([
      { platform: "instagram", username: "@one" },
      { platform: "tiktok", username: "two" },
      { platform: "youtube", username: "three" },
      { platform: "x", username: "four" },
      { platform: "twitch", username: "five" },
    ]);
    expect(many).toHaveLength(4);
    expect(many.map((s) => s.username)).toEqual(["one", "two", "three", "four"]);
  });
});

describe("quota clamps", () => {
  it("clamps free gens 0–10", () => {
    expect(clampFreeGensPerCustomer(2)).toBe(2);
    expect(clampFreeGensPerCustomer(99)).toBe(10);
    expect(clampFreeGensPerCustomer(-1)).toBe(0);
  });

  it("clamps monthly allowance", () => {
    expect(clampMonthlyGenerationAllowance(250)).toBe(250);
    expect(clampMonthlyGenerationAllowance(-5)).toBe(0);
  });
});

describe("host / path resolution", () => {
  it("parses creator subdomains", () => {
    expect(extractSubdomainFromHost("max.aiartstudio.app")).toBe("max");
    expect(extractSubdomainFromHost("max.staging.aiartstudio.app")).toBe("max");
    expect(extractSubdomainFromHost("aiartstudio.app")).toBeNull();
    expect(extractSubdomainFromHost("staging.aiartstudio.app")).toBe("staging");
    expect(extractSubdomainFromHost("ai-art-studio-staging.up.railway.app")).toBeNull();
  });

  it("parses /c/:username paths", () => {
    expect(extractUsernameFromPath("/c/max")).toBe("max");
    expect(extractUsernameFromPath("/c/skate-king/products")).toBe("skate-king");
  });
});

describe("public storefront identity", () => {
  it("uses shop handle, never the legal name", () => {
    expect(
      creatorPublicName({
        username: "mad-clown-core",
        branding: { headline: "Mad Clown Core" },
      }),
    ).toBe("Mad Clown Core");
    expect(creatorPublicName({ username: "mad-clown-core", branding: {} })).toBe(
      "mad-clown-core",
    );
    expect(creatorPublicName({ username: "mad-clown-core", branding: null })).toBe(
      "mad-clown-core",
    );
    expect(
      creatorPublicName({
        username: "bigmeltingpod",
        branding: JSON.stringify({ headline: "Mad Clown Core" }),
      }),
    ).toBe("Mad Clown Core");
  });

  it("sanitizes profile image URLs", () => {
    expect(sanitizeCreatorImageUrl("/objects/uploads/avatar.png")).toBe(
      "/objects/uploads/avatar.png",
    );
    expect(sanitizeCreatorImageUrl("https://cdn.example.com/bg.jpg")).toBe(
      "https://cdn.example.com/bg.jpg",
    );
    expect(sanitizeCreatorImageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeCreatorImageUrl("/objects/../secret")).toBeNull();
    expect(sanitizeCreatorBio("  Hello world  ")).toBe("Hello world");
    expect(sanitizeCreatorBio("   ")).toBeNull();
  });

  it("merges branding without leaking empty keys", () => {
    const next = mergeCreatorBranding(
      { headline: "Old", accentColor: "#111" },
      {
        shopName: "Mad Clown Core",
        shopDescription: "streetwear",
        backgroundImageUrl: "/objects/uploads/bg.png",
      },
    );
    expect(next.headline).toBe("Mad Clown Core");
    expect(next.description).toBe("streetwear");
    expect(next.backgroundImageUrl).toBe("/objects/uploads/bg.png");
    expect(next.accentColor).toBe("#111");

    const cleared = mergeCreatorBranding(next, {
      shopName: "",
      backgroundImageUrl: "",
    });
    expect(cleared.headline).toBeUndefined();
    expect(cleared.backgroundImageUrl).toBeUndefined();
    expect(cleared.description).toBe("streetwear");
  });

  it("stores a heading font and clears default", () => {
    const next = mergeCreatorBranding({ headline: "Mad Clown Core" }, { headingFont: "impact" });
    expect(next.headingFont).toBe("impact");
    expect(parseCreatorHeadingFontId("impact")).toBe("impact");
    expect(resolveCreatorHeadingFont(next).cssFamily).toMatch(/Anton/);
    const cleared = mergeCreatorBranding(next, { headingFont: "default" });
    expect(cleared.headingFont).toBeUndefined();
    expect(parseCreatorHeadingFontId("comic-sans")).toBe("default");
  });
});

describe("application status from creator", () => {
  it("promotes waitlisted/review applications once the creator is live", () => {
    expect(applicationStatusForCreatorStatus("active_beta")).toBe("accepted");
    expect(applicationStatusForCreatorStatus("onboarding")).toBe("accepted");
    expect(applicationStatusForCreatorStatus("partner")).toBe("accepted");
    expect(applicationStatusForCreatorStatus("paused")).toBe("accepted");
    expect(applicationStatusForCreatorStatus("waitlisted")).toBe("waitlisted");
    expect(applicationStatusForCreatorStatus("rejected")).toBe("rejected");
  });
});

describe("portal login statuses", () => {
  it("allows active creators and blocks suspended", () => {
    expect(canCreatorAccessPortal("active_beta")).toBe(true);
    expect(canCreatorAccessPortal("onboarding")).toBe(true);
    expect(canCreatorAccessPortal("suspended")).toBe(false);
    expect(canCreatorAccessPortal("application")).toBe(false);
  });
});

describe("Phase 7 rankings", () => {
  it("ranks by net contribution with ties and share pct", () => {
    const ranks = computeCreatorRanks(
      [
        { creatorId: "a", valueCents: 4250 },
        { creatorId: "b", valueCents: 1000 },
        { creatorId: "c", valueCents: 4250 },
      ],
      "monthly",
    );
    expect(ranks).toHaveLength(3);
    expect(ranks.filter((r) => r.rank === 1)).toHaveLength(2);
    expect(ranks.find((r) => r.creatorId === "b")?.rank).toBe(3);
    expect(ranks.find((r) => r.creatorId === "a")?.sharePct).toBeCloseTo(44.7368, 3);
    expect(titleForRank(1, 43, "monthly")).toBe("Monthly Top Creator");
  });

  it("formats ISO week keys", () => {
    expect(isoWeekPeriodKey(new Date("2026-08-12T12:00:00Z"))).toMatch(/^2026-W\d{2}$/);
  });
});

describe("Phase 5 P&L math", () => {
  it("computes Shopify-style transaction fees", () => {
    // 2.9% of $100 + 30¢ = $2.90 + $0.30
    expect(computeTransactionFeeCents({ amountCents: 10000 })).toBe(320);
    expect(computeTransactionFeeCents({ amountCents: 0 })).toBe(0);
    expect(
      computeTransactionFeeCents({ amountCents: 10000, feePct: 0, feeFixedCents: 0 }),
    ).toBe(0);
  });

  it("matches the plan example ($100 gross − $50 COGS − $3 txn − $4.50 AI)", () => {
    const fee = computeTransactionFeeCents({
      amountCents: 10000,
      feePct: 2.7,
      feeFixedCents: 30,
    }); // 270 + 30 = 300
    expect(fee).toBe(300);
    const pnl = computeCreatorOrderPnl({
      grossCents: 10000,
      discountCents: 0,
      fulfilmentCostCents: 5000,
      transactionFeeCents: fee,
      aiGenCostCents: 450,
      shareBasis: "net_contribution",
      revenueShareCreatorPct: 100,
      revenueShareAasPct: 0,
    });
    expect(pnl.productProfitCents).toBe(4700);
    expect(pnl.netContributionCents).toBe(4250);
    expect(pnl.creatorShareCents).toBe(4250);
    expect(pnl.aasShareCents).toBe(0);
  });

  it("applies refunds and share basis product_profit", () => {
    const pnl = computeCreatorOrderPnl({
      grossCents: 10000,
      discountCents: 500,
      fulfilmentCostCents: 4000,
      transactionFeeCents: 300,
      aiGenCostCents: 200,
      refundCents: 2000,
      shareBasis: "product_profit",
      revenueShareCreatorPct: 80,
      revenueShareAasPct: 20,
    });
    // 10000 - 500 - 4000 - 300 - 2000 = 3200 product profit
    expect(pnl.productProfitCents).toBe(3200);
    expect(pnl.netContributionCents).toBe(3000);
    expect(pnl.creatorShareCents).toBe(2560);
    expect(pnl.aasShareCents).toBe(640);
  });
});
