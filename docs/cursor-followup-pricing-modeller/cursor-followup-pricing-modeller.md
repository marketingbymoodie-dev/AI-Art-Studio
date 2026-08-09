# Follow-up spec — Admin Pricing Modeller (Workstream B, interactive)

## Context
Workstream A (Profit Insights calculator) shipped but still reads the OLD plan numbers, because the price flip was correctly deferred. This spec replaces the "flip the numbers by hand" step with an **admin pricing modeller**: an interactive tool to *design* plan pricing from cost + margin, then **commit** a configuration as a new `pricingVersion`.

**Plan before building** (same as before): explore, confirm where this binds, flag mismatches. This extends the SSOT + `resolveOveragePriceUsd` + `pricingVersion` foundation already planned — do not create a parallel plan table.

## Core principle — model, don't live-edit
Plan definitions feed live Shopify billing (`appSubscriptionCreate`, `cappedAmount`, existing subscriptions). **Sliders must NOT write directly to the live plan table.** Instead:

- Sliders drive an **in-memory draft** configuration shown live as you drag.
- A distinct **"Commit as new pricing version"** action writes the draft to the SSOT as a new `pricingVersion` (e.g. `"2026-08"`).
- Live billing continues reading whatever version is marked active until an explicit **activate** step. Committing ≠ activating; activating a version is what changes what new subscriptions use.

This gives free iteration with a hard guardrail between "designing pricing" and "changing production billing."

## The modeller UI (admin/operator only)

For **each plan tier**, sliders/inputs:
- **Plan name** — editable text field (defaults: Trial, Starter, Dabbler, Pro, Pro Plus, **Mogul**). All names editable per draft.
- **Included generations** — slider.
- **Customizer pages** — slider (separate control).
- **Target margin over AI cost %** — slider. Drives price.
- **Overage cap (USD)** — slider or derived.

### Derived + displayed live per tier as sliders move
- **AI cost at full allowance** = `includedGens × $0.045`
- **Computed price** = `AIcost / (1 − marginOverCost%)` (price to hit the target margin over AI cost at FULL utilisation — the worst-case ceiling)
- **Margin over AI cost** (the target, echoed)
- **Realistic-utilisation margin (reference only)** = margin if the merchant uses an assumed % of the allowance (e.g. 40%) — **shown for context, NOT used to set price.** Price is always computed against full allowance (worst-case safe).
- **Per-generation economics:** cost/gen ($0.045), effective revenue/gen at this price, overage rate check.

### Labelling (important — avoid the original mistake)
- The margin control is **"Margin over AI cost"**, never just "Margin." It does NOT include Railway/Supabase/Stripe/support/infra. Make this explicit in the UI so a committed price isn't mistaken for true business margin.
- **Phase 2 (note in docs, don't build yet):** allow allocating a share of fixed monthly infra (~$65/mo floor: Railway $20, Supabase $25, misc $20) across projected subscribers to show *true* contribution margin. For now, over-AI-cost only, clearly labelled.

### Per-plan margins, not one global
Each tier has its **own** margin target — deliberately. This lets the operator shape the curve: e.g. lower margin on Starter (customer acquisition), higher on upper tiers (less price-sensitive). Holding a consistent margin across tiers also *fixes* the original margin-collapse problem automatically (higher plans price up to hold margin) — but per-plan control is required so the curve is intentional, not forced flat.

### Overage rate
- Global **overage rate (USD/gen)** input, default **$0.10**, wired through `resolveOveragePriceUsd(volume?)`.
- Leave the lookup tiered-ready (10c → 8c → 6c by volume) even if the modeller only sets a flat rate for now. **Add a test that a two-tier schedule threads through the emit path** (previously requested — confirm it exists).

## New top tier — "Mogul"
- Add a sixth tier. Default name **"Mogul"** (editable).
- Slot it in the modeller with sliders like the others; numbers are **placeholder until margin-sized** via the modeller itself — that's the point of the tool.
- Decide at commit time whether Mogul is self-serve in `PAID_PLANS` or "Contact us." Until margin-sized and committed, it can stay out of the live `PAID_PLANS` while existing in the modeller as a draft tier.

## Operator economics on the SAME surface
This admin surface is the correct home for the cost-side view that must NEVER appear in merchant UI:
- Per-tier: AI cost, computed price, margin over AI cost, realistic-utilisation margin.
- **Grants vs. burned** generations (the redeem-rate breakdown) and breakage margin.
- Blended margin across tiers; worst-case (100% utilisation) vs. realistic contribution.
Keep this operator-gated. None of it renders on the merchant Profit Insights calculator.

## Commit / activate flow
1. Operator adjusts sliders → live draft.
2. **Commit** → writes draft as a new `pricingVersion` row (name it, e.g. `2026-08`). No billing change yet.
3. **Activate** (separate, explicit) → new subscriptions use the active version's numbers + `cappedAmount`.
4. Existing Shopify subs keep their version's fee/cap until re-approval; `pricingVersion` on `shopifyInstallations` records which version each shop is on.
5. Test the re-subscribe / cap-change flow on staging before any production activation. Operator is their own first test shop.

## Wiring (reuse the SSOT foundation)
- Read/write plan definitions through the **shared SSOT** export (post-foundation). The modeller edits drafts; commit writes a version.
- `plan-picker.tsx`, the Profit Insights calculator, `OverageOptInForm`, and the estimator all read the **active version** — never a hard-coded copy. Confirm the earlier "delete hard-coded $0.08 / duplicated cards" cleanup is done so the modeller is genuinely the single lever.

## Out of scope (for now)
- Fixed-infra allocation in margin math (phase 2, labelled).
- Auto-activating a committed version (activation stays a deliberate manual step).
- Merchant-facing exposure of any operator economics.

## Deliverables
- Admin pricing modeller (sliders, live derived economics, editable names incl. Mogul).
- Commit-to-`pricingVersion` (no auto-activate).
- Operator economics panel on the same surface (grants-vs-burn, blended/worst-case margin).
- `docs/pricing-modeller.md`: the margin-over-cost formula, full-allowance basis (+ why realistic is reference-only), per-plan margin rationale, commit-vs-activate distinction, and the phase-2 fixed-cost allocation note.
- Test: two-tier overage schedule threads through emit; commit writes a version without touching active billing; activate changes only new-subscription numbers.
