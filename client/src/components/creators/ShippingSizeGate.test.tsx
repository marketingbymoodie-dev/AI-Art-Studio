import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildSizeDownsell,
  filterCatalogSizesForCountry,
  findSizeCoverageRow,
  formatUsdCents,
  listSizeCoverageFromMatrix,
  type SizeColorMapping,
  type SizeCoverageRate,
} from "@shared/shipping-size-coverage";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ShippingSizeDownsell, ShippingWarnedEstimate } from "./ShippingSizeGate";

type Fixture493 = {
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
};
type Fixture540 = {
  rates: Array<{
    zone: string;
    group: string;
    first: number;
    additional: number;
    tier: string;
    shippable: boolean;
  }>;
};

function loadJson<T>(slug: string): T {
  return JSON.parse(
    readFileSync(
      path.join(__dirname, "../../../../shared/__fixtures__/shipping", `${slug}.json`),
      "utf8",
    ),
  ) as T;
}

const framedH = loadJson<Fixture493>("framed-horizontal-493-36");
const framedV = loadJson<Fixture540>("framed-vertical-540-99");
const framedVMappings: SizeColorMapping[] = [
  { sizeColorKey: "11-x-14:black", variantGroup: "g1" },
  { sizeColorKey: "12-x-16:black", variantGroup: "g2" },
  { sizeColorKey: "16-x-16:black", variantGroup: "g2" },
  { sizeColorKey: "16-x-20:black", variantGroup: "g3" },
  { sizeColorKey: "12-x-36:black", variantGroup: "g4" },
  { sizeColorKey: "20-x-30:black", variantGroup: "g4" },
];
const framedVRates: SizeCoverageRate[] = framedV.rates.map((r) => ({
  countryCode: r.zone,
  variantGroup: r.group,
  firstItemCents: r.first,
  additionalCents: r.additional,
  shippable: r.shippable,
  tier: r.tier,
}));

const catalog540 = [
  { id: "11-x-14", name: "11×14" },
  { id: "12-x-16", name: "12×16" },
  { id: "16-x-16", name: "16×16" },
  { id: "16-x-20", name: "16×20" },
  { id: "12-x-36", name: "12×36" },
  { id: "20-x-30", name: "20×30" },
];

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["/api/storefront/ship-country"], {
    shipCountry: "AU",
    source: "cookie",
    options: [{ code: "AU", name: "Australia" }],
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("Slice C creator customizer surfaces", () => {
  it("AU dropdown on 540 is missing g4 sizes", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedVMappings,
      rates: framedVRates,
      country: "AU",
    });
    const visible = filterCatalogSizesForCountry(catalog540, rows);
    expect(visible.map((s) => s.name)).toEqual(["11×14", "12×16", "16×16", "16×20"]);
    expect(visible.map((s) => s.id)).not.toContain("12-x-36");
    expect(visible.map((s) => s.id)).not.toContain("20-x-30");
  });

  it("deep-linked g4 URL renders the downsell, not a dead end", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedVMappings,
      rates: framedVRates,
      country: "AU",
    });
    const downsell = buildSizeDownsell({
      requestedSizeId: "20-x-30",
      country: "AU",
      rows,
    });
    expect(downsell).not.toBeNull();
    render(
      wrap(
        <ShippingSizeDownsell
          country="AU"
          requestedSizeId={downsell!.requestedSizeId}
          shipsToSizes={downsell!.shipsToSizes}
          suggestedSizeId={downsell!.suggestedSizeId}
          catalogSizes={catalog540}
          onSwitchSize={() => {}}
        />,
      ),
    );
    expect(screen.getByTestId("shipping-size-downsell").textContent).toContain(
      "This size doesn't ship to Australia; these do",
    );
    expect(screen.getByTestId("shipping-downsell-switch")).toBeTruthy();
    expect(screen.queryByTestId("shipping-downsell-size-20-x-30")).toBeNull();
    expect(screen.getByTestId("shipping-downsell-sizes").textContent).toMatch(/11×14/);
  });

  it("11×8 → AU renders the ROW $49.99 warned estimate", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedH.mappings,
      rates: framedH.rates,
      country: "AU",
    });
    const row = findSizeCoverageRow("11-x-8", rows);
    expect(row?.tier).toBe("warned");
    expect(formatUsdCents(row?.firstItemCents)).toBe("$49.99");
    render(
      wrap(
        <ShippingWarnedEstimate
          country="AU"
          firstItemCents={row!.firstItemCents}
          matchedZone={row!.matchedZone}
        />,
      ),
    );
    const el = screen.getByTestId("shipping-warned-estimate");
    expect(el.textContent).toContain("Warned");
    expect(el.textContent).toContain("International shipping to Australia from $49.99");
    expect(el.textContent).toContain("rest of world rate");
  });
});
