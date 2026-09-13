/**
 * Admin GraphQL publish can succeed while Ajax `/cart/add.js` still 422s
 * for 10–30s+ (storefront replica lag). Keep client + theme waits aligned.
 */
export const ATC_STOREFRONT_PROPAGATION_WAITS_MS = [
  1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 9000,
] as const;

/** Honest retry — the shadow is published in Admin; storefront has not caught up. */
export const ATC_SHADOW_STILL_PREPARING =
  "This design is still being prepared for the store. Keep this page open and tap Add to cart again in a moment.";
