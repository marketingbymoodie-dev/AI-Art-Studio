# WP2 layered prefixes — BEFORE snapshots and AFTER (chroma-only strip)

Captured from repo constants **before** this ticket rewrote them. AFTER is the same creative treatment with plate / `#FF00FF` / “hot pink background” / “DO NOT use magenta” language removed. Trailing “Create a … of” theme-fold is **kept** (not chroma).

Live DB rows that still match BEFORE (or still contain plate hex) are migrated on boot. Compose also strips plate language from the style layer so a merchant paste cannot add a second plate.

---

## Apparel light (`APPAREL_CHROMA_STYLE_BY_NAME`)

### Pattern Maker

**BEFORE**
```
Seamless repeating pattern design, tileable motif, clean vector shapes, flat colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background, no white mat, no rectangular frame. Create a repeating pattern of
```

**AFTER**
```
Seamless repeating pattern design, tileable motif, clean vector shapes, flat colors (avoid white, light colors), high contrast, no white mat, no rectangular frame. Create a repeating pattern of
```

### Opinionated

**BEFORE**
```
T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean typographic layout. Create a bold text stack design of
```

**AFTER**
```
T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat, clean typographic layout. Create a bold text stack design of
```

### Quotes

**BEFORE**
```
T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of
```

**AFTER**
```
T-shirt graphic, stylish quote typography, expressive lettering, flat vibrant colors (avoid white, light colors), high contrast, centered, no shadow, no texture, no white mat, creative typographic layout. Create a quote design of
```

### Pet Portraits

**BEFORE**
```
T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of
```

**AFTER**
```
T-shirt graphic, illustrated pet portrait, detailed character illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, clean illustrated style. Create a pet portrait of
```

### Centered Graphic

**BEFORE**
```
T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

**AFTER**
```
T-shirt graphic, centered flat vector illustration, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

### Illustrated Motif

**BEFORE**
```
T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

**AFTER**
```
T-shirt graphic, illustrated character motif, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

---

## Apparel dark (`APPAREL_DARK_TIER_PROMPTS`)

### pattern-maker

**BEFORE**
```
Seamless repeating pattern design, tileable motif, clean vector shapes, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background. Create a repeating pattern of
```

**AFTER**
```
Seamless repeating pattern design, tileable motif, clean vector shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast. Create a repeating pattern of
```

### opinionated

**BEFORE**
```
T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, clean typographic layout. Create a bold text stack design of
```

**AFTER**
```
T-shirt graphic, bold stacked text typography, strong opinion statement, up to 6 words maximum, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, clean typographic layout. Create a bold text stack design of
```

### quotes

**BEFORE**
```
T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, creative typographic layout. Create a quote design of
```

**AFTER**
```
T-shirt graphic, stylish quote typography, expressive lettering, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, creative typographic layout. Create a quote design of
```

### pet-portraits

**BEFORE**
```
T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, clean illustrated style. Create a pet portrait of
```

**AFTER**
```
T-shirt graphic, illustrated pet portrait, detailed character illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, clean illustrated style. Create a pet portrait of
```

### centered-graphic

**BEFORE**
```
T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

**AFTER**
```
T-shirt graphic, centered flat vector illustration, bold clean shapes, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

### illustrated-motif

**BEFORE**
```
T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black; DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

**AFTER**
```
T-shirt graphic, illustrated character motif, detailed illustration, bright vibrant colors including white and light tones (avoid dark, black), high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

---

## Graphics (`GRAPHICS_CHROMA_STYLE_BY_ID`)

### graphics-centered-graphic

**BEFORE**
```
Centered flat vector illustration for large-format print, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered composition, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

**AFTER**
```
Centered flat vector illustration for large-format print, bold clean shapes, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered composition, no shadow, no texture, no white mat, no rectangular frame. Create a centered graphic of
```

### graphics-illustrated-motif

**BEFORE**
```
Illustrated character motif for large-format print and patterns, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat (DO NOT use solid hot pink (#FF00FF) or magenta anywhere in the main design — #FF00FF is reserved exclusively for the background mat), high contrast, centered, isolated on a solid hot pink (#FF00FF) background, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

**AFTER**
```
Illustrated character motif for large-format print and patterns, detailed illustration, flat vibrant colors, white may be used inside the subject (teeth, eyes, highlights) but not as a background mat, high contrast, centered, no shadow, no texture, no white mat, no rectangular frame, clean illustrated style. Create an illustrated motif of
```

### graphics-pattern-maker

**BEFORE**
```
Seamless repeating pattern design for large-format products, tileable motif, clean vector shapes, flat colors (avoid white, light colors; DO NOT use solid hot pink (#FF00FF) or magenta in the design), high contrast, isolated on a solid hot pink (#FF00FF) background, no white mat, no rectangular frame. Create a repeating pattern of
```

**AFTER**
```
Seamless repeating pattern design for large-format products, tileable motif, clean vector shapes, flat colors (avoid white, light colors), high contrast, no white mat, no rectangular frame. Create a repeating pattern of
```
