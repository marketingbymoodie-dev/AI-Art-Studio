/**
 * AOP cart uses local front/back composites, not Printify lifestyle shots.
 * A timed-out / failed Printify mockup must not re-stale the ATC button.
 */

export function shouldKeepAopCartReadyOnPrintifyFailure(opts: {
  useAopCustomizer: boolean;
  hasLocalFrontComposite: boolean;
}): boolean {
  return !!(opts.useAopCustomizer && opts.hasLocalFrontComposite);
}

export function hasLocalAopFrontComposite(opts: {
  aopPatternUrl?: string | null;
  baseMockups?: Array<{ url?: string | null }> | null;
}): boolean {
  if (typeof opts.aopPatternUrl === "string" && opts.aopPatternUrl.length > 0) {
    return true;
  }
  return !!opts.baseMockups?.some((img) => typeof img.url === "string" && img.url.length > 0);
}

/** Non-blocking copy for mobile chrome (and desktop strip) — never raw AbortError. */
export function aopLifestyleMockupNotice(opts: {
  pending: boolean;
  error: string | null;
}): string | null {
  if (opts.error) {
    return "Lifestyle preview unavailable — cart uses your design.";
  }
  if (opts.pending) {
    return "Lifestyle preview still generating — you can add to cart.";
  }
  return null;
}
