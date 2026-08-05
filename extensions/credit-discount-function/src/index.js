// Shopify Discount Function: apply the flat AI Art Studio entitlement stored on the
// Shopify customer metafield. The DB/webhooks remain source of truth; this
// function only reads the synced metafield at checkout.
export function run(input) {
  const metafield = input.cart.buyerIdentity?.customer?.metafield;
  const entitlementCents = Number.parseInt(metafield?.value || "0", 10);
  if (!Number.isFinite(entitlementCents) || entitlementCents <= 0) {
    return { operations: [] };
  }

  const subtotalCents = Math.round(Number.parseFloat(input.cart.cost.subtotalAmount.amount || "0") * 100);
  // Cap matches CREDIT_ENTITLEMENT_MAX_CENTS ($3) in shared/storefront-credits.ts
  const discountCents = Math.min(300, entitlementCents, subtotalCents);
  if (discountCents <= 0) {
    return { operations: [] };
  }

  const dollars = (discountCents / 100).toFixed(2).replace(/\.00$/, "");
  return {
    operations: [
      {
        orderDiscountsAdd: {
          candidates: [
            {
              message: `AI Art Studio credit — $${dollars} off`,
              targets: [{ orderSubtotal: { excludedCartLineIds: [] } }],
              value: {
                fixedAmount: {
                  amount: (discountCents / 100).toFixed(2),
                  appliesToEachItem: false,
                },
              },
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
