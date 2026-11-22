# Follow-up: replace the `generationModel: "gpt-image-2"` capability marker

**Status:** open (technical debt, introduced knowingly in the provider-layer migration, 2026-10).

## Problem
`style_presets.generation_model = "gpt-image-2"` is doing two jobs:
1. naming a model (legacy Replicate `openai/gpt-image-2` path), and
2. acting as a **capability flag** — `resolveStyleGeneration` derives `nativeTransparent` from it, which drives prompt compose (no chroma plate), `saveImageToStorage` `skipChroma`, and the storefront data-URL fallback.

Since the provider layer (`server/generation-providers.ts`), the actual renderer is chosen by `resolveGenerationPlan` (e.g. Petposterous apparel → `gpt-image-2.5-flare` via direct OpenAI). Routes force `nativeTransparent: true` for any direct plan, so the marker is no longer used for routing — but it still exists on rows and in public style payloads (`/api/config`, customizer-page `generationModel`).

## Do
- Add an explicit capability field (e.g. `output_capability: "native_transparent" | "chroma_plate" | "full_bleed"`) on styles, resolved per product.
- Derive `nativeTransparent` / `skipChroma` from capability + `GenerationPlan`, never from a model name.
- Stop sending model identifiers in public style payloads (client only needs the capability).
- Migrate Petposterous rows; keep `generation_model` read-only for legacy Replicate merchants until they migrate.

## Do not
- Use `generationModel` for any new provider/renderer routing.
