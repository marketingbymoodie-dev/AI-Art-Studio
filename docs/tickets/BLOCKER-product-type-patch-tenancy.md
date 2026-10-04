# BLOCKER — `PATCH /api/admin/product-types/:id` has no merchant ownership check

**Severity:** launch blocker (cross-tenant write). Same class as the fulfilment isolation gap fixed in `ef877191`.
**Status:** open. Not fixed in the 0c work; 0c only added two more operator-only fields to the existing deny-list.

## What's wrong

`server/routes.ts` (`app.patch("/api/admin/product-types/:id", isAuthenticated, …)`):

1. **No ownership check.** It never loads the product type or compares `merchantId` to the caller. Any signed-in merchant can PATCH any product type id. Ids are sequential integers, so they can be enumerated.
2. **Mass assignment.** `req.body` goes straight into `storage.updateProductType(id, updates)`, which does `.set({ ...updates })`. The only filter is `OPERATOR_ONLY_PRODUCT_TYPE_FIELDS`, which is a **deny-list** of 10 calibration fields. Everything else on the row is writable, including:
   - `merchantId`: lets a merchant pull another merchant's product type into their own account, or push theirs onto someone else.
   - `shopifyProductId`, `shopifyVariantIds`, `variantPrices*`, `baseCost*`, `printifyBlueprintId` / provider: corrupts another shop's live product, its ATC variant mapping, and its fulfilment costs.
   - `id`, `createdAt`: whatever Drizzle accepts.

The sibling routes already do this correctly: `DELETE /api/admin/product-types/:id` and `POST …/:id/refresh-description` load the row and call `adminProductTypeAccessError(req, productType, merchant)`.

## Fix (small)

1. Resolve the merchant (`getMerchantByUserId`), load the product type, and call `adminProductTypeAccessError`. Return 404 or 403 exactly like DELETE does. Platform admins keep their existing bypass inside that helper.
2. Replace the deny-list with an **allow-list** of fields a merchant may edit (name / description / sizes / frameColors / display fields that the admin UI actually sends). Always strip `id`, `merchantId`, `createdAt` and `updatedAt`, even for platform admins. Keep `OPERATOR_ONLY_PRODUCT_TYPE_FIELDS` for the operator-only subset.
3. Tests: merchant A cannot PATCH merchant B's type (403/404, row unchanged); `merchantId` in the body is ignored; platform admin can still edit the operator fields.

To build the allow-list, grep the client for `apiRequest("PATCH", \`/api/admin/product-types/${…}\``. Today that's `customizer-pages.tsx`, `create-product.tsx` and `platform-catalog.tsx`.

## Also check while here

- `PATCH /api/admin/product-types/:id/variants` (~16843): confirm it calls `adminProductTypeAccessError` before writing.
- `GET/POST /api/product-types*` (3 routes, no `/admin`): confirm what's public and what's scoped.

## Verification

Run the Branch-C tenancy harness pattern from the fulfilment fix on staging, with two merchants on the demo partner org. A cross-merchant PATCH must not change the row.
