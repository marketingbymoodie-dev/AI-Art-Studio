import {
  formatUsdCents,
  sizeTokensMatch,
  type ShipsToSize,
} from "@shared/shipping-size-coverage";
import { shipCountryName } from "@shared/ship-country";
import { Button } from "@/components/ui/button";
import { ShipCountrySelector } from "@/components/creators/ShipCountrySelector";

export function sizeLabelForCoverage(
  sizeId: string,
  catalog: Array<{ id: string; name: string }>,
): string {
  const hit = catalog.find(
    (s) => s.id === sizeId || sizeTokensMatch(s.id, sizeId) || sizeTokensMatch(s.name, sizeId),
  );
  return hit?.name || sizeId.replace(/-x-/gi, "×");
}

export function ShippingSizeDownsell({
  country,
  requestedSizeId,
  requestedSizeLabel,
  shipsToSizes,
  suggestedSizeId,
  catalogSizes,
  onSwitchSize,
}: {
  country: string;
  requestedSizeId: string;
  requestedSizeLabel?: string;
  shipsToSizes: ShipsToSize[];
  suggestedSizeId?: string | null;
  catalogSizes: Array<{ id: string; name: string }>;
  onSwitchSize: (sizeId: string) => void;
}) {
  const countryName = shipCountryName(country);
  const sizeLabel = requestedSizeLabel || sizeLabelForCoverage(requestedSizeId, catalogSizes);
  const primaryId = suggestedSizeId || shipsToSizes[0]?.sizeId || null;

  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2.5"
      data-testid="shipping-size-downsell"
    >
      <p className="text-sm font-medium text-amber-950">
        This size doesn&apos;t ship to {countryName}; these do
      </p>
      <p className="text-xs text-amber-900">
        {sizeLabel} can&apos;t be fulfilled in {countryName}. Switch size to keep your artwork,
        or change country.
      </p>
      {shipsToSizes.length > 0 ? (
        <ul className="space-y-1" data-testid="shipping-downsell-sizes">
          {shipsToSizes.map((s) => (
            <li key={s.sizeId}>
              <button
                type="button"
                className="w-full text-left text-sm rounded-md border border-amber-200 bg-white px-2.5 py-1.5 hover:bg-amber-100"
                data-testid={`shipping-downsell-size-${s.sizeId}`}
                onClick={() => onSwitchSize(s.sizeId)}
              >
                <span className="font-medium">{sizeLabelForCoverage(s.sizeId, catalogSizes)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {s.tier}
                  {s.firstItemCents != null ? ` · ${formatUsdCents(s.firstItemCents)} shipping` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-amber-950" data-testid="shipping-downsell-empty">
          Nothing in this product ships to {countryName}. Change your shipping country to continue.
        </p>
      )}
      {primaryId ? (
        <Button
          type="button"
          className="w-full bg-black text-white hover:bg-black/90"
          data-testid="shipping-downsell-switch"
          onClick={() => onSwitchSize(primaryId)}
        >
          Switch size
        </Button>
      ) : null}
      <div className="pt-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-amber-900 mb-1">
          Change country
        </p>
        <ShipCountrySelector compact />
      </div>
    </div>
  );
}

export function ShippingWarnedEstimate({
  country,
  firstItemCents,
  matchedZone,
}: {
  country: string;
  firstItemCents: number | null;
  matchedZone?: string | null;
}) {
  const countryName = shipCountryName(country);
  const amount = formatUsdCents(firstItemCents);
  return (
    <div
      className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      data-testid="shipping-warned-estimate"
    >
      <span className="inline-flex items-center rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-950">
        Warned
      </span>
      <p className="mt-1 text-sm text-amber-950">
        {amount
          ? `International shipping to ${countryName} from ${amount}`
          : `International shipping to ${countryName} may cost more`}
        {matchedZone === "ROW" ? " (rest of world rate)" : ""}
      </p>
    </div>
  );
}
