# Petposterous style blocks — six styles, apparel + decor

Replaces the ten-style launch set with six, each in two surface variants.
Short-form discipline retained: style blocks ~300 characters, layers kept separate.

## Composition order

```
CONCEPT: {truth}.
Exact wording, once: {punchline}        // omitted when empty
DEVICE: {device}.
{SURFACE RULE}                          // apparel OR decor, by product class
PETPOSTEROUS                            // brand layer, shared
TYPE                                    // shared
{STYLE BLOCK}                           // style id + surface variant
```

Everything above the style block is fixed per surface. Only the last line changes with style.

**Not in these strings, and must not drift back into them:** aspect ratio, pixel dimensions, background colour, transparency. Those belong to the product layer, which already holds them. `1080×1080 square` in a style string would contradict the 2:3 chest print the product selector already declares.

---

## Shared layers

### APPAREL PRINT (surface)

> APPAREL PRINT: Finished print artwork only — no garment, mockup or photograph. Transparent surround, no rectangular boundary. No environments or interiors. The art style may call for up to one abstracted prop; a second person only as a partial mark — a hand, a foot, a sliver of silhouette — never a full figure. Strong outer silhouette, large forms readable at arm's length. The pet's pose and expression carry the joke.

### DECOR PRINT (surface)

> DECOR PRINT: Finished framed-print artwork — a composed rectangular picture with generous margins and nothing cropped at the edge. More detail and more depth than a garment graphic, but still a designed print, not a photograph or a painted scene. One spare setting is permitted, held as graphic shapes rather than scenery. The pet remains the dominant character and carries the joke.

### PETPOSTEROUS (brand — tone and palette, one place only)

> PETPOSTEROUS: The animal is fully aware of what it is doing — guilty but unbothered, dignified about something ridiculous, in quiet control of the household. The humour is dry, observant and affectionate; never childish, cute or meme-like. Solid colours only, no gradients, no photorealism. Palette: Deep Ink, Warm Bone, Oxblood, Institutional Green, plus one species-appropriate accent. No paw prints, bones, hearts or pet-shop motifs.

### TYPE (shared)

> TYPE: Set the words plainly within the composition. No dashes, rules, lines, ticks or bars flanking them; no starbursts, sparkles, radiating lines, speed lines or impact marks; no swashes, scrolls, banners, ribbons, laurels, asterisks, dots or diamond separators bracketing a phrase. The words stand on their own. Ornament appears only where the art style calls for it, as part of the illustration — never as default decoration around type.

---

## 1. Vintage Engraving — `vintage-engraving`

**Apparel**
> VINTAGE ENGRAVING — APPAREL: An antique engraved plate simplified for a garment. Bold engraved outline, restrained cross-hatching, controlled solid blacks, high contrast, strong silhouette. Monochrome or two inks. Period serif lettering. No parchment, book page, paper rectangle, museum card or frame. No crowns or aristocratic-pet tropes.

**Decor**
> VINTAGE ENGRAVING — DECOR: A full antique engraved plate. Refined linework, stippling, dense cross-hatching, formal margins, small institutional captions and evidence labels. Treat the behaviour with the seriousness of a natural-history or legal case study. Two to three inks. The engraving is the artwork — no depicted parchment, book page or frame within the frame.

## 2. Pen & Ink — `pen-ink`

**Apparel**
> PEN & INK — APPAREL: Sparse editorial pen drawing. Confident black contour, selective stippling, light hatching, large areas left completely open. One ink, a second only if essential. Detail concentrated at the face and the action, everything else economical. No washes, gradients, decorative frame or filler.

**Decor**
> PEN & INK — DECOR: A literary pen-and-ink observation — a quiet forensic note on domestic absurdity. Elegant sparse linework, stippling, considered negative space, a calm editorial layout with real margins. A few telling objects may place the scene. One or two inks. Clever, cultured and faintly accusatory.

## 3. Woodcut — `woodcut`

**Apparel**
> WOODCUT — APPAREL: Hand-carved woodcut or linocut. Solid ink masses and gouged negative-space marks; irregular carved lines describe fur, form and movement. One dominant ink, optional second accent; garment colour forms large parts of the image. Block-printed lettering. No digital shading, gradients or fine engraving detail.

**Decor**
> WOODCUT — DECOR: A full relief print of a domestic incident. Carved ink texture, bold shadow masses, expressive gouged cuts, visible handmade printing character. Enough setting to place the incident, held as carved shapes rather than scenery. Two to three inks. A small printer's mark or footer is permitted.

## 4. Retro Character — `retro-character`

**Apparel**
> RETRO CHARACTER — APPAREL: Vintage character tee. Confident hand-drawn outlines, simplified forms, chunky shadows, 3–5 spot inks, light halftone and print distress. The pet is an expressive character actor — knowing look, slightly exaggerated pose. Hand-lettered retro type that belongs to the drawing. No glossy vector mascot, no photorealism.

**Decor**
> RETRO CHARACTER — DECOR: Mid-century character illustration composed as a print. Expressive posing, richer drawing, subtle print texture, a considered editorial layout. The pet is a fully formed household character. Domestic props and posture deliver the joke. 4–6 inks. A small caption or badge is permitted.

## 5. Bold Type — `bold-type`

**Apparel**
> BOLD TYPE — APPAREL: Typography leads. The supplied words dominate — large hand-lettered or vintage display type, strong hierarchy, deliberate line breaks. A small pet vignette integrates into, around or between the letterforms as one composition. 2–4 inks. No caption-under-image layout, no text box, no slogan template.

**Decor**
> BOLD TYPE — DECOR: The words set as an official household declaration. Refined serif or institutional sans, strong typographic hierarchy, formal margins, a composed editorial grid. The pet appears within the layout as evidence, witness or culprit. Bureaucratically absurd and entirely straight-faced. Small file or case labels are permitted.

## 6. Folk Graphic — `folk-graphic`

**Apparel**
> FOLK GRAPHIC — APPAREL: Naïve hand-made folk art. Simplified anatomy, chunky shapes, charmingly awkward proportions, uneven hand-drawn contours, flattened forms. 2–5 warm muted inks. Genuinely hand-rendered lettering. Eccentric and intelligent rather than cute. No polished mascot art, no glossy rendering.

**Decor**
> FOLK GRAPHIC — DECOR: A small domestic legend told as a folk print. Naïve handmade drawing, irregular symmetry, restrained decorative motifs, household objects arranged like a folk tale or a warning sign. 3–5 warm muted inks. Folk lettering or plain serif. Handcrafted warmth, never children's-book cuteness.

---

## Product routing

| Product | Surface | Note |
|---|---|---|
| T-shirt, hoodie, sweatshirt | Apparel | — |
| Sticker, tote | Apparel | more negative space, simplify further |
| Framed print, art print, canvas, poster | Decor | — |
| Blanket, pillow | Decor | reduce small text, enlarge the central subject |
| All-over print | Decor | per-panel handling unchanged |

The surface choice is a property of the product class, resolved once and passed to the composer. It is not a customer-facing control.

---

## Device writer — surface awareness

The device writer already receives the style profile. It also needs the surface, because the same style stages differently on each:

- **Apparel** — one subject, a strong silhouette, props only as abstracted forms
- **Decor** — a composed picture, one spare setting permitted, margins part of the design

A device written for apparel will under-fill a framed print; one written for decor will overfill a shirt.

---

## Open question — the four styles being dropped

This set drops **Conceptual Graphic, Ornamental, Painterly and Psychedelic**. Conceptual Graphic was previously called strategically important for Petposterous — it's the only style where the joke becomes a visual device rather than an illustrated scene, which is exactly what makes apparel graphics work.

Suggest: keep all ten in code, mark six as the launch set, and let the first bench run decide whether Conceptual Graphic earns a place. Dropping it before it has been tested with a real device layer discards the style most likely to produce the Sloth-Hiking-Club shape.

---

## Admin editing

Making these editable from the admin panel is a separate change with two requirements:

1. **Version history.** A prompt that can change without a deploy needs a record of what it was, so a regression can be traced to a wording change.
2. **A "regenerate examples" action.** The style tiles and the ready-made library are rendered from these prompts. Edit a prompt and the examples silently stop matching what customers will get. The regenerate action must be adjacent to the edit, not a separate chore.
