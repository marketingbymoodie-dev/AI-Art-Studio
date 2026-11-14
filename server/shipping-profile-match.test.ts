import { describe, expect, it } from "vitest";
import { matchAppaiProfilesByName } from "./shipping-profile-match";

const desired = [
  { name: "AppAI · Tee — provider 99 · s", classKey: "145:99", key: "145:99#all" },
  { name: "AppAI · Hoodie — provider 99 · m", classKey: "77:99", key: "77:99#all" },
];
const live = [
  { name: desired[0].name, id: "gid://shopify/DeliveryProfile/1" },
  { name: desired[1].name, id: "gid://shopify/DeliveryProfile/2" },
];

describe("matchAppaiProfilesByName", () => {
  it("pairs each desired profile to the one Shopify profile with the same name", () => {
    const result = matchAppaiProfilesByName(desired, live);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairs.map((p) => [p.desired.key, p.live.id])).toEqual([
      ["145:99#all", "gid://shopify/DeliveryProfile/1"],
      ["77:99#all", "gid://shopify/DeliveryProfile/2"],
    ]);
  });

  it("refuses when a name is missing, duplicated, or the provider does not match", () => {
    expect(matchAppaiProfilesByName(desired, [live[0]]).ok).toBe(false);
    expect(matchAppaiProfilesByName(desired, [...live, live[0]]).ok).toBe(false);
    expect(
      matchAppaiProfilesByName(
        [{ name: "AppAI · Tee — provider 3 · s", classKey: "145:99", key: "145:99#all" }],
        [{ name: "AppAI · Tee — provider 3 · s", id: "x" }],
      ).ok,
    ).toBe(false);
  });
});
