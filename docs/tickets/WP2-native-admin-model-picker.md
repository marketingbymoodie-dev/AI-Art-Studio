# WP2-NATIVE · Admin model picker dropdown (limited to two proven models)

**Paste into Cursor. The Phase 1 prove-out PASSED — Opinionated generated clean transparent output on gpt-image-2 at 1¢ low. Now make the per-style model assignable from the admin UI (no more SQL). Own deploy.**

---

## Confirmed before this ticket
- gpt-image-2 native transparent generation works end-to-end (generate → transparent PNG → mockup), $0.01 at low quality, no chroma, clean edges. Proven on Opinionated via direct DB set.
- The admin Styles form currently DROPS generationModel / generationQuality (whitelist gap) — they can only be set by SQL today.

## What to build

### 1. Generation Model dropdown — LIMITED to two proven models ONLY
In the admin Styles editor form, add a **Generation Model** dropdown with EXACTLY these options, no others:
- `Default — Nano Banana (current)` → null / current google/nano-banana + chroma pipeline
- `GPT-Image-2 (native transparent)` → gpt-image-2, skips chroma

Do NOT add gpt-image-1.5 or any other model — only the two validated end-to-end. (If gpt-image-1.5 is ever needed as a fallback, it's added AFTER testing, not speculatively.)

### 2. Generation Quality dropdown (for gpt-image-2)
- `Low (default, ~1¢)` → null/low
- `Medium (~5¢)` → medium
- `High (~13¢)` → high
Show the cost hint in each label so the 5×/13× cost is visible at selection. Default low. Only relevant when model = gpt-image-2 (grey out / ignore for nano-banana).

### 3. Wire the whitelist (the core fix)
Add `generationModel` and `generationQuality` to the create/PATCH accepted-fields whitelist on the admin styles endpoint. Without this the dropdown won't persist. (Same gap that blocked vectorizeEnabled.)

### 4. Load + display current values
The form must READ current column values on open so an already-assigned style shows its model/quality. Confirm the GET/load path includes these columns.

### 5. (Optional, cheap alongside) vectorizeEnabled toggle
Same whitelist/UI gap. If cheap, add a "Vectorize (large-format scaling)" toggle and whitelist vectorizeEnabled too.

## Definition of done
- [ ] Model dropdown with EXACTLY two options (nano-banana default, gpt-image-2) — no untested models
- [ ] Quality dropdown with cost hints, default low
- [ ] generationModel + generationQuality whitelisted on create/PATCH (core fix)
- [ ] Form loads/displays current values; round-trip safe (saving doesn't clobber)
- [ ] Setting a style to gpt-image-2 via UI == the SQL result from the prove-out (uses gpt-image-2, transparent, chroma skipped)
- [ ] npm run build passes

## Verify
- [ ] Set a style to GPT-Image-2 via dropdown, save, reopen → persisted.
- [ ] Generate on it → gpt-image-2, transparent (confirm in log), ~1¢.
- [ ] Set a style to Default → nano-banana + chroma as before.
- [ ] Confirm no other models are selectable.
