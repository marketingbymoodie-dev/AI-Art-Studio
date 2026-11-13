/**
 * The "+" label is the presentment custom price minus the presentment
 * catalogue price. Both prices are converted from shop currency with the
 * market rate and then rounded, so the label matches the cart instead of
 * converting the surcharge on its own.
 */
export function presentmentCents(shopCents: number, rate: number): number {
  const r = rate > 0 ? rate : 1;
  return Math.round(shopCents * r);
}

/** Shop cents that Markets would have converted into this presentment amount. */
export function shopCentsMatchingPresentment(presentment: number, rate: number): number {
  const r = rate > 0 ? rate : 1;
  if (Math.abs(r - 1) < 1e-9) return presentment;
  const guess = Math.round(presentment / r);
  for (let cents = guess - 4; cents <= guess + 4; cents++) {
    if (cents > 0 && Math.round(cents * r) === presentment) return cents;
  }
  return guess;
}

export function myPetPlusCents(
  cataloguePresentmentCents: number,
  surchargeShopCents: number,
  rate: number,
): number {
  const extra = Math.round(surchargeShopCents || 0);
  if (extra <= 0) return 0;
  const shop = shopCentsMatchingPresentment(cataloguePresentmentCents, rate);
  return presentmentCents(shop + extra, rate) - cataloguePresentmentCents;
}
