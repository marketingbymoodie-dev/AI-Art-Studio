# Chroma fixtures (WP2 Ticket 1)

Synthetic inputs for Pass C hole-punch. `before/` is a snapshot of `processApparelMotif` **before** skipping Pass C on a magenta canvas.

| Fixture | Intent |
|---|---|
| `bird-head-touches-plate` | Bright silver head (`isMatColor`) on darker metal body; head touches `#FF00FF`. Before: Pass C ate the head (~6.9%). After: head survives. |
| `enclosed-teeth` | White teeth/eye wrapped in colour. Must stay opaque (no regression). |
| `white-canvas-background` | Genuine white plate + coloured subject. Background must still disappear (Pass B). |
| `flat-baseline` | Coloured circle, no white. Unchanged. |

Regenerate before-snapshots only against the *old* pipeline: `npx tsx server/__tests__/fixtures/chroma/snapshot-current.ts`
