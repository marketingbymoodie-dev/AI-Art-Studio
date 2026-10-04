# Petposterous apparel art styles V2

**Product:** AI Art Studio / Petposterous · **staging only, never production**
**Status:** art-style layer is on staging behind the render probe. Not in the customer picker. Do not reduce the ten styles to six from theory.

Short form is the art-style prompt. The blocks, the object budget, the type restraint, and the funny-truth concept are in `docs/art-styles-v2-short-form.md`. Do not wrap that compose in `packLayersForCompose` or put the camera shot back into the concept. Conceptual Graphic still drawing the whole car interior was the concept overriding the style — the same failure as PRODUCT AUTHORITY, in the concept layer. Long-form probe rows stay stored for comparison.

## Graduation hazard — composition locks

The composition locks were removed from the **art-style path only**. The existing six-look apparel path still has them, including PRODUCT AUTHORITY.

`composePetposterousArtStylePrompt` sets `styleOwnsComposition` and does not use `packLayersForCompose`. The customer picker does. Storefront and admin generation still call `packLayersForCompose` (`server/pack-generation.ts`), which for a Petposterous look appends the apparel product renderer and:

> PRODUCT AUTHORITY: the product renderer overrides any framework or look instruction about composition, background, scale and edges.

That renderer is still the compact chest-print vignette. The locked transparent apparel base still says isolated centered graphic, isolated motif, no background scene, clean crisp edges, and for screen printing. The profile apparel extra still says compact garment-friendly composition.

**When these styles graduate into the customer picker, that path needs the same treatment.** Wiring the ten styles through `packLayersForCompose` unchanged will collapse them back to identical output in production: one pose, one framing, palette and type moving on top.

Do not strip PRODUCT AUTHORITY off the six-look path until those looks are meant to give up composition. The art-style path must not start using that override.
