import { describe, expect, it, vi } from "vitest";

const grant = vi.fn(async () => ({ granted: true, duplicate: false, amount: 1 }));
vi.mock("./db", () => ({ db: {}, pool: {} }));
vi.mock("./studio-credits", () => ({ grantStudioCredits: grant, clawbackStudioCredits: vi.fn() }));
vi.mock("./storage", () => ({ storage: {} }));

const { tryGrantShareDesign } = await import("./reward-ladder");

describe("share_design grant: owner can't earn from their own visit", () => {
  const base = { shop: "ai-art-studio-staging.myshopify.com", ownerCustomerId: "alice", shareId: "share-1" };
  it("owner as the verified viewer → refused before any grant", async () => {
    expect(await tryGrantShareDesign({ ...base, visitorCustomerId: "alice", visitorKey: null })).toMatchObject({ granted: false, reason: "visitor is owner" });
  });
  it("no verified viewer → refused", async () => {
    expect(await tryGrantShareDesign({ ...base, visitorCustomerId: null, visitorKey: null })).toMatchObject({ granted: false, reason: "no visitor identity" });
    expect(grant).not.toHaveBeenCalled();
  });
});
