# Chroma text fixtures (WP2 Ticket 2)

Synthetic inputs for vectorize counters, thin stems, enclosed non-plate hues, smooth curves, and sticker borders.

| Fixture | Intent |
|---|---|
| `bold-letters-OeagRB` | Geometric O/e/a/g/R/B. Counters must be transparent; strokes solid. |
| `thin-stems` | 3px bars. Must survive speckle=0 and no pre-trace erode. |
| `baggage` | Same painter as bold letters (mixed counters). |
| `flower-enclosed-hue` | `#E614E1` petal inside a dark ring — keep (non-plate hue). |
| `flat-art` | Solid blob — no new hole. |
| `smooth-curve` | Penguin-like ellipses — silhouette stays smooth/opaque. |
| `bordered-sticker` | 4px dark ring + fill. |

Run via `server/apparel-matting.vectorize-text.test.ts` with `vectorize: true` and `APPAREL_VECTORIZE_PROVIDER=neplex`.
