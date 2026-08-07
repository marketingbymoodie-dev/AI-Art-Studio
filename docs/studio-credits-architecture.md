# Studio Credits — architecture (Phase 1)

## Big picture

A single wallet of **Studio Credits** per storefront customer. One credit = one AI
generation, regardless of how the customer got it. The customer always sees one
balance; the platform tracks the *bucket* it came from so we can bill correctly.

Two buckets today:

| Bucket   | How it is earned                          | Burns merchant quota at spend? | Wholesale bill?          |
|----------|-------------------------------------------|--------------------------------|--------------------------|
| `earned` | Reward Ladder rungs                       | **Yes** (comes off plan)       | No (merchant is the payer) |
| `pack`   | Merchant-mediated credit packs (Phase 2)  | No                             | Billed to merchant at grant time |

The customer's balance is the sum of the two buckets. Bucket accounting lives on
`credit_balances.earned_credits` / `pack_credits`; the authoritative total for
spend enforcement is `credit_balances.credits`.

## Tables

- **`customers`** — legacy row + display counters; keyed on `id` (UUID).
- **`customer_aliases`** — every storefront identity (Shopify customer id, OTP email, Google sub, anon session) resolves to one internal `customer_id`.
- **`credit_balances`** — materialized wallet. `credits` is the source of truth for spend checks; `earned_credits` + `pack_credits` are the bucket breakdown.
- **`credit_ledger`** — append-only audit + idempotency trail. Every mutation has a stable `idempotency_key`; `source` marks the bucket the delta hit.
- **`reward_ladder_rungs`** — per-shop rung configuration (`free_anonymous`, `email_signup`, `share_design`, `purchase_threshold`).
- **`reward_grants`** — one row per (`shop`, `customer_id`, `rung_key`); UNIQUE index protects against duplicate rung awards.
- **`shopify_installations.wholesale_credit_cents`** — Phase 2 clawback bank for pack refunds netted against future usage charges.

## Billing model at generation time

`server/generation-billing.ts::finalizeGenerationBilling` decides what to consume:

| `billingMode`   | Wallet effect                                              | Merchant quota  |
|-----------------|------------------------------------------------------------|-----------------|
| `merchant`      | none                                                       | consumed        |
| `customer_paid` | `spendStudioCredit` (earned first, then pack)              | earned → consumed; pack → skipped |
| `customer_free` | `consumeFreeGeneration` (increments `free_generations_used`) | consumed |
| `session`       | none (legacy anonymous fallback)                           | consumed        |

Anon visitors on the current storefront flow are now backed by a real
`customer_aliases`-linked `customers` row (`aliasType='anon_session'`), so free
gens live on the wallet and merge into the signed-in customer's wallet after
login via `linkAnonCustomerToSignedIn`.

## Reward Ladder (Phase 1)

Rungs are idempotent per customer:

- `email_signup` — granted after successful Google or OTP auth. Uses `normalizeEmail` (lowercase, strip `+tag`, collapse gmail dots) as the `relatedEntityId`; disposable domains are rejected.
- `share_design` — granted to the sharer (`shared_designs.owner_customer_id`) the first time a *different* visitor opens the share link.
- `purchase_threshold` — granted after `orders/paid` for orders that clear `thresholdCents`. Available by default; set `PURCHASE_REWARDS_ENABLED=false` to kill-switch. Refunds/cancels reverse the grant via `clawbackPurchaseThresholdForOrder`.
- `free_anonymous` — the storefront free-gen allowance (mirrors `installation.storefrontFreeGensPerVisitor`). Not granted through the ladder module; free gens are tracked on `credit_balances.freeGenerationsUsed`.

Grants are recorded via `server/reward-ladder.ts::grantRungIfEligible`, which
inserts a `reward_grants` row (uniqueness protects against duplicates) and then
calls `grantStudioCredits({ source: "earned" })`. The wallet ledger uses the
key `reward:<rung>:<shop>:<customer>[:<related>]` so retries never double-apply.

## Webhooks

Studio Credits touches four Shopify webhooks:

| Topic                | Handler                                     | Purpose |
|----------------------|---------------------------------------------|---------|
| `orders/paid`        | `/shopify/webhooks/orders-paid`             | purchase_threshold grant, design product sale recording, flat/mesh Printify fulfillment (gated) |
| `orders/cancelled`   | `/shopify/webhooks/orders-cancelled`        | Reward Ladder clawback |
| `refunds/create`     | `/shopify/webhooks/refunds-create`          | Reward Ladder clawback |
| `customers/redact`, `customers/data_request`, `shop/redact` | `server/shopify-gdpr.ts` | GDPR export/redact of ledger + reward grants |

All handlers require HMAC verification.

## Phases

- **Phase 0** — teardown Stripe / manual pack purchase paths. **Done.**
- **Phase 1** — buckets + Reward Ladder rungs (email_signup, share_design, purchase_threshold behind flag); anon wallet unification; refund clawback stub. **This document.**
- **Phase 2** — merchant-mediated credit packs (`source: "pack"`), wholesale billing at grant, refund netting into `shopify_installations.wholesale_credit_cents`.

## Key files

- `server/studio-credits.ts` — `grantStudioCredits`, `spendStudioCredit`, `clawbackStudioCredits`.
- `server/reward-ladder.ts` — rung config + idempotent grants + purchase clawback.
- `server/generation-billing.ts` — orchestrates wallet vs. plan quota per billing mode.
- `server/storage.ts` — `mergeCustomerWallets`, `linkAnonCustomerToSignedIn`, `resolveOrCreateCustomerAlias`.
- `server/routes.ts` — auth + share + orders webhooks; admin Reward Ladder API.
- `shared/schema.ts` — `credit_balances`, `credit_ledger`, `reward_ladder_rungs`, `reward_grants`, `shared_designs.ownerCustomerId`.
