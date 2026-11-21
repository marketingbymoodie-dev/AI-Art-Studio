import { describe, expect, it } from "vitest";
import {
  matchAppaiProfilesByName,
  replacementProfileKey,
  unconfirmedVariantIds,
} from "./shipping-profile-match";

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

  it("accepts a shared class key when the name carries the same provider", () => {
    const result = matchAppaiProfilesByName(
      [{ name: "AppAI · Shirts · provider 99", classKey: "share:99:shirt", key: "share:99:shirt:abc#all" }],
      [{ name: "AppAI · Shirts · provider 99", id: "gid://shopify/DeliveryProfile/9" }],
    );
    expect(result.ok).toBe(true);
  });
});

describe("unconfirmedVariantIds", () => {
  it("lists variants Shopify did not put on the new profile", () => {
    const missing = unconfirmedVariantIds(
      ["1", "2", "3"],
      [
        { id: "gid://shopify/ProductVariant/1", profileId: "gid://shopify/DeliveryProfile/9" },
        { id: "gid://shopify/ProductVariant/2", profileId: "gid://shopify/DeliveryProfile/4" },
        { id: null, profileId: null },
      ],
      "gid://shopify/DeliveryProfile/9",
    );
    expect(missing).toEqual(["2", "3"]);
  });
});

describe("replacementProfileKey", () => {
  const desired = [
    { profileKey: "share:99:shirt:abc#all", classKeys: ["145:99", "706:99"] },
    { profileKey: "1300:99#all", classKeys: ["1300:99"] },
  ];

  it("sends an old shirt profile to the shared shirt profile", () => {
    expect(replacementProfileKey("145:99#all", desired)).toBe("share:99:shirt:abc#all");
  });

  it("does not invent a destination for a profile that stayed on its own", () => {
    expect(replacementProfileKey("1300:99#all", desired)).toBeNull();
  });
});
