import { StandardEvents } from '@shopify/events';

/**
 * bmp-size-required.js — forced-size-selection Layer 1: the fetch path, which
 * is what actually happens.
 *
 * A shopper must deliberately choose a size before anything reaches the cart.
 * The render half (snippets/variant-main-picker.liquid#size-required-unselected)
 * stops pre-selecting the size; Layer 2
 * (blocks/buy-buttons.liquid#size-required-layer2) disables the hidden
 * input[name="id"] so a NATIVE post cannot fall back to a variant. This module
 * refuses the interaction and fires the presentation.
 *
 * Never patches core JS. It reads attributes, cancels events, and sets state
 * attributes — nothing else. Every presentation is static CSS in
 * assets/bmp-styles.css keyed off those attributes (D8): this module sets state
 * and never styles, and nothing here rewrites a shopper-facing textContent
 * (the live region is populated from the locale string Liquid already ships).
 * The payload it reads — data-bmp-size-option, data-bmp-size-values and the
 * --bmp-size-required-prompt custom property — lives on the gated wrapper
 * itself (blocks/buy-buttons.liquid#size-required-gate) since the cta-prompt
 * rework retired the warning-message element.
 *
 * WHY `window` AND NOT `document`
 * Horizon's declarative `on:submit` / `on:click` dispatcher is itself a
 * `document` listener registered with `{ capture: true }`
 * (assets/component.js:239-323), installed from Component.connectedCallback
 * (assets/component.js:70). Two capture listeners on the SAME node fire in
 * REGISTRATION order, and snippets/scripts.liquid (layout/theme.liquid:41)
 * loads product-form.js before bmp-globals (layout/theme.liquid:46) — so a
 * document-capture listener here would register second and run second, after
 * ProductFormComponent.handleSubmit had already sent the fetch. `window` is the
 * first node in the capture path, so a window-capture listener precedes EVERY
 * document listener regardless of load order.
 *
 * WHY `click` AND NOT ONLY `submit`
 * AddToCartComponent.handleClick (assets/product-form.js:71-92) runs
 * animateAddToCart() — `dataset.added = 'true'` plus a fly-to-cart element — on
 * the CLICK, before the form's submit event exists. Blocking only `submit`
 * therefore leaves a full success animation on a blocked add, on the main
 * button as well as the sticky bar (§5.6). Cancelling the click suppresses the
 * animation, the fly-to-cart element, the sticky bar's puppet `.click()`
 * (assets/sticky-add-to-cart.js:176-179) and the submission in one mechanism.
 * The submit listener remains as the belt for Enter-key and programmatic
 * form.requestSubmit().
 *
 * WHY DELEGATION AND NOT A CUSTOM ELEMENT
 * quick-add fetches the product page and lifts product-form-component and
 * variant-picker out of the response into its modal
 * (assets/quick-add.js:214-256), so the gated form can appear long after load;
 * variant changes morph subtrees. Delegated listeners registered once at import
 * cover all of it with no per-instance wiring — the same shape
 * bmp-dialog-close-guard.js and bmp-header-menu.js use.
 *
 * WHAT THE §9.1 PROBE CHANGED
 * Measured on the Globo store this ticket is about: clicking a size in the
 * app's own UI never touches the native size radio at all. What moves is the
 * hidden input[name="id"], the app's own legend, and the URL. So reading
 * `:checked` would never open the gate there, and value matching (§5.3) is not
 * a contingency — it is the primary signal on that store. The probe also found
 * that clicking the value the app already shows as selected is a complete
 * no-op, which is why intent is taken from the trusted CLICK and never from a
 * state change: keyed on change, the size the app happens to display would be
 * unbuyable.
 *
 * SATISFACTION IS MONOTONE
 * Once a shopper deliberately picks a size, the gate never shuts again. A later
 * colour change may invalidate that size and Horizon may reset the radio — but
 * the gate asks whether the shopper CHOSE, not whether the choice is buyable
 * (§12). Monotonicity is also what makes §5.7 safe: a variant morph that wipes
 * JS-set attributes merely re-closes a presentation, never the decision — and
 * since the cta-prompt rework made the attribute drive a VISIBLE CTA state, onProductSelect
 * re-asserts it from the WeakSet after every morph settles, so even the
 * re-closed presentation lasts one fetch at most. Wholesale node REPLACEMENT
 * of the wrapper still defeats the WeakSet; that is the documented §5.7
 * posture, accepted rather than chased.
 */

/** Gated product forms. Ungated products emit no attribute at all. */
const FORM_SELECTOR = 'product-form-component[data-bmp-size-required]';

/**
 * Every element whose activation would put a line item in the cart.
 * - `[ref="addToCartButton"]` covers the main CTA and quick-add's clone.
 * - `.sticky-add-to-cart__button` is the sticky bar's puppet trigger
 *   (sections/product-information.liquid:122-128); it lives OUTSIDE the product
 *   form, so resolveForm() falls back to the page's gated form.
 * Express checkout is absent on purpose: it is hidden in Liquid instead
 * (blocks/accelerated-checkout.liquid#size-required-express), because it posts
 * through Shopify's own script and no theme listener can intercept it (D1).
 */
const TRIGGER_SELECTOR = '[ref="addToCartButton"], .sticky-add-to-cart__button';

/**
 * Forms whose gate a trusted interaction has opened this page view. The
 * attribute on the wrapper is what CSS reads; this set is the decision of
 * record, so a morph that strips the attribute cannot un-decide it.
 * @type {WeakSet<Element>}
 */
const satisfiedForms = new WeakSet();

/** How far up from a click target to look for a size control. */
const INTENT_ANCESTOR_DEPTH = 6;

/** A size value is a short token; anything longer is prose, not a control. */
const MAX_VALUE_TEXT_LENGTH = 24;

/** A group must show at least this many of the option's values to BE the group. */
const MIN_GROUP_MATCHES = 2;

/**
 * When to look for an app-painted size selection, in ms from import.
 *
 * A swatch app renders and initialises AFTER us — measured on the Globo store,
 * its size list does not exist at import at all — so a single pass would find
 * nothing. These are bounded retries rather than a permanent MutationObserver:
 * the window that matters is the one before the shopper's first click, and an
 * observer that lives forever would fight the app every time it repaints,
 * including after a legitimate choice.
 */
const DEPAINT_DELAYS_MS = [0, 600, 1500, 3000];

/** How far above the resolved control to look for the app's own size heading. */
const LABEL_ANCESTOR_DEPTH = 3;

window.addEventListener('click', onClickCapture, { capture: true });
window.addEventListener('submit', onSubmitCapture, { capture: true });
// `change` needs no capture: nothing cancels it, and a trusted change from a
// native radio or select is intent whenever it arrives.
document.addEventListener('change', onChange);
// Every picker interaction morphs the section, and the morphed HTML carries
// `checked` only as the server resolved it — which can be a size nobody chose
// — see onProductSelect for why the shopper's live selection has to be
// carried across that morph by hand, in both directions.
document.addEventListener(StandardEvents.productSelect, onProductSelect);

for (const delay of DEPAINT_DELAYS_MS) setTimeout(depaintPass, delay);

/**
 * One listener, two jobs, on disjoint targets: record intent when the click
 * lands inside a size control, refuse the interaction when it lands on an
 * add-to-cart trigger while the gate is shut.
 * @param {MouseEvent} event
 */
function onClickCapture(event) {
  if (event.isTrusted) {
    const intentForm = findIntent(event);
    if (intentForm) openGate(intentForm);
    // No early return: a size control is never also an add-to-cart trigger, so
    // falling through costs one cheap closest() and keeps the two decisions
    // independent of each other's ordering.
  }

  const target = event.target instanceof Element ? event.target.closest(TRIGGER_SELECTOR) : null;
  if (!target) return;

  const form = resolveForm(target);
  if (!form) return;

  if (isSatisfied(form)) {
    // Re-assert the open state before letting the event through. A variant
    // morph can restore the server-rendered `disabled` on the hidden input, and
    // ProductFormComponent builds its request with `new FormData(form)`
    // (assets/product-form.js:420) — a disabled input is omitted from FormData,
    // so a stale `disabled` would send an add with no `id` at all.
    openGate(form);
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  blockInteraction(form);
}

/**
 * The belt: Enter-key submission and programmatic form.requestSubmit() never
 * produce a click.
 * @param {Event} event
 */
function onSubmitCapture(event) {
  const form = resolveForm(/** @type {Element | null} */ (event.target));
  if (!form) return;

  if (isSatisfied(form)) {
    openGate(form);
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  blockInteraction(form);
}

/**
 * A trusted `change` inside a size control is the cleanest intent signal there
 * is: it covers keyboard arrow-key selection on a radio group and a native
 * <select>, neither of which produces a click on the value itself.
 *
 * An UNtrusted change is ignored, which is the whole point of D7. Core
 * quick-add does exactly that write — `input.checked = true` followed by
 * `new Event('change')` (assets/quick-add.js:270-271) — to mirror a card's
 * variant into the modal, and a swatch app writing native inputs behaves the
 * same way. Neither is a shopper choosing a size.
 * @param {Event} event
 */
function onChange(event) {
  if (!event.isTrusted) return;
  const form = findIntent(event);
  if (form) openGate(form);
}

/**
 * Carry the shopper's live size selection across the section morph.
 *
 * Measured 2026-08-17 on the odmcjiqa mirror: every picker click makes
 * variant-picker fetch a section render whose URL carries `option_values=`,
 * and Shopify RESOLVES a partial value list to a concrete variant —
 * `?option_values=<colour only>` came back with `selected_variant` set and the
 * size legend claiming a size nobody chose. So the render half can never tell
 * a shopper's size from a resolved one, and it rightly keeps `checked` off
 * every gated radio (snippets/variant-main-picker.liquid#size-required-unselected).
 * Core's morph then syncs that un-checked markup onto the very radio the
 * shopper just picked (assets/morph.js updateInput), wiping the selection —
 * visually (the parked pill returns) and materially: the NEXT `option_values=`
 * fetch would omit the size, so a later colour click re-resolves to the first
 * available size and the hidden input[name="id"] points at a size nobody chose.
 *
 * The fix is client-owned state carried around the morph: snapshot what is
 * `:checked` in each gated fieldset when the select event fires (synchronous
 * with the interaction, before the fetch), and re-assert it after the morph
 * settles (`event.promise` resolves after updateVariantPicker). Value-matched,
 * not node-matched, so it survives node replacement; skipped whenever the
 * morphed fieldset already has a checked radio, so a future server render that
 * CAN mark one is never fought. Programmatic `.checked = true` fires no
 * `change`, so this cannot loop through onChange or read as new intent, and it
 * restores only a selection that was live in the DOM — a fieldset the shopper
 * never touched has nothing checked and snapshots empty.
 *
 * The snapshot is enforced in BOTH directions since the cta-prompt follow-up.
 * The render half now emits `checked` whenever the request carries
 * selected_variant (a ?variant= page load is a choice — a shared link, or a
 * reload after picking), and Liquid cannot tell that request from a section
 * render resolved out of a partial option_values list, which also arrives
 * with selected_variant set for a size nobody chose. So a colour click on an
 * unsatisfied form would morph in a checked size out of nowhere. The
 * empty-snapshot pass below clears it: a gated fieldset that snapshotted
 * EMPTY on an unsatisfied form comes out of the morph empty. Satisfied forms
 * are exempt — their checked state is the shopper's own or a deep link's,
 * and un-checking it would fight the decision of record (monotone, §12).
 *
 * This writes to native radios where the depaint pass refuses to — different
 * contract: depaint clears an APP's paint inside app-rendered groups, this
 * restores the SHOPPER's own selection inside our marked fieldset.
 *
 * KNOWN GAP, deliberate: the dropdown variant style loses its choice the same
 * way, but a <select> leaves no equally clean artifact and no store this
 * feature serves renders sizes as dropdowns; noted rather than solved (§2
 * premature generality).
 * @param {Event & { promise?: Promise<unknown> }} event
 */
function onProductSelect(event) {
  // Keyed by document-order index, not by node: a morph is free to REPLACE the
  // fieldset rather than update it in place, and a kept reference to a
  // disconnected node would silently skip the restore.
  const kept = new Map();
  document.querySelectorAll('[data-bmp-size-fieldset]').forEach((fieldset, index) => {
    const checked = fieldset.querySelector('input:checked');
    if (checked instanceof HTMLInputElement) kept.set(index, checked.value);
  });

  // No early return on an empty snapshot: the attribute re-assert below must
  // run for every morph, including one triggered from a fieldset the shopper
  // never touched (an app-swatch store snapshots empty every time).
  event.promise
    ?.then(() => {
      document.querySelectorAll('[data-bmp-size-fieldset]').forEach((fieldset, index) => {
        const value = kept.get(index);
        if (value === undefined) {
          // Empty snapshot: nothing was chosen when the fetch left. If the
          // gate is still shut, whatever the morph checked is a server-side
          // resolution, not a choice — clear it (see the header: the render
          // half cannot tell a ?variant= load from an option_values render).
          const form = resolveGatedFormForScope(fieldset);
          if (form && !isSatisfied(form)) {
            for (const input of fieldset.querySelectorAll('input:checked')) {
              if (input instanceof HTMLInputElement) input.checked = false;
            }
          }
          return;
        }
        if (fieldset.querySelector('input:checked')) return;
        for (const input of fieldset.querySelectorAll('input[type="radio"]')) {
          if (input instanceof HTMLInputElement && input.value === value) {
            input.checked = true;
            break;
          }
        }
      });

      // The satisfied attribute drives presentation (the legend
      // guard, and the gate's own record for tests), and morph.js does not
      // preserve it — the combined-listing path morphs the whole `main`,
      // which strips JS-set attributes. The WeakSet is the decision of
      // record; mirror it back for CSS. openGate is idempotent.
      // A morph that REPLACED the wrapper node is a new form the WeakSet never
      // saw — that transient re-close is the documented §5.7 posture.
      for (const form of document.querySelectorAll(FORM_SELECTOR)) {
        if (satisfiedForms.has(form) && form.getAttribute('data-bmp-size-satisfied') !== 'true') {
          openGate(form);
        }
      }
    })
    .catch(() => {
      // An aborted fetch means a newer selection superseded this one; that
      // selection's own event carries its own snapshot.
    });
}

/**
 * The gated form this event expresses size intent for, or null.
 * @param {Event} event
 * @returns {Element | null}
 */
function findIntent(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return null;

  // The BMP option legend renders the selected value in its own span, whose
  // text is exactly a size value — a click there is not a choice.
  if (target.closest('legend')) return null;
  // A trigger is never a size control; without this guard a CTA labelled with
  // a value would read as intent — and the blocked CTA's own
  // ::after literally reads "Please select a size".
  if (target.closest(TRIGGER_SELECTOR)) return null;

  const form = resolveGatedFormForScope(target);
  if (!form) return null;

  const scope = form.closest('.shopify-section, dialog') ?? document;
  const optionName = form.getAttribute('data-bmp-size-option');

  // Native path: the fieldset Liquid marked, or a control naming the option.
  if (target.closest('[data-bmp-size-fieldset]')) return form;
  if (optionName) {
    const name = cssEscape(optionName);
    if (target.closest(`[data-option-name="${name}"]`)) return form;
    if (target.closest(`select[name="options[${name}]"]`)) return form;
  }

  // Relocated path: a control whose own label is one of the option's values.
  // On the measured Globo store this is the ONLY signal available.
  const values = parseValues(form.getAttribute('data-bmp-size-values'));
  if (values.size === 0) return null;

  let node = /** @type {Element | null} */ (target);
  for (let depth = 0; node && depth < INTENT_ANCESTOR_DEPTH; depth += 1, node = node.parentElement) {
    if (!matchesValue(node, values)) continue;
    markResolvedControl(node, values, scope);
    return form;
  }
  return null;
}

/**
 * Whether this element's own label is one of the option's values.
 *
 * Checks the attributes a swatch app plausibly carries, then the element's own
 * DIRECT text nodes, and only then its whole textContent. Direct text matters:
 * the measured app wraps each value in an element that also holds a duplicate
 * hidden copy, so the container's textContent reads "XSXS" while the label the
 * shopper actually clicks reads "XS". Matching descendants-included text alone
 * would miss every value on that store.
 *
 * The length cap keeps a paragraph that merely mentions "M" from matching.
 * @param {Element} el
 * @param {Set<string>} values
 * @returns {boolean}
 */
function matchesValue(el, values) {
  const candidates = [
    el.getAttribute('data-value'),
    el.getAttribute('data-option-value'),
    el.getAttribute('value'),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    directText(el),
  ];

  const text = el.textContent?.trim();
  if (text && text.length <= MAX_VALUE_TEXT_LENGTH) candidates.push(text);

  return candidates.some((c) => c != null && values.has(c.trim().toLowerCase()));
}

/**
 * This element's own text, excluding descendants.
 * @param {Element} el
 * @returns {string}
 */
function directText(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  }
  return out.trim();
}

/**
 * @param {string | null | undefined} raw
 * @returns {Set<string>}
 */
function parseValues(raw) {
  const set = new Set();
  if (!raw) return set;
  for (const value of raw.split('|')) {
    const trimmed = value.trim().toLowerCase();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

/**
 * Marks the relocated control's GROUP so presentation B can outline it and
 * revealTarget() can scroll and focus it.
 *
 * The group is the nearest ancestor of the clicked value that shows at least
 * MIN_GROUP_MATCHES of the option's values — not simply `parentElement`, which
 * on the measured app is the individual value's own wrapper. Requiring two
 * matches is also what stops a single stray "M" somewhere in the page from
 * being mistaken for the size picker.
 *
 * Marked once per scope and then left alone: re-marking on every click would
 * fight a morph for no benefit.
 * @param {Element} matched
 * @param {Set<string>} values
 * @param {Element | Document} scope
 */
function markResolvedControl(matched, values, scope) {
  if (scope.querySelector('[data-bmp-size-control]')) return;

  let node = matched.parentElement;
  for (let depth = 0; node && depth < INTENT_ANCESTOR_DEPTH; depth += 1, node = node.parentElement) {
    if (node.querySelector(TRIGGER_SELECTOR)) return;
    if (countMatches(node, values) >= MIN_GROUP_MATCHES) {
      node.setAttribute('data-bmp-size-control', 'app');
      return;
    }
  }
}

/**
 * Finds the app's size group WITHOUT waiting for a click, so presentation B has
 * something to outline and focus on the first blocked add.
 *
 * markResolvedControl() cannot serve this case: it needs an already-clicked
 * value, and at a blocked add the shopper has touched nothing. Measured on the
 * Globo store, that left B with only its message - no outline, no focus.
 *
 * Picks the SMALLEST visible container showing at least MIN_GROUP_MATCHES of the
 * option's values, so a page wrapper that happens to contain the swatches does
 * not win over the swatch list itself. Containers holding an add-to-cart trigger
 * are skipped for the same reason markResolvedControl() skips them.
 * @param {Element | Document} scope
 * @param {Set<string>} values
 */
function findRelocatedControl(scope, values) {
  if (!values.size) return;
  if (scope.querySelector('[data-bmp-size-control]')) return;

  let best = null;
  for (const node of scope.querySelectorAll('div, ul, ol, fieldset, section')) {
    if (node.querySelector(TRIGGER_SELECTOR)) continue;
    if (node.closest('[data-bmp-size-fieldset]')) continue;
    if (!visible(node)) continue;
    if (countMatches(node, values) < MIN_GROUP_MATCHES) continue;
    if (!best || best.contains(node)) best = node;
  }

  if (best) best.setAttribute('data-bmp-size-control', 'app');
}

/**
 * Stops a swatch app from showing a size as chosen while the gate is shut.
 *
 * MEASURED, and the reason this exists: with the native picker hidden and no
 * size natively selected, the app initialises its OWN UI to the first value.
 * The shopper is shown "Size: XS" with XS painted as selected, clicks Add to
 * Cart, and is told to select a size — the refusal reads as a bug rather than
 * as a prompt, because the page it contradicts is the only one the shopper can
 * see. The §9.1 probe recorded this state ("the app FILLS the empty state") and
 * left it to the presentation to overcome; no presentation can overcome a
 * second app asserting the opposite.
 *
 * Runs only while the gate is SHUT and only when our own fieldset is not on the
 * page — so a store with a visible native picker never reaches it, and a
 * shopper who has chosen is never second-guessed.
 *
 * The write is silent on purpose: no `change` event is dispatched. An event
 * would invite the app to re-derive its state from ours and repaint, and an
 * untrusted one cannot open the gate anyway (D7). Unchecking alone clears the
 * paint, because the app's selected treatment is `:checked`-driven — verified
 * on the store, along with the fact that it does not re-apply the selection and
 * that a real click afterwards still registers, repaints and opens the gate.
 *
 * Its own legend text is NOT cleared: that string lives in the app's markup and
 * reaching it would need a vendor-shaped selector, which this module refuses to
 * carry (§5.3). The swatches are the part a shopper reads as "chosen".
 * @param {Element} control
 */
function clearPaintedSelection(control) {
  for (const input of control.querySelectorAll('input:checked')) {
    // Never our own: the native fieldset's radios are Liquid's to render, and
    // Horizon's picker reads them.
    if (input.closest('[data-bmp-size-fieldset]')) continue;
    input.checked = false;
  }
}

/**
 * Blanks a swatch app's own "Size: XS" heading while the gate is shut.
 *
 * The companion to clearPaintedSelection(). De-painting the swatches is not
 * enough on the measured app: it also prints the value into its own heading,
 * and that line is the one a shopper reads as "a size is chosen". Measured —
 * the heading survived the de-paint and still read "Size: XS" over an unpainted
 * list, which is the same contradiction in words instead of colour.
 *
 * Vendor-neutral by construction: it names no class and no app. It walks TEXT
 * NODES in the container that holds the resolved control, and blanks only those
 * whose ENTIRE trimmed content is exactly one of the option's values — the same
 * value-matching rule findIntent() already uses to recognise a size control at
 * all. A heading reading "Size: XS" is two text nodes, "Size" plus the value;
 * only the value one matches, so the label survives and the claim does not.
 *
 * Nodes inside the control are skipped — those ARE the choices, and blanking
 * them would leave an unusable picker. Our own fieldset is skipped for the
 * same reason clearPaintedSelection() skips it: it is ours, and Liquid
 * already renders it honestly.
 *
 * Transient by design: the app rewrites this heading on the first real click
 * (measured — it became "Size: S"), so this never has to be undone.
 * @param {Element} control
 * @param {Set<string>} values
 */
function clearPaintedLabel(control, values) {
  if (!values.size) return;

  let block = control.parentElement;
  for (let depth = 0; block && depth < LABEL_ANCESTOR_DEPTH; depth += 1, block = block.parentElement) {
    let cleared = false;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (control.contains(node)) continue;

      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('[data-bmp-size-fieldset]')) continue;

      const text = (node.textContent ?? '').trim();
      if (!text || text.length > MAX_VALUE_TEXT_LENGTH) continue;
      if (!values.has(text.toLowerCase())) continue;

      node.textContent = '';
      cleared = true;
    }

    // Stop at the first container that actually held the claim: walking further
    // up only widens the blast radius for no gain.
    if (cleared) return;
  }
}

/**
 * Resolves the app's size group and de-paints it, for every gated form on the
 * page whose gate is still shut. Idempotent, which is what makes the bounded
 * retries safe: findRelocatedControl() no-ops once a group is marked, and
 * re-clearing an already-clear group writes nothing.
 */
function depaintPass() {
  for (const form of document.querySelectorAll(FORM_SELECTOR)) {
    if (isSatisfied(form)) continue;

    const scope = form.closest('.shopify-section, dialog') ?? document;
    if (visible(scope.querySelector('[data-bmp-size-fieldset]'))) continue;

    const values = parseValues(form.getAttribute('data-bmp-size-values'));
    findRelocatedControl(scope, values);

    const control = scope.querySelector('[data-bmp-size-control]');
    if (control) {
      clearPaintedSelection(control);
      clearPaintedLabel(control, values);
    }
  }
}

/**
 * How many DISTINCT option values this element shows.
 * @param {Element} el
 * @param {Set<string>} values
 * @returns {number}
 */
function countMatches(el, values) {
  const seen = new Set();
  for (const child of el.querySelectorAll('*')) {
    for (const candidate of [child.getAttribute('data-value'), child.getAttribute('value'), directText(child)]) {
      const key = candidate?.trim().toLowerCase();
      if (key && values.has(key)) seen.add(key);
    }
  }
  return seen.size;
}

/**
 * The gated form an element belongs to, for INTENT purposes: its own ancestor
 * form, else the one in the same section or open dialog. Deliberately narrower
 * than resolveForm() — it never falls back to the whole document, so a click in
 * an unrelated part of the page cannot open a gate.
 * @param {Element} el
 * @returns {Element | null}
 */
function resolveGatedFormForScope(el) {
  const own = el.closest(FORM_SELECTOR);
  if (own) return own;
  const container = el.closest('dialog[open], .shopify-section');
  return container?.querySelector(FORM_SELECTOR) ?? null;
}

/**
 * The gated form a TRIGGER belongs to. The sticky bar sits outside the form, so
 * this one does fall back to the page's gated form — but only for a real
 * trigger.
 * @param {Element | null} el
 * @returns {Element | null}
 */
function resolveForm(el) {
  if (!el) return null;
  const own = el.closest(FORM_SELECTOR);
  if (own) return own;
  if (!el.closest(TRIGGER_SELECTOR)) return null;

  // Prefer a form inside an open dialog (quick-add) over the page's own.
  const dialog = el.closest('dialog[open]');
  return dialog?.querySelector(FORM_SELECTOR) ?? document.querySelector(FORM_SELECTOR);
}

/**
 * D7. Either signal satisfies:
 *   1. Server-rendered intent — Liquid stamped data-bmp-size-satisfied because
 *      product.selected_variant was non-blank, which on a product page happens
 *      only when ?variant= was in the actual REQUEST.
 *   2. Trusted client-side intent, recorded in satisfiedForms.
 * @param {Element} form
 * @returns {boolean}
 */
function sizeIsUnchosen(form) {
  const scope = form.closest('.shopify-section, dialog') ?? document;
  const field = scope.querySelector('[data-bmp-size-fieldset]');
  if (!(field instanceof HTMLElement)) return false;
  const radios = field.querySelectorAll('input[type="radio"]');
  if (radios.length < 2) return false;
  return !field.querySelector('input[type="radio"]:checked');
}

function isSatisfied(form) {
  if (sizeIsUnchosen(form)) return false;
  return form.getAttribute('data-bmp-size-satisfied') === 'true' || satisfiedForms.has(form);
}

/**
 * Opens the gate for one form: records the decision, mirrors it for CSS, clears
 * any error state, releases Layer 2, and reveals express checkout. Idempotent —
 * it runs again on every allowed interaction on purpose.
 * @param {Element} form
 */
function openGate(form) {
  satisfiedForms.add(form);
  form.setAttribute('data-bmp-size-satisfied', 'true');
  form.removeAttribute('data-bmp-size-missing');

  // Layer 2 release. A disabled input is omitted from `new FormData(form)`,
  // which is how ProductFormComponent builds its request
  // (assets/product-form.js:420), so this must happen before any add.
  const variantId = form.querySelector('input[name="id"]');
  if (variantId instanceof HTMLInputElement && variantId.disabled) variantId.disabled = false;

  // Express checkout. Liquid hid it; core owns the same attribute for the
  // unavailable-variant case (assets/product-form.js:822-828), so defer to the
  // add-to-cart button's disabled state rather than unhiding unconditionally.
  const addToCart = form.querySelector('[ref="addToCartButton"]');
  if (addToCart instanceof HTMLButtonElement && addToCart.disabled) return;

  const express = form.querySelector('[ref="acceleratedCheckoutButtonContainer"]');
  if (express instanceof HTMLElement) express.hidden = false;
}

/**
 * Fires the presentation for a refused interaction. Sets state only; which
 * treatment appears is decided by CSS from data-bmp-size-required.
 * @param {Element} form
 */
function blockInteraction(form) {
  // Re-toggle so the CSS shake replays on EVERY refused click, not only the
  // first: an animation keyed on an attribute that never changes runs once.
  // The reflow read commits the removal before the re-add; this writes state
  // only (D8) — the motion itself stays in assets/bmp-styles.css.
  if (form.getAttribute('data-bmp-size-missing') === 'true') {
    form.removeAttribute('data-bmp-size-missing');
    void form.querySelector('[ref="addToCartButton"]')?.offsetWidth;
  }
  form.setAttribute('data-bmp-size-missing', 'true');

  const section = form.closest('.shopify-section, dialog');
  const promptValue = form.style.getPropertyValue('--bmp-size-required-prompt');
  if (section instanceof HTMLElement && promptValue) {
    section.style.setProperty('--bmp-size-required-prompt', promptValue);
  }

  announce(form, readPrompt(form));

  // Only when our own fieldset is not on the page: a swatch app has replaced it,
  // so the outline needs the app's group resolved before it can point at anything.
  const scope = form.closest('.shopify-section, dialog') ?? document;
  if (!visible(scope.querySelector('[data-bmp-size-fieldset]'))) {
    const values = parseValues(form.getAttribute('data-bmp-size-values'));
    findRelocatedControl(scope, values);

    // Also here, not only in the startup pass: quick-add injects its form long
    // after those retries have run, and an app that repaints late would
    // otherwise still be asserting a chosen size at the moment we refuse one.
    const control = scope.querySelector('[data-bmp-size-control]');
    if (control) {
      clearPaintedSelection(control);
      clearPaintedLabel(control, values);
    }
  }

  revealTarget(form);
}

/**
 * The shopper-facing prompt, read back out of the one source of truth already
 * in the DOM: the wrapper's --bmp-size-required-prompt custom property
 * (blocks/buy-buttons.liquid#size-required-gate). Liquid emits it with
 * `| json`, so the computed value is a valid JSON string literal — parsing it
 * is the exact inverse, quotes and escapes included. Empty string on any
 * failure; announce() already no-ops on empty.
 * @param {Element} form
 * @returns {string}
 */
function readPrompt(form) {
  try {
    return JSON.parse(getComputedStyle(form).getPropertyValue('--bmp-size-required-prompt').trim());
  } catch {
    return '';
  }
}

/**
 * Announces through the form's EXISTING live region
 * (blocks/buy-buttons.liquid#size-required-gate) — no new accessibility
 * plumbing (§6.3).
 * @param {Element} form
 * @param {string} text
 */
function announce(form, text) {
  if (!text) return;
  const liveRegion = form.querySelector('[ref="liveRegion"]');
  if (!(liveRegion instanceof HTMLElement)) return;
  // Clear then set, so a repeat click re-announces instead of reading as
  // unchanged text a screen reader will skip.
  liveRegion.textContent = '';
  liveRegion.textContent = text;
}

/**
 * Scrolls the size control into view ONLY when it is off screen, and focuses
 * the first available control. This is what earns the reveal its keep on
 * mobile, where the sticky bar is the only visible add-to-cart and the picker
 * is far above the fold.
 *
 * Target order: the native fieldset, else an app group the module has
 * resolved, else nothing — the blocked button itself displays
 * the prompt, so a shopper whose click found no locatable size control still
 * gets visible feedback under their pointer.
 * @param {Element} form
 */
function revealTarget(form) {
  const scope = form.closest('.shopify-section, dialog') ?? document;
  const target =
    visible(scope.querySelector('[data-bmp-size-fieldset]')) ??
    visible(scope.querySelector('[data-bmp-size-control]'));

  if (!(target instanceof HTMLElement)) return;

  const rect = target.getBoundingClientRect();
  // Account for the sticky header: a control tucked under it is technically in
  // the viewport and practically invisible.
  const headerOffset = readPixels('--header-height', 0);
  const offScreen = rect.top < headerOffset || rect.bottom > window.innerHeight;

  if (offScreen) target.scrollIntoView({ block: 'center', behavior: 'smooth' });

  const focusable = target.querySelector(
    'input[type="radio"]:not([aria-disabled="true"]), select, button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: offScreen });
}

/**
 * The element, or null when it is not rendered. The native fieldset carries
 * inline `display: none` on a swatch-app store (measured, §9.1), so an
 * un-checked target would scroll and focus into nothing.
 * @param {Element | null} el
 * @returns {Element | null}
 */
function visible(el) {
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? el : null;
}

/**
 * @param {string} property
 * @param {number} fallback
 * @returns {number}
 */
function readPixels(property, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Escapes a merchant-configured option name for use inside a QUOTED attribute
 * selector. CSS.escape is deliberately not used: it escapes for IDENT context
 * and would mangle the legitimate spaces in a name like "Shoe Size".
 * @param {string} value
 * @returns {string}
 */
function cssEscape(value) {
  return value.replace(/["\\]/g, '\\$&');
}
