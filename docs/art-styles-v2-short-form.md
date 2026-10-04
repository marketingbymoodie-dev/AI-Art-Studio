# Art Styles V2 — short-form rewrite

Replaces the long-form blocks in `docs/tickets/PP-art-styles-v2.md` for the art-style path.
**Target composed prompt: 700–900 characters.** The 808-char Woodcut control is the benchmark.

---

## Shared layer (composed once, immediately before each style block)

**APPAREL PRINT**

> APPAREL PRINT: Finished print artwork only — no garment, mockup, photograph or product shot. Transparent surround, no rectangular boundary. One subject, at most one supporting object; no vehicle interiors, rooms or architecture. Strong outer silhouette and large forms readable at arm's length. The pet's pose and expression carry the joke. Reproduce supplied wording exactly once and invent no other text.

**TYPE**

> TYPE: Set the words plainly within the composition. No dashes, rules, lines, ticks or bars flanking them; no starbursts, sparkles, radiating lines, speed lines or impact marks; no swashes, scrolls, banners, ribbons, laurels, asterisks, dots or diamond separators bracketing a phrase. The words stand on their own. Ornament appears only where the art style calls for it, as part of the illustration — never as default decoration around type.

---

## Concept expression — this is the layer that was breaking everything

The concept must state the **funny truth**, never the shot.

| Don't | Do |
|---|---|
| "dog occupies the front passenger seat, driver's door open and waiting" | "the dog has claimed the passenger seat and will not move" |

Position, props, staging, who else is present and what they're doing all belong to the style, not the concept. A concept that names a location, an object's state or a second person is a camera direction and will produce the same picture in all ten styles.

**Object budget:** one subject, at most one supporting object. No vehicle or building interiors. If a style wants a prop, the style asks for it.

---

## The ten style blocks

**1. Retro Character** — `retro-character`
> RETRO CHARACTER: Vintage character-tee illustration. Confident hand-drawn outlines, simplified forms, chunky shadows, 3–5 spot inks, light halftone texture. The pet is an expressive character actor — knowing look, slightly exaggerated pose. Hand-lettered retro type that belongs to the drawing. No photorealism, no glossy vector mascot.

**2. Woodcut** — `woodcut`
> WOODCUT: Hand-carved woodcut or linocut. Build the image from solid ink areas and gouged negative-space marks; irregular carved lines describe fur, form and movement. One dominant ink, optional second accent; garment colour forms large parts of the image. Block-printed lettering. No digital shading, gradients or fine engraving detail.

**3. Folk Graphic** — `folk-graphic`
> FOLK GRAPHIC: Naïve hand-made folk art. Simplified anatomy, chunky shapes, charmingly awkward proportions, uneven hand-drawn contours, flattened forms. 2–5 warm muted inks. Genuinely hand-rendered lettering. Eccentric and intelligent rather than cute. No polished mascot art, no glossy rendering.

**4. Pen & Ink** — `pen-ink`
> PEN & INK: Sparse editorial pen drawing. Confident black contour, selective cross-hatching and stippling, large areas left completely open. One ink, a second only if essential. Detail concentrated at the face and the action; everything else economical. No washes, gradients, frames or extra text.

**5. Vintage Engraving** — `vintage-engraving`
> VINTAGE ENGRAVING: Antique engraved plate — refined linework, cross-hatching, stippling, controlled solid blacks. Treat the ridiculous behaviour with scholarly dignity. Monochrome or 2–3 muted inks. Period serif lettering. No parchment, book page, paper rectangle, museum card or frame. No crowns or aristocratic-pet tropes.

**6. Conceptual Graphic** — `conceptual-graphic`
> CONCEPTUAL GRAPHIC: One visual idea, not an illustrated scene. Use silhouette, negative space, substitution, impossible scale, containment, merged shapes or visual metaphor drawn from the concept itself. Reduce to a few bold shapes in 1–3 inks. Prefer no text when the image carries the joke. No scene illustration, no portrait, no decoration.

**7. Bold Type** — `bold-type`
> BOLD TYPE: Typography leads. The supplied words dominate — large hand-lettered or vintage display type, strong hierarchy, deliberate line breaks. A small pet vignette integrates into, around or between the letterforms as one composition. 2–4 inks. No caption-under-image layout, no text box, no slogan template.

**8. Ornamental** — `ornamental`
> ORNAMENTAL: Storybook and Arts-and-Crafts decoration with restrained Art Nouveau line. Pet central; flowing organic curves and botanical forms interwoven around it, relating to the story. Graceful contour, flattened decorative shapes, 3–5 inks. Ornament supports and never overwhelms. No rectangular poster reproduction.

**9. Painterly** — `painterly`
> PAINTERLY: Gouache and watercolour character — visible brushwork, pigment variation, edges defined where they matter and dissolving where they don't. Richest pigment at the face and the action. 4–7 harmonious colours. Keep a deliberate silhouette. No paper, canvas, easel, frame or white page — the painting is the print.

**10. Psychedelic** — `psychedelic`
> PSYCHEDELIC: Late-60s/70s poster language. Warped flowing forms, chunky hand-drawn shapes, swelling retro display lettering interlocking with the illustration. 4–6 saturated retro inks — burnt orange, mustard, avocado, turquoise, coral, deep brown. Slight surreal exaggeration. No tie-dye background, no hippie symbols, no gradients.

---

## Rerun

Same batch as before, short form only:

- Same spaniel (photo `5eb9654283a8ab16`), Hostile Negotiations pinned, Flare, native transparent, medium, 1:1
- Concept restated as the funny truth, not the shot
- 10 styles × 2 variants
- Keep the long-form results stored for comparison; short is the default from here

## Report

- Composed character count per style — flag any over 900
- **Halo % per style.** The short Woodcut showed 6.1% and 8.3%. If simpler shapes cut cleaner, that's another argument for short; if halo rises, we need it before Painterly reaches a decision
- Any style still adding flanking dashes, ticks or radiating marks around the words
- Any style still producing broken geometry — doors, hands, furniture
- Composition variance: are the ten actually different pictures now
- Cost and time per image against the long-form run
