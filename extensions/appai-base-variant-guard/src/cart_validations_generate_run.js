// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/**
 * Blocks checkout of an AppAI base product (tag `ai-art-studio-enabled`) that
 * carries no design. Base products stay published so Branch C can add the
 * base variant and swap it for the design's shadow; every AppAI add path
 * stamps at least one of these line properties, including the legacy studio
 * hosted on the base product page (`_design_id`).
 *
 * Cart interaction is never blocked (Branch C's add must always land). Runtime
 * failures must not block checkout: the validation is created with
 * blockOnFailure=false.
 */
const DESIGN_KEYS = /** @type {const} */ (["jobId", "shadowDesignId", "designId"]);

const ENFORCED_STEPS = new Set(["CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION"]);

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const step = input.buyerJourney?.step;
  const errors = [];
  if (step && ENFORCED_STEPS.has(step)) {
    const blankLine = input.cart.lines.some((line) => {
      const merch = line.merchandise;
      if (merch.__typename !== "ProductVariant" || !merch.product.isAppaiBase) return false;
      return !DESIGN_KEYS.some((key) => String(line[key]?.value ?? "").trim() !== "");
    });
    if (blankLine) {
      errors.push({
        message: "An item in your cart needs a design. Remove it, or create your design and add it again.",
        target: "$.cart",
      });
    }
  }
  return { operations: [{ validationAdd: { errors } }] };
}
