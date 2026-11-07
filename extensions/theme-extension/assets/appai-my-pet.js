/**
 * My Pet — storefront behaviour for the my-pet.liquid block.
 * Upload a pet photo → image-edit the published design → preview on the
 * garment → add to cart via the same shadow-SKU endpoint every other
 * customizer flow uses. See docs/ (My Pet plan) for the full spec.
 */
(function () {
  'use strict';
  var TAG = '[My Pet]';

  // Shopify App Proxy strips the Cookie header before forwarding storefront
  // requests to the backend, so a cookie set by our handler (the back-compat
  // Set-Cookie still goes out) never makes it back to us on the next call —
  // every request would see a fresh deviceKey. Instead we store the
  // signed device key in localStorage and attach it to every request body/query.
  // The server echoes `deviceKey` in success responses so the first mint is
  // persisted here. Same cross-device-pooling mitigation as the old cookie
  // (signed <uuid>.<hmac>; forging a key needs the server's secret).
  var DEVICE_KEY_STORAGE = 'appai_my_pet_device_v1';

  function readStoredDeviceKey() {
    try { return String(window.localStorage.getItem(DEVICE_KEY_STORAGE) || ''); } catch (e) { return ''; }
  }
  function writeStoredDeviceKey(value) {
    if (!value || typeof value !== 'string') return;
    try { window.localStorage.setItem(DEVICE_KEY_STORAGE, value); } catch (e) { /* localStorage disabled */ }
  }
  function captureDeviceKeyFromResponse(json) {
    if (json && typeof json === 'object' && typeof json.deviceKey === 'string' && json.deviceKey) {
      writeStoredDeviceKey(json.deviceKey);
    }
    return json;
  }

  // Bug 10 — exit-intent email pre-fill: once a shopper types an email into
  // the save modal (successfully or not), remember it so a later re-prompt
  // (different generation) is one tap, not re-typing.
  var EMAIL_STORAGE_KEY = 'appai_my_pet_email_v1';
  function readStoredEmail() {
    try { return String(window.localStorage.getItem(EMAIL_STORAGE_KEY) || ''); } catch (e) { return ''; }
  }
  function writeStoredEmail(value) {
    if (!value) return;
    try { window.localStorage.setItem(EMAIL_STORAGE_KEY, value); } catch (e) { /* localStorage disabled */ }
  }

  // UX 6 — same-device cross-session restore. Keyed by product + device key
  // (not just product) so two different devices/browsers sharing a computer
  // don't bleed into each other. Deliberately does NOT store previewUrl —
  // signed URLs expire in an hour; the server's resolve-render endpoint
  // re-signs on demand from the stored renderId.
  var RENDER_STORAGE_PREFIX = 'appai_my_pet_render_v1:';
  var RENDER_STORAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  function renderStorageKey(shopifyProductId) {
    var deviceKey = readStoredDeviceKey();
    var shortKey = deviceKey ? deviceKey.slice(0, 16) : 'anon';
    return RENDER_STORAGE_PREFIX + shopifyProductId + ':' + shortKey;
  }
  function readStoredRender(shopifyProductId) {
    try {
      var raw = window.localStorage.getItem(renderStorageKey(shopifyProductId));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.renderId || !parsed.savedAt) return null;
      if (Date.now() - parsed.savedAt > RENDER_STORAGE_MAX_AGE_MS) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function writeStoredRender(shopifyProductId, renderId, jobId) {
    try {
      window.localStorage.setItem(
        renderStorageKey(shopifyProductId),
        JSON.stringify({ renderId: renderId, jobId: jobId, savedAt: Date.now() }),
      );
    } catch (e) { /* localStorage disabled */ }
  }
  function clearStoredRender(shopifyProductId) {
    try { window.localStorage.removeItem(renderStorageKey(shopifyProductId)); } catch (e) {}
  }

  function proxyPath(path) {
    return '/apps/appai/' + path.replace(/^\//, '');
  }

  function postJson(path, body) {
    var payload = Object.assign({}, body || {});
    var key = readStoredDeviceKey();
    if (key && !payload.deviceKey) payload.deviceKey = key;
    return fetch(proxyPath(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(captureDeviceKeyFromResponse);
  }

  function getJson(path, params) {
    var query = Object.assign({}, params || {});
    var key = readStoredDeviceKey();
    if (key && !query.deviceKey) query.deviceKey = key;
    var keys = Object.keys(query);
    var qs = keys.length
      ? '?' + keys.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&')
      : '';
    return fetch(proxyPath(path) + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(captureDeviceKeyFromResponse);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function applyThemeVars(root) {
    try {
      var primary = document.querySelector(
        'button[name="add"], .product-form__submit, button.btn--primary, .btn--filled, ' +
        'button.button--primary, .product-form button[type="submit"], button[type="submit"]'
      );
      if (!primary) return;
      var cs = getComputedStyle(primary);
      // Polish 8 — filled CTA matching the theme's own Primary button, so Add
      // My Pet belongs instead of introducing a fourth competing red. Priority
      // (CSS side): --appai-my-pet-cta (set here ONLY when confident) →
      // theme's own --color-button-background setting-token → hardcoded
      // #D65857 named fallback. The Add-to-cart button sampled here is not
      // necessarily the same "Primary" button as a marketing hero CTA (some
      // themes, e.g. Ritual, use a dark Add-to-cart but a red Primary button
      // elsewhere) — only trust this sample when it's confidently red-family,
      // otherwise leave --appai-my-pet-cta unset so the CSS var() fallback
      // chain (theme token, then named token) decides instead of a wrong
      // dark/black override.
      var rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(cs.backgroundColor || '');
      if (rgb) {
        var r = Number(rgb[1]), g = Number(rgb[2]), b = Number(rgb[3]);
        var isRedFamily = r > g * 1.3 && r > b * 1.3 && r > 80;
        if (isRedFamily) {
          root.style.setProperty('--appai-my-pet-cta', cs.backgroundColor);
        }
      }
      root.style.setProperty('--appai-my-pet-radius', cs.borderRadius);
      // Intentionally NOT setting --appai-my-pet-caption-fg: the primary
      // button's text color is its *inside* color (white on a black Add to
      // cart), which painted the caption invisible on white page backgrounds.
      // The CSS fallback (#666666 gray) reads on both light and dark themes.
      var btn = root.querySelector('.appai-my-pet__button');
      if (btn) {
        btn.style.fontFamily = cs.fontFamily;
        btn.style.fontWeight = cs.fontWeight;
        btn.style.letterSpacing = cs.letterSpacing;
        btn.style.textTransform = cs.textTransform;
      }
    } catch (e) {
      console.warn(TAG, 'theme sampling failed', e);
    }
  }

  /**
   * UX 4 — default size should be a size available in every colour (M when
   * present), not whatever the theme happened to preselect. XS/Red/Sage/Blue
   * style gaps mean loading on XS leaves every colour swatch click with no
   * valid variant to land on. Only overrides when the CURRENT selection is
   * genuinely not-universal; leaves an already-fine selection alone (don't
   * fight a shopper or theme that already picked something sensible).
   */
  function preferUniversalSize(root) {
    var colors = allColorOptions(root);
    var sizes = allSizeOptions(root);
    if (colors.length < 2 || sizes.length < 2) return;
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    function availableInAllColors(size) {
      for (var i = 0; i < colors.length; i++) {
        var found = false;
        for (var j = 0; j < variants.length; j++) {
          var v = variants[j];
          var c = findOptionValue(v, optionNames, ['color', 'colour']);
          var s = findOptionValue(v, optionNames, ['size']);
          if (String(c) === String(colors[i]) && String(s) === String(size) && v.available !== false) {
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
      return true;
    }
    var universal = [];
    for (var k = 0; k < sizes.length; k++) {
      if (availableInAllColors(sizes[k])) universal.push(sizes[k]);
    }
    if (!universal.length) return; // no size exists in every colour — nothing sensible to default to
    var info = currentVariantInfo(root);
    if (info.sizeId && universal.indexOf(String(info.sizeId)) !== -1) return; // already universal — leave it
    var preferred = universal.indexOf('M') !== -1 ? 'M' : universal[0];
    var v = variantForSize(root, preferred, info.colorName);
    if (v && v.id && String(v.id) !== String(info.variantId)) {
      var form = document.querySelector('form[action*="/cart/add"]');
      var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
      if (idInput) {
        idInput.value = String(v.id);
        try { idInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
    }
  }

  /**
   * Bug 1b — strict lookup: returns a variant only when the requested options
   * match exactly AND Shopify reports it as purchasable (unlike
   * variantForColor/variantForSize, which fall back to "any variant with this
   * one option" for UI display purposes, and don't check availability at
   * all). Used right before ATC so an invalid/sold-out combination never
   * reaches the server — no "Shop not authorized"-style error for what's
   * actually just "not offered in that colour".
   *
   * BUG A (post-staging-89) — null-tolerant on either option so this also
   * handles products without a colour option, without a size option, or
   * with a single variant entirely (e.g. "Love what you've done with the
   * place" is one SKU). Passing null for an option means "don't filter on
   * it", so a single-variant product with (null, null) returns that one
   * available variant and ATC proceeds without the "Please pick a colour
   * and a size" refusal that was blocking the flow.
   */
  function findExactVariant(root, colorName, sizeId) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (v.available === false) continue;
      var c = findOptionValue(v, optionNames, ['color', 'colour']);
      var s = findOptionValue(v, optionNames, ['size']);
      var colorOk = colorName == null || String(c) === String(colorName);
      var sizeOk = sizeId == null || String(s) === String(sizeId);
      if (colorOk && sizeOk) return v;
    }
    return null;
  }

  function findOptionValue(variant, optionNames, wantedNames) {
    for (var i = 0; i < optionNames.length; i++) {
      var name = String(optionNames[i] || '').toLowerCase();
      if (wantedNames.indexOf(name) === -1) continue;
      var key = 'option' + (i + 1);
      if (variant[key] != null) return variant[key];
    }
    return null;
  }

  function currentVariantInfo(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var form = document.querySelector('form[action*="/cart/add"]');
    var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
    var variantId = idInput ? idInput.value : root.getAttribute('data-selected-variant');
    var variant = null;
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === String(variantId)) { variant = variants[i]; break; }
    }
    if (!variant) return { variantId: variantId, colorName: null, sizeId: null, price: null };
    var colorName = findOptionValue(variant, optionNames, ['color', 'colour']);
    var sizeId = findOptionValue(variant, optionNames, ['size']);
    return { variantId: variantId, colorName: colorName, sizeId: sizeId, price: variant.price != null ? (variant.price / 100).toFixed(2) : null };
  }

  /** All colour option values across the base product's variants (preserves order, deduped). */
  function allColorOptions(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var seen = {};
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var name = findOptionValue(variants[i], optionNames, ['color', 'colour']);
      if (!name || seen[name]) continue;
      seen[name] = true;
      out.push(String(name));
    }
    return out;
  }

  /** All size option values across the base product's variants (preserves order, deduped). */
  function allSizeOptions(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var seen = {};
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var size = findOptionValue(variants[i], optionNames, ['size']);
      if (size == null) continue;
      var key = String(size);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(key);
    }
    return out;
  }

  /** Find the first variant that matches the given colour (and current size if possible). */
  function variantForColor(root, colorName, preferSizeId) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var exact = null;
    var colorOnly = null;
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var c = findOptionValue(v, optionNames, ['color', 'colour']);
      if (String(c) !== String(colorName)) continue;
      if (!colorOnly) colorOnly = v;
      var s = findOptionValue(v, optionNames, ['size']);
      if (preferSizeId && String(s) === String(preferSizeId)) { exact = v; break; }
    }
    return exact || colorOnly;
  }

  /** Find the first variant that matches the given size (and current colour if possible). */
  function variantForSize(root, sizeId, preferColorName) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var exact = null;
    var sizeOnly = null;
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var s = findOptionValue(v, optionNames, ['size']);
      if (String(s) !== String(sizeId)) continue;
      if (!sizeOnly) sizeOnly = v;
      var c = findOptionValue(v, optionNames, ['color', 'colour']);
      if (preferColorName && String(c) === String(preferColorName)) { exact = v; break; }
    }
    return exact || sizeOnly;
  }

  function buildModal(opts) {
    var options = opts || {};
    var overlay = document.createElement('div');
    overlay.className = 'appai-my-pet-modal__overlay';
    overlay.innerHTML =
      '<div class="appai-my-pet-modal">' +
      '  <button type="button" class="appai-my-pet-modal__close" aria-label="Close">&times;</button>' +
      '  <div class="appai-my-pet-modal__body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.appai-my-pet-modal__close').addEventListener('click', function () {
      overlay.remove();
      if (typeof options.onClose === 'function') options.onClose();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        overlay.remove();
        if (typeof options.onClose === 'function') options.onClose();
      }
    });
    return { overlay: overlay, body: overlay.querySelector('.appai-my-pet-modal__body') };
  }

  function injectModalStyles() {
    if (document.getElementById('appai-my-pet-modal-style')) return;
    var style = document.createElement('style');
    style.id = 'appai-my-pet-modal-style';
    style.textContent =
      '.appai-my-pet-modal__overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;}' +
      '.appai-my-pet-modal{background:#fff;border-radius:8px;max-width:460px;width:100%;max-height:92vh;overflow:auto;position:relative;padding:1.5rem;}' +
      '.appai-my-pet-modal__close{position:absolute;top:0.5rem;right:0.75rem;background:none;border:none;font-size:1.5rem;cursor:pointer;line-height:1;z-index:2;}' +
      '.appai-my-pet-modal__body img.appai-preview-img{width:100%;border-radius:6px;display:block;margin:0.75rem 0;cursor:zoom-in;transition:opacity .15s ease;}' +
      // UX 5 — instant visual feedback the moment a colour swatch is tapped,
      // before the recomposite round-trip even starts.
      '.appai-my-pet-modal__body img.appai-preview-img.appai-swatch-loading{opacity:.6;cursor:wait;}' +
      '.appai-my-pet-swatches button[aria-busy="true"]{opacity:.6;cursor:wait;}' +
      '.appai-my-pet-modal__body img.appai-thumb{max-width:140px;border-radius:6px;display:block;margin:0.5rem auto;cursor:zoom-in;}' +
      '.appai-my-pet-modal__body button.appai-primary{display:block;width:100%;padding:0.75em;margin-top:0.5rem;border-radius:4px;border:none;background:#111;color:#fff;font-weight:600;cursor:pointer;}' +
      '.appai-my-pet-modal__body button.appai-primary:disabled{opacity:.6;cursor:not-allowed;}' +
      '.appai-my-pet-modal__body button.appai-secondary{display:block;width:100%;padding:0.75em;margin-top:0.5rem;border-radius:4px;border:1px solid #ccc;background:#fff;color:#111;cursor:pointer;}' +
      '.appai-my-pet-modal__body button.appai-secondary:disabled{opacity:.6;cursor:not-allowed;}' +
      // Polish F — smaller outlined variant retained for the "change" link
      // in the upload modal (after a photo is picked) and any other secondary
      // escape hatches.
      '.appai-my-pet-modal__body button.appai-secondary--sm{padding:0.5em 0.9em;font-size:.88em;margin-top:0.35rem;color:#555;border-color:#d8d8d8;}' +
      '.appai-my-pet-modal__body .appai-my-pet-footnote{font-size:.72em;color:#888;text-align:center;margin:0.55rem 0 0;line-height:1.4;}' +
      // Polish REVERT — single primary + checkbox pattern for the save modal.
      // Consent row sits BELOW the email input, ABOVE the primary CTA so the
      // shopper reads the exchange (newsletter opt-in = +2 bonus) before
      // clicking Send.
      '.appai-my-pet-modal__body label.appai-my-pet-consent{display:flex;align-items:center;gap:0.5em;margin:0.6em 0 0.3em;font-size:.88em;color:#333;cursor:pointer;line-height:1.35;}' +
      '.appai-my-pet-modal__body label.appai-my-pet-consent input[type=checkbox]{flex:0 0 auto;margin:0;}' +
      // Polish — brand-red styled file picker. Hides the native "Choose file |
      // No file chosen" chrome and overlays a <label> that acts as a filled
      // CTA (same red family as the My Pet button itself via the same CSS
      // var chain). "change" link only appears once a file is selected.
      '.appai-my-pet-modal__body .appai-my-pet-file-row{margin:0.75rem 0;}' +
      '.appai-my-pet-modal__body input.appai-my-pet-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);pointer-events:none;}' +
      '.appai-my-pet-modal__body label.appai-my-pet-file-cta{display:flex;align-items:center;justify-content:center;gap:0.5em;padding:0.85em 1.5em;border-radius:var(--appai-my-pet-radius,4px);background:var(--appai-my-pet-cta,var(--color-button-background,var(--appai-my-pet-cta-fallback,#D65857)));color:var(--color-button-text,#fff);font-weight:600;cursor:pointer;line-height:1.2;text-align:center;}' +
      '.appai-my-pet-modal__body label.appai-my-pet-file-cta:hover{opacity:.85;}' +
      '.appai-my-pet-modal__body label.appai-my-pet-file-cta[data-state="picked"]{background:#f3f3f3;color:#222;flex-direction:column;gap:0.15em;padding:0.65em 1em;}' +
      '.appai-my-pet-modal__body .appai-my-pet-file-cta__filename{font-size:.82em;color:#555;font-weight:400;overflow:hidden;text-overflow:ellipsis;max-width:100%;white-space:nowrap;}' +
      '.appai-my-pet-modal__body label.appai-my-pet-file-cta[data-state="empty"] .appai-my-pet-file-cta__filename{display:none;}' +
      '.appai-my-pet-modal__body button.appai-my-pet-file-change{display:block;margin:0.4em auto 0;background:none;border:none;color:#666;text-decoration:underline;font-size:.82em;cursor:pointer;padding:0.1em 0.3em;}' +
      '.appai-my-pet-modal__body button.appai-my-pet-file-change[hidden]{display:none;}' +
      '.appai-my-pet-modal__body input[type=email]{display:block;width:100%;padding:0.6em;margin-top:0.5rem;border:1px solid #ccc;border-radius:4px;}' +
      '.appai-my-pet-modal__body .appai-my-pet-msg{color:#444;text-align:center;margin:0.5rem 0;}' +
      '.appai-my-pet-modal__body label{display:flex;align-items:center;gap:0.4em;font-size:0.85em;margin-top:0.5em;}' +
      // Colour swatches row inside the preview modal
      '.appai-my-pet-swatches{display:flex;flex-wrap:wrap;gap:.4em;justify-content:center;margin:.6rem 0;}' +
      '.appai-my-pet-swatches button{border:2px solid transparent;background:#f3f3f3;padding:.35em .7em;border-radius:999px;cursor:pointer;font-size:.85em;color:#222;}' +
      '.appai-my-pet-swatches button[aria-current="true"]{border-color:#111;background:#fff;}' +
      // Progress bar — indeterminate to determinate
      '.appai-progress{width:100%;height:6px;background:#eee;border-radius:3px;overflow:hidden;margin:.6rem 0;}' +
      '.appai-progress>span{display:block;height:100%;background:#111;width:0;transition:width .6s linear;}' +
      // Attempts remaining caption
      '.appai-attempts{font-size:.8em;color:#666;text-align:center;margin-top:.5rem;}' +
      // Zoom overlay (preview full-screen)
      '.appai-zoom-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100001;display:flex;align-items:center;justify-content:center;padding:1rem;cursor:zoom-out;}' +
      '.appai-zoom-overlay img{max-width:95vw;max-height:95vh;display:block;}';
    document.head.appendChild(style);
  }

  function showZoom(src) {
    var z = document.createElement('div');
    z.className = 'appai-zoom-overlay';
    z.innerHTML = '<img src="' + src + '" alt="Your design" />';
    z.addEventListener('click', function () { z.remove(); });
    document.body.appendChild(z);
  }

  /**
   * Bug D — after a successful ATC, re-render the cart drawer via Shopify's
   * Section Rendering API, dispatch the common theme/app cart events, and
   * try to open the drawer. The old code just dispatched `cart:refresh`
   * (our own appai-cart-images.js listens for that to re-paint mockup
   * thumbnails), but the theme's own cart drawer never re-fetched its
   * content or opened, so the shopper had to navigate to /cart manually.
   *
   * Approach — belt-and-braces across theme variants:
   *   1) Fetch /cart with ?sections=<drawer-section-ids> to get freshly
   *      rendered HTML for each (section id is theme-specific, so we try
   *      several known ones from Dawn / Horizon / Impulse / Ritual).
   *   2) Swap the returned HTML into the matching <div id="shopify-section-X">
   *      wrappers already in the page.
   *   3) Dispatch every cart event name we've seen themes listen for.
   *   4) Try to call .open() / .show() on any <cart-drawer*> custom element.
   */
  // Section Rendering API returns 400 for the WHOLE request if ANY one
  // requested section id does not exist in the active theme. Ritual doesn't
  // ship cart-notification / cart-icon-bubble / cart-live-region-text /
  // cart-drawer-items (all Dawn/Horizon-specific), so the old "ask for all
  // 6 at once" call failed on Ritual even though cart-drawer and header DO
  // exist — the shopper never saw the cart drawer refresh.
  //
  // Fix: probe each candidate section independently (parallel), keep the
  // ones that answer 2xx, then make the real render call with only those.
  // Result cached in sessionStorage so we probe once per tab, not per ATC.
  // If zero sections are known-available, skip the render fetch entirely
  // and go straight to the cart-toggle / drawer-method fallback.
  var CART_SECTIONS_SESSION_KEY = 'appai-my-pet:cart-sections';
  var CART_SECTIONS_CANDIDATES = [
    'cart-drawer',            // Dawn, Ritual, most Horizon descendants
    'cart-drawer-items',      // Horizon fragment
    'cart-notification',      // Dawn
    'cart-icon-bubble',       // Dawn / Horizon header bubble
    'cart-live-region-text',  // Dawn ARIA live region
    'header',                 // most themes — refreshes the cart count
    'cart',                   // some older themes
  ];
  function discoverCartSections() {
    try {
      var cached = sessionStorage.getItem(CART_SECTIONS_SESSION_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          console.log(TAG, 'cart-sections cache hit:', parsed);
          return Promise.resolve(parsed);
        }
      }
    } catch (_) { /* sessionStorage disabled → re-probe */ }
    console.log(TAG, 'cart-sections probing');
    return Promise.all(
      CART_SECTIONS_CANDIDATES.map(function (name) {
        // Section Rendering API ignores the body, so a tiny GET is fine.
        return fetch('/?sections=' + encodeURIComponent(name), { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? name : null; })
          .catch(function () { return null; });
      })
    ).then(function (results) {
      var available = results.filter(Boolean);
      console.log(TAG, 'cart-sections available:', available);
      try { sessionStorage.setItem(CART_SECTIONS_SESSION_KEY, JSON.stringify(available)); } catch (_) {}
      return available;
    });
  }

  function refreshAndOpenCartDrawer() {
    console.log(TAG, 'refreshAndOpenCartDrawer start');
    discoverCartSections().then(function (available) {
      if (!available.length) {
        // Theme has none of our known sections — skip the render fetch and
        // fall straight to event dispatch + cart-toggle click below.
        console.log(TAG, 'no known cart sections — skipping render fetch');
        return null;
      }
      var url = '/?sections=' + encodeURIComponent(available.join(','));
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        console.log(TAG, 'section fetch status:', r.status, r.ok);
        return r.ok ? r.json() : null;
      });
    })
      .then(function (sections) {
        console.log(TAG, 'sections received:', sections ? Object.keys(sections) : null);
        if (sections && typeof sections === 'object') {
          Object.keys(sections).forEach(function (name) {
            var html = sections[name];
            if (typeof html !== 'string' || !html) {
              console.log(TAG, 'section', name, 'empty/missing');
              return;
            }
            var target = document.getElementById('shopify-section-' + name);
            if (!target) {
              console.log(TAG, 'section', name, 'no target wrapper (shopify-section-' + name + ') in DOM');
              return;
            }
            var templ = document.createElement('template');
            templ.innerHTML = html;
            var newRoot = templ.content.getElementById('shopify-section-' + name);
            if (newRoot) {
              target.replaceWith(newRoot);
              console.log(TAG, 'section', name, 'replaced via wrapper');
            } else {
              // Some themes return the section body directly, not wrapped.
              target.innerHTML = html;
              console.log(TAG, 'section', name, 'inner HTML swapped');
            }
          });
        }
      })
      .catch(function (err) {
        console.warn(TAG, 'section fetch/apply failed:', err && err.message);
      })
      .then(function () {
        // Fire the union of cart-updated event names different themes listen for.
        var EVENTS = [
          'cart:refresh', 'cart:updated', 'cart:update', 'cart:build',
          'cart:item-added', 'cart-updated', 'appai:cart-updated',
          'ajaxProduct:added', 'product:added', 'cart:open',
          // Horizon / Ritual-family add these
          'cart:open-drawer', 'cart-drawer:open', 'cart:toggle',
        ];
        for (var i = 0; i < EVENTS.length; i++) {
          try { document.dispatchEvent(new CustomEvent(EVENTS[i], { bubbles: true, detail: { source: 'appai-my-pet' } })); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent(EVENTS[i], { bubbles: true, detail: { source: 'appai-my-pet' } })); } catch (e) {}
        }
        // Try to open any cart-drawer custom element directly.
        var DRAWER_SELECTORS = [
          'cart-drawer-component', 'cart-drawer', 'cart-notification',
          '[id*="CartDrawer"]', '[id*="cart-drawer"]',
          // Native <dialog> inside a drawer wrapper (Horizon pattern)
          'cart-drawer-component dialog', 'cart-drawer dialog',
          'dialog[id*="cart" i]', 'dialog[aria-labelledby*="cart" i]',
        ];
        for (var d = 0; d < DRAWER_SELECTORS.length; d++) {
          var nodes;
          try { nodes = document.querySelectorAll(DRAWER_SELECTORS[d]); } catch (e) { continue; }
          console.log(TAG, 'drawer selector', DRAWER_SELECTORS[d], 'matched', nodes.length, 'node(s)');
          for (var n = 0; n < nodes.length; n++) {
            var el = nodes[n];
            var opened = false;
            // Try every method name a theme might expose. First one that
            // doesn't throw AND returns truthy or undefined wins.
            var METHODS = ['showCartDrawer', 'openDrawer', 'openCart', 'open', 'show', 'showDialog', 'showModal'];
            for (var m = 0; m < METHODS.length; m++) {
              var fn = el[METHODS[m]];
              if (typeof fn === 'function') {
                try { fn.call(el); opened = true; console.log(TAG, 'drawer opened via', METHODS[m]); break; } catch (e) {}
              }
            }
            if (!opened) {
              // Attribute toggle as last resort.
              try {
                el.setAttribute('open', '');
                el.setAttribute('aria-hidden', 'false');
                el.removeAttribute('inert');
                console.log(TAG, 'drawer opened via attribute toggle');
              } catch (e) {}
            }
            // Also dispatch 'show' / 'open' directly on the element — some
            // themes wire their drawer open to an element-level event rather
            // than a method.
            var ELEMENT_EVENTS = ['show', 'open', 'cart:open', 'cart:show'];
            for (var e2 = 0; e2 < ELEMENT_EVENTS.length; e2++) {
              try { el.dispatchEvent(new CustomEvent(ELEMENT_EVENTS[e2], { bubbles: true, detail: { source: 'appai-my-pet' } })); } catch (_) {}
            }
          }
        }
        // Last-ditch: simulate a click on the theme's cart-toggle button. Ritual
        // and most Dawn descendants wire ATC → drawer through a hidden toggle
        // the header surface shares.
        var TOGGLE_SELECTORS = [
          '[data-cart-drawer-toggle]', '[data-cart-drawer-open]',
          'a[href="/cart"][aria-controls]', '[aria-controls*="cart-drawer" i]',
          '[data-open-cart-drawer]', '.js-drawer-open-cart',
        ];
        for (var t = 0; t < TOGGLE_SELECTORS.length; t++) {
          var toggle;
          try { toggle = document.querySelector(TOGGLE_SELECTORS[t]); } catch (e) { continue; }
          if (toggle && typeof toggle.click === 'function') {
            console.log(TAG, 'clicking cart-toggle:', TOGGLE_SELECTORS[t]);
            try { toggle.click(); break; } catch (e) {}
          }
        }
      });
  }

  function init(root) {
    injectModalStyles();
    applyThemeVars(root);

    var candidateId = root.getAttribute('data-candidate-id');
    var shopifyProductId = root.getAttribute('data-product-id');
    var pageUrl = root.getAttribute('data-page-url') || window.location.href;
    // UX 7 — "modal" (default, legacy popup) or "inline" (Ritual-scoped
    // experimental: replace the PDP hero img directly, use the theme's own
    // native colour/size swatches instead of our custom modal swatches).
    // If inline mode can't find the theme's hero image at generate time,
    // activateInlinePreview returns false and the modal takes over.
    var previewMode = (root.getAttribute('data-preview-mode') || 'modal').toLowerCase();
    var openBtn = root.querySelector('[data-appai-my-pet-open]');
    var caption = root.querySelector('.appai-my-pet__caption');
    // Issue 7 (post-staging-93) — snapshot the merchant-configured button
    // label before we relabel it to "Try another photo" on activate, so
    // revertToOriginalDesign can restore it exactly. Falls back to "My Pet"
    // to match the liquid default when the button is missing text.
    var openBtnOriginalLabel = openBtn ? (openBtn.textContent || 'My Pet').trim() : 'My Pet';
    // Revert link element — appended once after the button and shown only
    // while inlineApplied is true. Styled to read as secondary de-emphasised
    // text (brand red link, smaller, no bold) so the primary CTA still wins.
    var revertLink = null;
    function ensureRevertLink() {
      if (revertLink || !openBtn || !openBtn.parentNode) return revertLink;
      revertLink = document.createElement('button');
      revertLink.type = 'button';
      revertLink.className = 'appai-my-pet__revert';
      revertLink.setAttribute('data-appai-my-pet-revert', '1');
      revertLink.textContent = 'Buy the original design instead';
      revertLink.hidden = true;
      revertLink.style.cssText =
        'display:block;margin:6px auto 0;padding:0;background:none;border:0;' +
        'color:#D65857;font-size:12px;line-height:1.4;' +
        'text-decoration:underline;cursor:pointer;';
      revertLink.addEventListener('click', function () { revertToOriginalDesign(); });
      // Place AFTER the caption if present (keeps button + caption together)
      // or directly after the button.
      var anchor = caption && caption.parentNode === openBtn.parentNode ? caption : openBtn;
      if (anchor.nextSibling) anchor.parentNode.insertBefore(revertLink, anchor.nextSibling);
      else anchor.parentNode.appendChild(revertLink);
      return revertLink;
    }
    function showRevertLink() { ensureRevertLink(); if (revertLink) revertLink.hidden = false; }
    function hideRevertLink() { if (revertLink) revertLink.hidden = true; }
    // Theme-setting subtitle ("See your pet on this design") captured once at
    // init, so refreshCapStatus can restore it whenever the shopper hasn't
    // generated on this product yet. Falls back to the current text content
    // for older liquid versions that don't emit the data-subtitle attribute.
    var defaultSubtitle = caption
      ? (caption.getAttribute('data-subtitle') || caption.textContent || '')
      : '';
    if (!openBtn) return;

    // UX 4 — run once on init, before anything else reads the form's variant.
    preferUniversalSize(root);

    // state.previewUrl: so re-opening the Add My Pet button on a device that
    //   already generated this visit re-shows the preview instead of silently
    //   doing nothing (bug #2).
    // state.capStatus: server's latest view of remaining attempts, used to
    //   gate "Try another photo" client-side and label the button caption.
    // state.dismissedRenderIds: per-render exit-intent dismissal (bug 10) —
    //   keyed by renderId so "said no once" only suppresses THAT design, not
    //   every design the shopper generates this session.
    // state.emailModalOpen: re-entrancy guard — mouseleave can fire repeatedly
    //   before the shopper reacts; without this a second call stacks a second
    //   modal on top of the first.
    var state = {
      renderId: null,
      jobId: null,
      previewUrl: null,
      dismissedRenderIds: {},
      emailModalOpen: false,
      capStatus: null,
      // Bugs B/C — the modal tracks its own swatch selection independently of
      // the PDP form's variant id. variantForColor/variantForSize fell back to
      // "any variant with just this one option" when the exact (colour, size)
      // didn't exist, which silently reshuffled the form to a different combo
      // (XS/Pink click → form switches to S/Pink or XS/Black). Separating
      // intent (what the shopper selected) from state (what Shopify can sell)
      // lets us refuse an invalid combo instead of swapping it out from under
      // the shopper. Initialised in renderPreviewBody from currentVariantInfo.
      swatchColor: null,
      swatchSize: null,
      // Bug A — per-colour client cache keyed by colour name, holding the
      // signed preview URL from the last successful recomposite in this modal
      // session. Repeat swaps swap images without any network round-trip.
      // Session-scoped (dropped when the modal closes); 1hr signed URL TTL
      // always outlives a modal session, so no expiry bookkeeping needed.
      previewUrlByColor: {},
      // UX 7 inline mode — populated by activateInlinePreview. inlineHero is
      // the PDP <img> we swapped. inlineAttached indicates the ATC intercept +
      // hero MutationObserver + variant-event listeners have been installed
      // so we don't double-install. inlineGuardBackupTimer re-finds the hero
      // every 1.5s when the theme replaces the <img> node outright.
      inlineHero: null,
      // Issue 4 (post-staging-92) — childList observer on the gallery
      // container; swaps opacity:0 + runs installHeroGuard before paint so
      // Ritual's "replace hero <img> on variant change" never flashes the
      // stock variant image.
      inlineGalleryObserver: null,
      // Issue 7 (post-staging-93) — separates "inline has ever been attached
      // this session" (inlineAttached; one-time ATC/listener install flag)
      // from "the preview is currently swapped onto the hero right now"
      // (inlineApplied). Revert sets inlineApplied=false without touching
      // inlineAttached/renderId/previewUrl, so re-clicking the My Pet button
      // re-activates the existing render on the hero without re-uploading
      // or consuming another cap attempt.
      inlineApplied: false,
      inlineAttached: false,
      inlineGuardBackupTimer: null,
    };

    function markDismissed(renderId) {
      if (renderId) state.dismissedRenderIds[renderId] = true;
    }
    function isDismissed(renderId) {
      return !!(renderId && state.dismissedRenderIds[renderId]);
    }

    function showMessage(body, message) {
      body.innerHTML = '<p class="appai-my-pet-msg">' + message + '</p>';
    }

    /**
     * Bugs 3 + 11 — single source of truth for the "X remaining" string so
     * the page caption and the modal subtitle can never disagree (both read
     * the exact same capStatus object through this one formatter). Also
     * surfaces the email bonus explicitly ("(incl. 2 email bonus)") instead
     * of a silently-higher number that looks like miscounting.
     */
    function formatAttemptsMessage(capStatus) {
      if (!capStatus) return '';
      if (capStatus.allowed === false) {
        return capStatus.message || 'No more tries on this design.';
      }
      var remaining = capStatus.perListingRemaining;
      if (typeof remaining !== 'number') return '';
      if (remaining <= 0) {
        // Polish E — matches the newsletter framing in evaluateMyPetCap on the
        // server. The ask is a signup, not a paywall; the mechanic (email
        // submission → +emailBonus attempts) is unchanged.
        return capStatus.emailBonusAvailable
          ? 'Sign up to the Petposterous Press for 2 more custom designs.'
          : 'No more tries on this design.';
      }
      var limit = capStatus.perListingLimit;
      var bonusSuffix =
        capStatus.emailBonusApplied && capStatus.emailBonusAmount > 0
          ? ' (incl. ' + capStatus.emailBonusAmount + ' email bonus)'
          : '';
      var noun = remaining === 1 ? ' free design remaining' : ' free designs remaining';
      return (typeof limit === 'number' ? remaining + ' of ' + limit : remaining) + noun + bonusSuffix + '.';
    }

    function renderAttemptsCaption(capStatus) {
      if (!caption || !capStatus) return;
      // Subtitle-vs-cap-caption swap: show the theme-setting subtitle to
      // anyone who hasn't generated on this product yet (selling copy for a
      // fresh visitor), and the cap caption only once an attempt has actually
      // been used (status copy for a returning/already-tried shopper). Both
      // messages matter, but to different audiences — never both at once,
      // never one overwriting the other.
      var hasGenerated = typeof capStatus.perListingCount === 'number' && capStatus.perListingCount > 0;
      if (!hasGenerated) {
        caption.textContent = defaultSubtitle;
        caption.classList.remove('appai-shimmer');
        openBtn.removeAttribute('aria-disabled');
        return;
      }
      caption.textContent = formatAttemptsMessage(capStatus);
      if (capStatus.allowed === false) {
        openBtn.setAttribute('aria-disabled', 'true');
        caption.classList.remove('appai-shimmer');
        return;
      }
      openBtn.removeAttribute('aria-disabled');
      var remaining = capStatus.perListingRemaining;
      // Polish 9 — shimmer only on the inviting "you have tries left" state;
      // not on "no more tries" (that's a stop, not a draw-the-eye moment).
      if (typeof remaining === 'number' && remaining > 0) {
        caption.classList.add('appai-shimmer');
      } else {
        caption.classList.remove('appai-shimmer');
      }
    }

    function refreshCapStatus() {
      return getJson('my-pet/cap-status', { productId: shopifyProductId })
        .then(function (status) {
          state.capStatus = status || null;
          renderAttemptsCaption(state.capStatus);
          return state.capStatus;
        })
        .catch(function () { return null; });
    }

    // UX 6 — restore a same-device, cross-session render on page load so
    // "Add My Pet" reopens the existing preview instead of offering a fresh
    // (cap-consuming) generation. Async; if the shopper clicks the button
    // before this resolves, the normal upload flow runs instead — acceptable,
    // low-likelihood race, next click will have it.
    (function restoreStoredRender() {
      var stored = readStoredRender(shopifyProductId);
      if (!stored) return;
      getJson('my-pet/resolve-render', { renderId: stored.renderId })
        .then(function (res) {
          if (res && res.ok && res.previewUrl) {
            state.renderId = res.renderId;
            state.jobId = res.jobId;
            state.previewUrl = res.previewUrl;
            state.previewUrlByColor = {}; // Bug A: different render — drop any session cache
            // UX 7 — restore the inline hero swap on return visits so the
            // shopper sees "their" product straight away without having to
            // click the button again. Server cache keeps per-colour swaps
            // fast even though we don't have the full colour map here.
            if (previewMode === 'inline') {
              activateInlinePreview(res.previewUrl);
            }
          } else {
            clearStoredRender(shopifyProductId);
          }
        })
        .catch(function () { /* leave stored entry; try again next load */ });
    })();

    // ─────────────────────────────────────────────────────────────────────
    // UX 7 — inline preview mode (Ritual-scoped experimental)
    //
    // Flow:
    //   generate success → activateInlinePreview(previewUrl)
    //     → find PDP hero <img> → swap src to preview
    //     → install native swatch watcher (variant form change → recomposite)
    //     → install native ATC intercept (click → resolve-variant → cart/add)
    //     → relabel My Pet open button to "Try another photo"
    //   subsequent generate → activateInlinePreview is re-called; it short-
    //     circuits the one-time installs via state.inlineAttached but always
    //     swaps the hero to the fresh preview.
    //
    // Fall-back: findProductHeroImg returns null → returns false → caller
    // (upload generate handler) opens the modal instead. Merchant can
    // forcibly switch back to modal via the block setting at any time.
    // ─────────────────────────────────────────────────────────────────────

    function preloadPreviewUrls(urlsByColor) {
      if (!urlsByColor) return;
      var urls = [];
      try {
        for (var key in urlsByColor) {
          if (Object.prototype.hasOwnProperty.call(urlsByColor, key)) {
            var u = urlsByColor[key];
            if (typeof u === 'string' && u.indexOf('http') === 0) urls.push(u);
          }
        }
      } catch (e) {}
      if (!urls.length) return;
      console.log(TAG, 'preloading', urls.length, 'colour URLs');
      for (var i = 0; i < urls.length; i++) {
        try {
          var img = new Image();
          img.decoding = 'async';
          img.src = urls[i];
        } catch (e) {}
      }
    }

    function findProductHeroImg() {
      // Priority list: most-specific (is-active media item) → broad
      // (product section <img>). Skip anything inside our own block so we
      // don't accidentally swap our own thumbnail.
      var SELECTORS = [
        '.product__media-item.is-active img',
        '.product__media.is-active img',
        '[data-media-id].is-active img',
        '.product__media-item img',
        '.product__media img',
        '[data-product-featured-image]',
        '.product-featured-media img',
        '.product__main-photos img',
        '.product-gallery__image',
        '.product-single__photo img',
        '.product__photo img',
        '.product-image img',
        '.product-single__media img',
        '[data-media-id] img',
        '.product-gallery img',
        '.product__images img',
        '.product-images img',
      ];
      for (var i = 0; i < SELECTORS.length; i++) {
        var el;
        try { el = document.querySelector(SELECTORS[i]); } catch (e) { continue; }
        if (el && el.tagName === 'IMG' && !el.closest('.appai-my-pet')) return el;
      }
      return null;
    }

    function swapInlineHero(hero, url) {
      if (!url) return;
      // Theme section re-renders (Shopify Section Rendering API, Horizon's
      // media-gallery component swap, etc.) can detach the <img> we cached.
      // If our reference is detached, look it up fresh so we still land on
      // a visible node.
      if (!hero || !document.body.contains(hero)) {
        hero = findProductHeroImg();
        if (!hero) return;
        state.inlineHero = hero;
      }
      // Preserve the original blank so a later "Try another photo" abort or a
      // theme section re-render can reset to the merchant's own hero image.
      if (!hero.hasAttribute('data-appai-my-pet-original-src')) {
        hero.setAttribute('data-appai-my-pet-original-src', hero.getAttribute('src') || '');
        var origSrcset = hero.getAttribute('srcset');
        if (origSrcset) hero.setAttribute('data-appai-my-pet-original-srcset', origSrcset);
      }
      try { hero.src = url; } catch (e) {}
      try { hero.removeAttribute('srcset'); } catch (e) {}
      // Clear theme lazy-loaders so they don't overwrite our src on next scroll.
      if (hero.dataset) {
        try { delete hero.dataset.src; } catch (e) {}
        try { delete hero.dataset.srcset; } catch (e) {}
      }
      hero.setAttribute('data-appai-my-pet-preview', 'true');
    }

    /**
     * BUGs B + C (post-staging-90) — single entry point for the "Try another
     * photo" interaction, shared across:
     *   - inline mode's My Pet button (relabeled to "Try another photo" once
     *     activateInlinePreview has swapped the hero)
     *   - modal mode's change-photo button inside the preview modal
     *
     * Cap-aware branching:
     *   under cap                   → openUploadStep()
     *   at cap, no marketing consent → maybePromptEmailSave({force,trigger})
     *                                  — the honest cap-gate ask: consent
     *                                  checkbox → +2 bonus, same mechanic
     *                                  as exit-intent but triggered when
     *                                  the shopper is directly asking for
     *                                  more (highest intent moment)
     *   at cap, consent already given → show "you've used all your designs
     *                                   for this product" terminal message
     *
     * Logging on every branch so a silent fail becomes visible — BUG B
     * symptom was "no modal opens, no error, no console log", which could
     * mean handler not firing OR handler short-circuiting silently. These
     * logs disambiguate.
     *
     * fromModalBody: when called from the preview modal's change-photo
     * button, we pass the modal body so we can close it before opening the
     * next step (upload modal, save modal, or terminal message).
     */
    function tryAnotherPhoto(fromModalBody) {
      console.log(TAG, 'Try another photo clicked', {
        inline: state.inlineApplied,
        renderId: state.renderId ? state.renderId.slice(0, 8) : null,
        fromModal: !!fromModalBody,
      });
      refreshCapStatus().then(function (cap) {
        var count = (cap && typeof cap.perListingCount === 'number') ? cap.perListingCount : 0;
        var limit = (cap && typeof cap.perListingLimit === 'number') ? cap.perListingLimit : Number.POSITIVE_INFINITY;
        var bonusApplied = !!(cap && cap.emailBonusApplied);
        var atCap = !cap || cap.allowed === false || count >= limit;
        console.log(TAG, 'Try another photo cap decision', {
          count: count, limit: limit, bonusApplied: bonusApplied, atCap: atCap,
        });

        if (!atCap) {
          console.log(TAG, 'Try another photo → openUploadStep');
          closeIfModalBody(fromModalBody);
          openUploadStep();
          return;
        }

        if (!bonusApplied) {
          console.log(TAG, 'Try another photo at cap, no bonus → save modal');
          closeIfModalBody(fromModalBody);
          maybePromptEmailSave({ force: true, trigger: 'try-another-photo' });
          return;
        }

        console.log(TAG, 'Try another photo at cap, bonus already applied → terminal message');
        showCapTerminalMessage(fromModalBody, cap);
      });
    }

    function closeIfModalBody(body) {
      if (!body) return;
      var overlay = body.closest && body.closest('.appai-my-pet-modal__overlay');
      if (overlay) overlay.remove();
    }

    function showCapTerminalMessage(fromModalBody, cap) {
      var copy = (cap && cap.message) || "You've used all your custom designs for this product. New designs are available on the Petposterous Press each week.";
      // In inline mode with no modal open, surface via caption.
      if (!fromModalBody && caption) {
        caption.textContent = copy;
        caption.classList.remove('appai-shimmer');
      }
      // Always also show a lightweight modal so the shopper sees a clear
      // dead-end message regardless of where they clicked from — avoids the
      // "clicked a button and nothing happened" ambiguity that was BUG B.
      var modal = buildModal();
      modal.body.innerHTML =
        '<h3>All done on this design</h3>' +
        '<p class="appai-my-pet-msg">' + copy + '</p>' +
        '<button type="button" class="appai-primary" data-action="close-terminal">Close</button>';
      modal.body.querySelector('[data-action="close-terminal"]').addEventListener('click', function () {
        modal.overlay.remove();
      });
      closeIfModalBody(fromModalBody);
    }

    function activateInlinePreview(previewUrl) {
      var hero = state.inlineHero || findProductHeroImg();
      if (!hero) return false;
      state.inlineHero = hero;
      swapInlineHero(hero, previewUrl);
      // MutationObserver install/refresh on EVERY activation — even when
      // already attached, because the hero node may have been replaced since
      // the last activation (theme section re-render, "Try another photo"
      // flow re-generating). swapInlineHero already re-finds a detached hero.
      installHeroGuard(state.inlineHero);
      // ISSUE 4 (post-staging-92) — fast path for gallery re-renders: when
      // the theme replaces the hero node outright (Ritual does this on every
      // variant change), the gallery-childList observer runs assert() in the
      // same microtask as insertion, so the shopper never sees a flash of
      // the stock image. Idempotent — safe to re-install on every activation.
      installGalleryGuard();
      // Issue 7 — inlineApplied gates every observer / listener / ATC
      // intercept so revertToOriginalDesign can turn them off without
      // tearing down the one-time installs below.
      state.inlineApplied = true;
      // Relabel + show revert link every activation (idempotent).
      if (openBtn) {
        openBtn.textContent = 'Try another photo';
        openBtn.setAttribute('data-appai-my-pet-inline-active', '1');
        openBtn.removeAttribute('aria-disabled');
      }
      showRevertLink();
      if (state.inlineAttached) return true;
      state.inlineAttached = true;
      installInlineVariantListeners();
      installInlineATCIntercept();
      return true;
    }

    /**
     * Issue 7 (post-staging-93) — "Buy the original design instead" link
     * reverts the inline hero swap without discarding the generated render.
     *
     *   - Restores src/srcset from data-appai-my-pet-original-src(set) that
     *     swapInlineHero stashed at activation time (captured per-node, so
     *     this works even after Ritual replaced the hero during variant
     *     changes — the latest live node still has its own stash).
     *   - Disconnects the hero + gallery MutationObservers and clears the
     *     1.5s element-replacement backup poll so nothing re-asserts the
     *     preview src behind the shopper's back.
     *   - Clears state.inlineApplied + state.inlineHero so the ATC intercept
     *     and variant listeners short-circuit (they test inlineApplied).
     *     Leaves state.inlineAttached untouched so those listeners don't
     *     get re-installed twice if the shopper re-activates.
     *   - Keeps state.renderId / previewUrl / previewUrlByColor so
     *     re-clicking the My Pet button instantly re-activates the same
     *     render on the hero — no re-upload, no second cap attempt.
     *   - Relabels the button back to its merchant-configured label and
     *     hides the revert link.
     *
     * ATC in the reverted state: form submits/clicks still bubble through
     * the capture-phase intercept, but the inlineApplied/inlineHero guard
     * returns early so the theme's native cart/add runs with no appai
     * _design_id, _appai_my_pet_render_id, _appai_job_id or _mockup_url
     * line-item properties. The shopper buys the stock product cleanly.
     * (Do not spell it with an asterisk-slash in this JSDoc — closes the
     * block comment early and breaks the whole file parse — staging-94.)
     */
    function revertToOriginalDesign() {
      console.log(TAG, 'revert to original design');
      // 1. Disconnect observers + stop backup poll BEFORE touching src so
      //    the observers don't see our restoration as a "theme stole the
      //    preview" mutation and re-assert back to preview.
      var staleHero = state.inlineHero;
      if (staleHero && staleHero.__appaiMyPetObserver) {
        try { staleHero.__appaiMyPetObserver.disconnect(); } catch (_) {}
        try { delete staleHero.__appaiMyPetObserver; } catch (_) { staleHero.__appaiMyPetObserver = null; }
      }
      if (state.inlineGalleryObserver) {
        try { state.inlineGalleryObserver.disconnect(); } catch (_) {}
        state.inlineGalleryObserver = null;
      }
      if (state.inlineGuardBackupTimer) {
        clearInterval(state.inlineGuardBackupTimer);
        state.inlineGuardBackupTimer = null;
      }
      // 2. Restore src/srcset on the CURRENT live hero (may differ from the
      //    staleHero reference if the theme replaced the node during the
      //    session — latest swapInlineHero call stashed the current node's
      //    own original on it).
      var live = findProductHeroImg();
      if (live && live.hasAttribute('data-appai-my-pet-original-src')) {
        var origSrc = live.getAttribute('data-appai-my-pet-original-src') || '';
        var origSrcset = live.getAttribute('data-appai-my-pet-original-srcset') || '';
        try { if (origSrc) live.src = origSrc; } catch (_) {}
        try {
          if (origSrcset) live.setAttribute('srcset', origSrcset);
          else live.removeAttribute('srcset');
        } catch (_) {}
        live.removeAttribute('data-appai-my-pet-preview');
        // Keep the original-src attrs around so a re-activate followed by
        // another revert still has them (swapInlineHero won't re-capture
        // when the attribute is already set, so this is correct).
      } else {
        console.warn(TAG, 'revert: no live hero or no original-src stash to restore from');
      }
      // 3. Flip state flags — ATC intercept + variant listeners + observers
      //    all gate on inlineApplied/inlineHero.
      state.inlineApplied = false;
      state.inlineHero = null;
      // 4. Button + link UI back to pre-activation state.
      if (openBtn) {
        openBtn.textContent = openBtnOriginalLabel;
        openBtn.removeAttribute('data-appai-my-pet-inline-active');
      }
      hideRevertLink();
    }

    /**
     * BUG A (post-staging-90) — the 600ms polling watcher lost the race
     * against the theme's own synchronous variant-change handler: theme
     * swaps hero.src to the stock variant image, user sees it for up to
     * 600ms before our polled swap catches up, and on Ritual / Horizon
     * the theme may re-assert the stock image again on a later event
     * cycle (overwriting ours a second time).
     *
     * ISSUE 2 (post-staging-92) — MutationObserver alone catches FUTURE
     * src/srcset mutations, but Ritual REPLACES the hero <img> node on
     * every variant change (size OR colour). The new node is inserted
     * already holding the stock variant src, so nothing mutates after
     * we install the observer and re-assertion never fires. The
     * element-replacement 1.5s backup poll below eventually catches it,
     * but 1500ms of stock image is a visible glitch. Fix: call assert()
     * IMMEDIATELY on every installHeroGuard entry (initial + every
     * re-install after node replacement), before attaching the observer.
     * The settled-node case is now caught synchronously.
     *
     * MutationObserver fires synchronously in a microtask the moment the
     * theme writes hero.src OR hero.srcset. We immediately re-assert our
     * composited URL. No perceivable lag, and theme re-assertions get
     * overwritten the same microtask.
     *
     * Loop prevention: if currentSrc already matches `expected`, we return
     * without writing. Our own `hero.src = expected` triggers the observer
     * again but then returns immediately on the matches-expected check.
     *
     * Fallbacks:
     *   - If the shopper swatched to a colour we HAVEN'T pre-composited yet
     *     (partial fail during generate), we assert the last-known preview
     *     right away (avoids the stock flash) then kick off /recomposite in
     *     the background.
     *   - Theme sometimes replaces the entire <img> rather than mutating its
     *     src (e.g. a Section Rendering API swap of the gallery). A 1500ms
     *     backup poll re-finds the hero + re-installs the observer if our
     *     reference went detached. Issue 4's gallery-childList observer
     *     (installGalleryGuard) is the fast path — the 1500ms poll is now
     *     a last-resort for themes we didn't match a gallery container on.
     */
    function installHeroGuard(hero) {
      if (!hero) return;
      if (hero.__appaiMyPetObserver) {
        try { hero.__appaiMyPetObserver.disconnect(); } catch (e) {}
      }
      // Shared assert — called both synchronously on install (catches the
      // settled replacement-node case) and on every observed src/srcset
      // mutation (catches theme re-assertions). Gated on inlineApplied
      // (not inlineAttached) so revertToOriginalDesign can stop re-assert
      // without tearing down the whole intercept.
      var assert = function () {
        if (!state.renderId || !state.inlineApplied) return;
        var info = currentVariantInfo(root);
        var colorName = info.colorName;
        var expected = colorName ? state.previewUrlByColor[colorName] : null;
        // Compare resolved absolute URLs; `hero.src` returns absolute.
        var currentSrc = hero.src || '';
        if (expected && currentSrc === expected) return; // already ours
        if (expected) {
          hero.src = expected;
          try { hero.removeAttribute('srcset'); } catch (e) {}
          hero.setAttribute('data-appai-my-pet-preview', 'true');
          console.log(TAG, 'inline hero guard re-asserted', colorName);
        } else if (colorName && state.previewUrl) {
          // Colour not pre-composited — stop the stock flash immediately with
          // last-known preview, then kick off compose in the background.
          hero.src = state.previewUrl;
          try { hero.removeAttribute('srcset'); } catch (e) {}
          hero.setAttribute('data-appai-my-pet-preview', 'true');
          console.warn(TAG, 'no preview for colour', colorName,
            'available:', Object.keys(state.previewUrlByColor || {}));
          swapInlineColor(colorName);
        }
      };
      // Immediate: handles the Ritual node-replacement case where the new
      // <img> is inserted with its src already set to the stock variant
      // image — no future mutation fires on it so the observer would never
      // trigger.
      assert();
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.attributeName === 'src' || m.attributeName === 'srcset') {
            assert();
            return;
          }
        }
      });
      observer.observe(hero, { attributes: true, attributeFilter: ['src', 'srcset'] });
      hero.__appaiMyPetObserver = observer;

      // Element-replacement backup: themes that re-render the gallery via
      // Section Rendering API replace the <img> node outright, which breaks
      // our observer silently. Re-find and re-install every 1.5s. If the
      // same node is still there, this is a cheap no-op. Last-resort —
      // installGalleryGuard (Issue 4) is faster when the gallery container
      // selector matches the theme.
      if (state.inlineGuardBackupTimer) clearInterval(state.inlineGuardBackupTimer);
      state.inlineGuardBackupTimer = setInterval(function () {
        if (!state.renderId || !state.inlineApplied) return;
        var currentHero = state.inlineHero;
        if (currentHero && document.body.contains(currentHero) && currentHero.__appaiMyPetObserver) return;
        var fresh = findProductHeroImg();
        if (fresh && fresh !== currentHero) {
          state.inlineHero = fresh;
          // Re-apply preview + install observer on the new node.
          var info = currentVariantInfo(root);
          var colorName = info.colorName;
          var expected = (colorName && state.previewUrlByColor[colorName]) || state.previewUrl;
          if (expected) swapInlineHero(fresh, expected);
          installHeroGuard(fresh);
          console.log(TAG, 'inline hero node replaced (poll) — re-installed guard');
        }
      }, 1500);
    }

    /**
     * ISSUE 4 (post-staging-92) — even with the immediate-assert fix above,
     * the browser may paint one frame of the stock src between the theme's
     * new-node insertion and our assert() running (Ritual rebuilds the
     * gallery on every variant change — size OR colour). The flash is brief
     * but visible.
     *
     * Fix: watch the gallery container's childList for added nodes. On any
     * added <img> (which, in a gallery re-render, IS the new hero), set its
     * opacity to 0 immediately, then installHeroGuard → assert() swaps the
     * src to our composited URL, then transition opacity back to 1 over
     * ~100ms. The shopper never sees the stock pixels because they were
     * invisible while the swap happened.
     *
     * Scope: we hunt for the same gallery containers across themes. On
     * themes where none match, we fall back to the 1500ms element-
     * replacement poll above (slower but functionally correct).
     */
    function installGalleryGuard() {
      if (state.inlineGalleryObserver) {
        try { state.inlineGalleryObserver.disconnect(); } catch (e) {}
        state.inlineGalleryObserver = null;
      }
      var GALLERY_SELECTORS = [
        '.product__media-wrapper',
        '.product__media-list',
        '.product-media-list',
        '.product-gallery',
        'media-gallery',
        'product-media-gallery',
        '[data-media-gallery]',
      ];
      var container = null;
      for (var i = 0; i < GALLERY_SELECTORS.length; i++) {
        try { container = document.querySelector(GALLERY_SELECTORS[i]); } catch (e) { continue; }
        if (container) break;
      }
      if (!container) {
        console.log(TAG, 'gallery guard: no container matched, relying on hero observer + backup poll');
        return;
      }
      console.log(TAG, 'gallery guard: watching', container.tagName.toLowerCase() + (container.className ? '.' + String(container.className).split(' ').join('.') : ''));
      var observer = new MutationObserver(function (mutations) {
        if (!state.renderId || !state.inlineApplied) return;
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (!node || node.nodeType !== 1) continue; // elements only
            // The added node may be the <img> itself or a wrapper containing one.
            var imgs = node.tagName === 'IMG'
              ? [node]
              : (node.querySelectorAll ? node.querySelectorAll('img') : []);
            for (var k = 0; k < imgs.length; k++) {
              var img = imgs[k];
              if (img.closest && img.closest('.appai-my-pet')) continue;
              // Only touch what looks like the hero (ignore thumbnails /
              // zoom previews / decorative icons).
              if (!isHeroCandidate(img)) continue;
              // Hide BEFORE paint — the browser batches style writes with
              // layout so setting opacity now takes effect same-frame.
              var prevTransition = img.style.transition;
              img.style.transition = '';
              img.style.opacity = '0';
              // Promote this to our inlineHero reference + run assert via
              // installHeroGuard synchronously before we hand control back
              // to the browser, so the first paint shows OUR src at opacity:0.
              state.inlineHero = img;
              installHeroGuard(img);
              // Restore opacity next frame once the src is correct.
              var el = img;
              var restore = function () {
                el.style.transition = 'opacity 100ms ease-out';
                el.style.opacity = '1';
                // Clean up the inline transition after it runs so we don't
                // leak styles into the theme's own CSS.
                setTimeout(function () {
                  el.style.transition = prevTransition || '';
                }, 150);
              };
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
              else setTimeout(restore, 0);
            }
          }
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      state.inlineGalleryObserver = observer;
    }

    // Heuristic: the hero image is usually large (>160px on either side)
    // and sits at the top of the gallery. Thumbnails / nav arrows / badges
    // are small. This filters out anything that clearly isn't the main
    // product image so we don't flicker the thumbs on gallery re-render.
    function isHeroCandidate(img) {
      if (!img) return false;
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (w && h && (w < 160 || h < 160)) return false;
      var rect = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
      if (rect && (rect.width < 160 || rect.height < 160)) return false;
      return true;
    }

    function installInlineVariantListeners() {
      // Secondary signal: Shopify Dawn / Horizon / Ritual all fire a variant
      // change event on their product-form custom element. The MutationObserver
      // on hero.src is still the primary defence (fires regardless of event
      // name), but these events give us a head-start to swap BEFORE the theme
      // gets around to updating its hero image on slow devices.
      var EVENT_NAMES = [
        'variant:change', 'variant:changed',
        'variantChange', 'variantChanged',
        'product-form:variant-changed',
        'product:variant-change', 'shopify:variant-change',
      ];
      var handler = function () {
        if (!state.inlineApplied || !state.inlineHero || !state.renderId) return;
        var info = currentVariantInfo(root);
        if (!info.colorName) return;
        var expected = state.previewUrlByColor[info.colorName];
        if (expected) {
          swapInlineHero(state.inlineHero, expected);
          state.previewUrl = expected;
        } else {
          swapInlineColor(info.colorName);
        }
      };
      for (var i = 0; i < EVENT_NAMES.length; i++) {
        document.addEventListener(EVENT_NAMES[i], handler, true);
        window.addEventListener(EVENT_NAMES[i], handler, true);
      }
    }

    function swapInlineColor(colorName) {
      // Issue 7 (post-staging-93) — inlineApplied gate prevents a background
      // /recomposite from completing AFTER the shopper reverted and
      // overwriting the restored stock hero.
      if (!state.inlineHero || !state.renderId || !colorName || !state.inlineApplied) return;
      var cached = state.previewUrlByColor[colorName];
      if (cached) {
        swapInlineHero(state.inlineHero, cached);
        state.previewUrl = cached;
        console.log(TAG, 'inline colour swap CLIENT CACHE HIT', colorName);
        return;
      }
      postJson('my-pet/recomposite', { renderId: state.renderId, colorName: colorName })
        .then(function (res) {
          // Issue 7 — re-check inlineApplied after the awaited round-trip
          // so a revert that happened during /recomposite doesn't get
          // undone by this late success writing back to the hero.
          if (res && res.ok && res.previewUrl && state.inlineHero && state.inlineApplied) {
            swapInlineHero(state.inlineHero, res.previewUrl);
            state.previewUrl = res.previewUrl;
            state.previewUrlByColor[colorName] = res.previewUrl;
            writeStoredRender(shopifyProductId, state.renderId, state.jobId);
          }
        })
        .catch(function () { /* leave hero as-is */ });
    }

    function installInlineATCIntercept() {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;
      // Capture-phase listeners beat any theme handler (which almost always
      // attaches in bubble phase). stopImmediatePropagation keeps the theme
      // from running its own cart/add after us.
      // Issue 7 (post-staging-93): guard on inlineApplied, not just
      // inlineHero — revertToOriginalDesign sets inlineApplied=false
      // without clearing the intercept, so these guards let the theme's
      // own cart/add run unmodified when the shopper chose "Buy the
      // original design instead". No _appai_* / _design_id / _mockup_url
      // properties get attached to the stock-product ATC.
      form.addEventListener('submit', function (e) {
        if (!state.renderId || !state.inlineHero || !state.inlineApplied) return;
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation(); } catch (_) {}
        runInlineATC();
      }, true);
      // Some themes bypass form submit via a direct button click handler.
      // Intercepting click too is belt-and-braces; the submit intercept above
      // handles keyboard "enter" in the quantity input etc.
      var atc = form.querySelector('[type="submit"], [name="add"], button.product-form__submit, .shopify-payment-button');
      if (atc) {
        atc.addEventListener('click', function (e) {
          if (!state.renderId || !state.inlineHero || !state.inlineApplied) return;
          if (e.target.closest('.shopify-payment-button')) return; // skip dynamic checkout — no My Pet support on express checkout
          e.preventDefault();
          e.stopPropagation();
          try { e.stopImmediatePropagation(); } catch (_) {}
          runInlineATC();
        }, true);
      }
    }

    function runInlineATC() {
      // Read the current variant directly from the PDP form — the native
      // swatch logic already keeps form.input[name=id] in sync, so we trust
      // it as the source of truth in inline mode (modal mode has its own
      // state.swatchColor/Size because the modal duplicates swatches).
      var info = currentVariantInfo(root);
      var variantId = info.variantId;
      if (!variantId) {
        console.warn(TAG, 'inline ATC: no variant id on form, aborting');
        return;
      }
      var atcBtn = document.querySelector('form[action*="/cart/add"] [type="submit"], form[action*="/cart/add"] button.product-form__submit, form[action*="/cart/add"] [name="add"]');
      if (atcBtn) atcBtn.disabled = true;
      attemptResolveVariant(String(variantId), info.price, 0)
        .then(function (res) {
          var properties = {
            '_design_id': res.designLabel || 'My Pet',
            '_appai_my_pet_render_id': res.renderId || state.renderId || '',
          };
          if (res.jobId) properties['_appai_job_id'] = res.jobId;
          if (res.previewUrl && res.previewUrl.indexOf('https://') === 0) {
            properties['_mockup_url'] = res.previewUrl;
          }
          if (info.colorName != null) properties['_color'] = info.colorName;
          if (info.sizeId != null) properties['_size'] = info.sizeId;
          return fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: res.variantId, quantity: 1, properties: properties }] }),
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); });
        })
        .then(function (added) {
          if (!added.ok) throw new Error((added.json && added.json.description) || 'Could not add to cart');
          markDismissed(state.renderId);
          refreshAndOpenCartDrawer();
          if (atcBtn) atcBtn.disabled = false;
        })
        .catch(function (err) {
          if (atcBtn) atcBtn.disabled = false;
          console.warn(TAG, 'inline ATC failed:', err && err.message);
          // Surface error in the caption so the shopper sees something.
          if (caption) caption.textContent = (err && err.message) || 'Could not add to cart. Please try again.';
        });
    }

    function openUploadStep() {
      var picker = buildModal();
      // Polish — native <input type="file"> ships with unstyleable OS chrome
      // ("Choose file | No file chosen") that reads as unfinished next to the
      // brand-red primary CTA. Standard pattern: hide the real input, overlay
      // a styled <label for=…> that acts as the button. After the shopper
      // picks a file we flip the row to "filename + change" so they can see
      // what they selected and swap it before kicking off the ~25s generate.
      picker.body.innerHTML =
        '<h3>Add your pet</h3>' +
        '<p class="appai-my-pet-msg">Choose a clear photo of your pet.</p>' +
        '<div class="appai-my-pet-file-row">' +
        '  <input type="file" accept="image/*" class="appai-my-pet-file" id="appai-my-pet-file-input" />' +
        '  <label for="appai-my-pet-file-input" class="appai-my-pet-file-cta" data-state="empty">' +
        '    <span class="appai-my-pet-file-cta__label">Choose a photo</span>' +
        '    <span class="appai-my-pet-file-cta__filename"></span>' +
        '  </label>' +
        '  <button type="button" class="appai-my-pet-file-change" hidden>change</button>' +
        '</div>';
      var input = picker.body.querySelector('.appai-my-pet-file');
      var cta = picker.body.querySelector('.appai-my-pet-file-cta');
      var ctaLabel = picker.body.querySelector('.appai-my-pet-file-cta__label');
      var ctaFilename = picker.body.querySelector('.appai-my-pet-file-cta__filename');
      var changeBtn = picker.body.querySelector('.appai-my-pet-file-change');
      if (changeBtn) {
        changeBtn.addEventListener('click', function () { input.click(); });
      }
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        // Brief filename flash before the progress UI replaces the whole body,
        // so the shopper sees "we got this file" rather than an instant jump.
        if (cta) cta.setAttribute('data-state', 'picked');
        if (ctaLabel) ctaLabel.textContent = 'Selected';
        if (ctaFilename) ctaFilename.textContent = file.name;
        if (changeBtn) changeBtn.hidden = false;
        showGeneratingProgress(picker.body);
        fileToDataUrl(file)
          .then(function (dataUrl) { return postJson('my-pet/upload-photo', { imageData: dataUrl }); })
          .then(function (uploadRes) {
            if (!uploadRes || !uploadRes.ok) throw new Error((uploadRes && uploadRes.error) || 'Could not upload photo');
            var info = currentVariantInfo(root);
            return postJson('my-pet/generate', {
              candidateId: candidateId,
              shopifyProductId: shopifyProductId,
              photoId: uploadRes.photoId,
              colorName: info.colorName,
              sizeId: info.sizeId,
            });
          })
          .then(function (genRes) {
            if (!genRes || !genRes.ok) {
              showMessage(picker.body, (genRes && genRes.message) || (genRes && genRes.error) || 'We could not create this design. Please try again.');
              return;
            }
            state.renderId = genRes.renderId;
            state.jobId = genRes.jobId;
            state.previewUrl = genRes.previewUrl;
            // Bug A — fresh render id means the previous per-colour cache
            // entries point at the previous render's composited images (wrong
            // artwork). Drop them; the new render's colour will be seeded in
            // renderPreviewBody.
            // BUG D (post-staging-89) — server pre-composites every candidate
            // colour in parallel during generate and returns the full map, so
            // we seed previewUrlByColor with all N signed urls up front.
            // Every subsequent swatch click is a CLIENT CACHE HIT (instant
            // <img.src =…> swap with no /recomposite round-trip). On older
            // bundles / partial failures previewUrlsByColor may be missing or
            // undercount; the recomposite path still works as the fallback.
            state.previewUrlByColor = (genRes.previewUrlsByColor && typeof genRes.previewUrlsByColor === 'object')
              ? Object.assign({}, genRes.previewUrlsByColor)
              : {};
            console.log(TAG, 'previewUrlByColor populated', Object.keys(state.previewUrlByColor));
            // Queued (post-staging-90) — prime the HTTP cache for every
            // pre-composited colour the moment generate returns. First swatch
            // click per colour then becomes a <img>.src assignment that paints
            // straight from browser cache (no network wait), so the swap
            // reads as instant even on a cold load. Image().src kicks off a
            // GET without needing the element to be in the DOM; browser
            // keeps the decoded bytes around for the matching URL, so our
            // real <img> later reuses them.
            preloadPreviewUrls(state.previewUrlByColor);
            // New render id is never in dismissedRenderIds — exit-intent will
            // re-ask on this generation even if an earlier one was dismissed
            // (bug 10: re-ask across different generations).
            writeStoredRender(shopifyProductId, genRes.renderId, genRes.jobId);
            picker.overlay.remove();
            // Bugs 3 + 11 — await the refresh before opening the preview so
            // the modal subtitle never renders the pre-generation count. The
            // previous fire-and-forget refresh let the modal open ~300ms
            // before perListingRemaining actually decremented.
            refreshCapStatus().then(function () {
              // UX 7 inline mode: try to swap the PDP hero img in place,
              // skipping the modal entirely. activateInlinePreview returns
              // false when it can't find the hero image (e.g. unsupported
              // theme), in which case the modal is the fall-back so the
              // shopper still gets their preview + ATC.
              if (previewMode === 'inline' && activateInlinePreview(genRes.previewUrl)) return;
              openPreviewStep(genRes.previewUrl);
            });
          })
          .catch(function (err) {
            showMessage(picker.body, err && err.message ? err.message : 'Something went wrong. Please try again.');
          });
      });
    }

    /**
     * Determinate progress bar for the generate step. Sunburst-medium runs
     * ~20-25s today; the bar linearly animates to 90% over 22s, then holds
     * until the server responds. On overrun the copy softens.
     */
    function showGeneratingProgress(body) {
      body.innerHTML =
        '<h3>Creating your design…</h3>' +
        '<p class="appai-my-pet-msg appai-progress-copy">Usually takes 25 to 30 seconds.</p>' +
        '<div class="appai-progress"><span></span></div>';
      var bar = body.querySelector('.appai-progress > span');
      var copy = body.querySelector('.appai-progress-copy');
      var elapsed = 0;
      // Fill 90% over 27s — the Sunburst edit runs ~22s and the server-side
      // pre-composite of the remaining 7 colours adds ~5s on top (staging-90).
      // Hold the last 10% so we never claim "done" before the server responds.
      var fillTimer = setInterval(function () {
        if (!document.body.contains(body)) { clearInterval(fillTimer); return; }
        elapsed += 500;
        var pct = Math.min(90, (elapsed / 27000) * 90);
        if (bar) bar.style.width = pct + '%';
        if (copy && elapsed >= 26000 && elapsed < 45000) copy.textContent = 'Almost there…';
        if (copy && elapsed >= 45000) copy.textContent = 'Taking longer than usual — hang on…';
      }, 500);
      // Clean up when the body changes (next render step).
      var observer = new MutationObserver(function () {
        if (!body.querySelector('.appai-progress')) { clearInterval(fillTimer); observer.disconnect(); }
      });
      observer.observe(body, { childList: true });
    }

    function openPreviewStep(previewUrl) {
      var modal = buildModal({ onClose: function () { maybePromptEmailSave(); } });
      renderPreviewBody(modal.body, previewUrl);
      watchVariantChange(modal.body);
    }

    function renderPreviewBody(body, previewUrl) {
      var colors = allColorOptions(root);
      var sizes = allSizeOptions(root);
      // Bugs B/C — seed the modal's own swatch intent from the PDP form on open
      // (and seed the per-colour client cache with the preview we already have).
      var info = currentVariantInfo(root);
      state.swatchColor = info.colorName;
      state.swatchSize = info.sizeId;
      if (state.swatchColor && previewUrl && !state.previewUrlByColor[state.swatchColor]) {
        state.previewUrlByColor[state.swatchColor] = previewUrl;
      }
      var colorSwatchesHtml = '';
      if (colors.length > 1) {
        colorSwatchesHtml += '<div class="appai-my-pet-swatches" data-group="color">';
        for (var i = 0; i < colors.length; i++) {
          var isCurrentC = String(colors[i]) === String(state.swatchColor);
          colorSwatchesHtml += '<button type="button" data-action="swatch-color" data-color="' + colors[i].replace(/"/g, '&quot;') + '"' +
            (isCurrentC ? ' aria-current="true"' : '') + '>' + colors[i] + '</button>';
        }
        colorSwatchesHtml += '</div>';
      }
      // Size swatches alongside colour. Size change doesn't require a
      // recomposite (print area is the same for S/M/L on apparel), just a
      // variant-id update on the PDP form if (current colour, chosen size) is
      // a real combo.
      var sizeSwatchesHtml = '';
      if (sizes.length > 1) {
        sizeSwatchesHtml += '<div class="appai-my-pet-swatches" data-group="size">';
        for (var j = 0; j < sizes.length; j++) {
          var isCurrentS = String(sizes[j]) === String(state.swatchSize);
          sizeSwatchesHtml += '<button type="button" data-action="swatch-size" data-size="' + sizes[j].replace(/"/g, '&quot;') + '"' +
            (isCurrentS ? ' aria-current="true"' : '') + '>' + sizes[j] + '</button>';
        }
        sizeSwatchesHtml += '</div>';
      }
      // Bugs 3 + 11 — same formatAttemptsMessage() the page caption uses, fed
      // by the capStatus that was just refreshed (and awaited) before this
      // modal opened, so this can never show a stale/disagreeing count.
      var attemptsMessage = state.capStatus ? formatAttemptsMessage(state.capStatus) : '';
      var attemptsHtml = attemptsMessage ? '<p class="appai-attempts">' + attemptsMessage + '</p>' : '';
      body.innerHTML =
        '<h3>Your design</h3>' +
        '<img src="' + previewUrl + '" class="appai-preview-img" alt="Your pet on this design (tap to enlarge)" />' +
        colorSwatchesHtml +
        sizeSwatchesHtml +
        '<button type="button" class="appai-primary" data-action="add-to-cart">Add to cart</button>' +
        '<button type="button" class="appai-secondary" data-action="change-photo">Try another photo</button>' +
        attemptsHtml +
        '<p id="appai-my-pet-status" class="appai-my-pet-msg"></p>';
      body.querySelector('.appai-preview-img').addEventListener('click', function (e) {
        showZoom(e.currentTarget.src);
      });
      body.querySelector('[data-action="add-to-cart"]').addEventListener('click', function () { addToCart(body); });
      body.querySelector('[data-action="change-photo"]').addEventListener('click', function () {
        // BUG C — delegate to the shared tryAnotherPhoto() so the modal path
        // and the inline path both route cap-exceeded shoppers through the
        // save-modal-first mechanic (consent → +2 bonus) instead of the old
        // "status text only" dead-end that just said "No more tries".
        tryAnotherPhoto(body);
      });
      var colorBtns = body.querySelectorAll('[data-action="swatch-color"]');
      for (var cb = 0; cb < colorBtns.length; cb++) {
        colorBtns[cb].addEventListener('click', function (e) {
          selectColor(body, e.currentTarget.getAttribute('data-color'), e.currentTarget);
        });
      }
      var sizeBtns = body.querySelectorAll('[data-action="swatch-size"]');
      for (var sb = 0; sb < sizeBtns.length; sb++) {
        sizeBtns[sb].addEventListener('click', function (e) {
          selectSize(body, e.currentTarget.getAttribute('data-size'));
        });
      }
      // Bug 1b — also validate on initial render, in case the PDP's own
      // default selection is somehow already an invalid combo.
      checkComboAvailable(body);
    }

    /**
     * Bugs B/C — single source of truth for "is the shopper's selected combo
     * actually sellable?". Reads from the modal's own swatch intent
     * (state.swatchColor + state.swatchSize), NOT from currentVariantInfo —
     * because an invalid-combo swatch click deliberately does NOT update the
     * PDP form, so reading the form would hide the invalidity. Also syncs
     * the form variant and dispatches `change` only when the combo is real.
     */
    function checkComboAvailable(body) {
      var atcBtn = body.querySelector('[data-action="add-to-cart"]');
      var status = body.querySelector('#appai-my-pet-status');
      var color = state.swatchColor;
      var size = state.swatchSize;
      // BUG A — null-tolerant. findExactVariant with (null, null) returns
      // the first available variant for a single-variant product; (color,
      // null) works for colour-only products; (null, size) for size-only.
      var v = findExactVariant(root, color, size);
      if (!v) {
        if (atcBtn) atcBtn.disabled = true;
        if (status) {
          if (color && size) {
            status.textContent = size + " isn't available in " + color + " — pick another combination.";
          } else if (color) {
            status.textContent = color + " isn't available right now.";
          } else if (size) {
            status.textContent = "Size " + size + " isn't available right now.";
          } else {
            status.textContent = "This product isn't available right now.";
          }
        }
        return false;
      }
      // Valid combo — sync the PDP form so theme price / stock / etc. update.
      var form = document.querySelector('form[action*="/cart/add"]');
      var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
      if (idInput && String(idInput.value) !== String(v.id)) {
        idInput.value = String(v.id);
        try { idInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
      if (atcBtn) atcBtn.disabled = false;
      if (status && status.textContent && status.textContent.indexOf("isn't available") !== -1) status.textContent = '';
      return true;
    }

    /** Size swatch click: update modal intent + revalidate combo. No recomposite. */
    function selectSize(body, sizeId) {
      if (!sizeId) return;
      state.swatchSize = sizeId;
      var allBtns = body.querySelectorAll('[data-action="swatch-size"]');
      for (var i = 0; i < allBtns.length; i++) {
        if (String(allBtns[i].getAttribute('data-size')) === String(sizeId)) {
          allBtns[i].setAttribute('aria-current', 'true');
        } else {
          allBtns[i].removeAttribute('aria-current');
        }
      }
      checkComboAvailable(body);
    }

    /**
     * Colour swatch click: update modal intent, revalidate combo, and swap
     * the preview image. The preview refresh runs even when (colour, size)
     * is an invalid combo — the shopper can still see what Pink looks like
     * even though XS/Pink isn't buyable; they then pick an available size.
     * Uses a per-colour client cache for instant repeat swaps (Bug A).
     */
    function selectColor(body, colorName, clickedBtn) {
      if (!colorName || !state.renderId) return;
      state.swatchColor = colorName;
      // Aria-current update — selector FIX in staging-86 (swatch-color, not
      // the old "swatch" selector that silently never matched).
      var allBtns = body.querySelectorAll('[data-action="swatch-color"]');
      for (var i = 0; i < allBtns.length; i++) {
        if (String(allBtns[i].getAttribute('data-color')) === String(colorName)) {
          allBtns[i].setAttribute('aria-current', 'true');
        } else {
          allBtns[i].removeAttribute('aria-current');
        }
      }
      // Revalidate combo (updates ATC disabled state + status msg + form id).
      checkComboAvailable(body);

      var img = body.querySelector('img.appai-preview-img');
      var status = body.querySelector('#appai-my-pet-status');
      function clearLoadingState() {
        if (img) img.classList.remove('appai-swatch-loading');
        if (clickedBtn) clickedBtn.removeAttribute('aria-busy');
      }

      // Bug A — client-side cache hit: repeat swap on a colour we've already
      // composited in this modal session is a zero-network, single-paint swap.
      var cached = state.previewUrlByColor[colorName];
      if (cached && img) {
        img.src = cached;
        state.previewUrl = cached;
        clearLoadingState();
        if (status) status.textContent = '';
        console.log(TAG, 'colour swap CLIENT CACHE HIT', colorName);
        return;
      }

      // First-time swap for this colour — show loading cue instantly, then
      // call recomposite (which now has its own server-side cache too, so a
      // cross-session restore case where our client cache is empty is still
      // fast: metadata list + sign only, no compose).
      if (img) img.classList.add('appai-swatch-loading');
      if (clickedBtn) clickedBtn.setAttribute('aria-busy', 'true');
      if (status) status.textContent = 'Updating colour…';
      var swapStarted = Date.now();
      postJson('my-pet/recomposite', { renderId: state.renderId, colorName: colorName })
        .then(function (res) {
          if (res && res.ok && img) {
            var preload = new Image();
            preload.onload = function () {
              img.src = res.previewUrl;
              clearLoadingState();
              if (status) status.textContent = '';
              console.log(TAG, 'colour swap total', Date.now() - swapStarted, 'ms');
            };
            preload.onerror = function () {
              img.src = res.previewUrl;
              clearLoadingState();
              if (status) status.textContent = '';
            };
            preload.src = res.previewUrl;
            state.previewUrl = res.previewUrl;
            state.previewUrlByColor[colorName] = res.previewUrl; // Bug A: populate cache
            // UX 6 — bump savedAt on every successful recomposite too, so a
            // shopper who keeps swapping colours across visits keeps the
            // restore window fresh, not just at initial generation time.
            writeStoredRender(shopifyProductId, state.renderId, state.jobId);
          } else {
            clearLoadingState();
            if (status) status.textContent = '';
          }
        })
        .catch(function () {
          clearLoadingState();
          if (status) status.textContent = '';
        });
    }

    /** Watch the base PDP form for colour/size changes made outside the modal — mirror into the modal's swatch state so the combo gate stays coherent. */
    function watchVariantChange(body) {
      var last = currentVariantInfo(root);
      var timer = setInterval(function () {
        if (!document.body.contains(body)) { clearInterval(timer); return; }
        var now = currentVariantInfo(root);
        // Size first so that when colour also changed, selectColor's combo
        // check reads the already-updated size (not the stale one).
        if (now.sizeId && now.sizeId !== last.sizeId) {
          selectSize(body, now.sizeId);
        }
        if (now.colorName && now.colorName !== last.colorName && state.renderId) {
          selectColor(body, now.colorName);
        }
        last = now;
      }, 600);
    }

    /**
     * Shadow-product mint on resolve-design-variant can race Shopify Admin /
     * Ajax visibility checks and return `{success:false, code:"still_preparing"}`.
     * That is NOT a design-not-ready condition — the design IS ready, the
     * Shopify-side variant just has not propagated yet. Retry with backoff;
     * show other `!success` responses as their actual error (Bug #3 fix).
     */
    function attemptResolveVariant(variantId, price, attempt) {
      return postJson('my-pet/resolve-variant', { renderId: state.renderId, variantId: variantId, price: price })
        .then(function (res) {
          if (res && res.success && res.variantId) return res;
          var code = res && res.code;
          if (code === 'still_preparing') {
            // Retry up to 4 times with 1.5s / 3s / 5s / 8s backoff — ~17s total,
            // well under the 30s storefront fetch limit for subsequent tries.
            var backoffs = [1500, 3000, 5000, 8000];
            if (attempt < backoffs.length) {
              return new Promise(function (resolve, reject) {
                setTimeout(function () {
                  attemptResolveVariant(variantId, price, attempt + 1).then(resolve, reject);
                }, backoffs[attempt]);
              });
            }
          }
          // Bug 1a — "Shop not authorized" / not_design_owner are server-internal
          // auth-plumbing states (expired/missing OAuth token, or an ownership
          // check refusal), not something the shopper did wrong. The raw string
          // was confusing shoppers into thinking the item itself was blocked.
          // The real cause gets logged loudly server-side (see
          // resolve-variant's console.error) for us to chase; this is just the
          // calmer thing to show the shopper while that gets fixed.
          var rawMsg = (res && (res.error || res.message)) || '';
          var rawCode = res && res.code;
          var msg;
          if (rawMsg === 'Shop not authorized' || rawCode === 'not_design_owner') {
            msg = "Can't reach your store right now. If this persists, the My Pet app may need to be reinstalled.";
          } else {
            msg = rawMsg || 'Could not add this design to cart.';
          }
          throw new Error(msg);
        });
    }

    function addToCart(body) {
      var status = body.querySelector('#appai-my-pet-status');
      var btn = body.querySelector('[data-action="add-to-cart"]');
      // Bugs B/C — do NOT read currentVariantInfo. The PDP form's variant id
      // is only kept in sync when the combo is valid; on an invalid combo the
      // form stays on the last valid variant so the theme's price/stock stay
      // consistent, which would otherwise let ATC silently ship the wrong
      // variant (user reported: XS/Pink click → cart got S/Pink). The modal's
      // own swatch intent is the source of truth for what the shopper picked;
      // findExactVariant decides whether to allow or refuse.
      //
      // BUG A (post-staging-89) — unconditional call so single-variant and
      // one-option-only products (no swatchColor or no swatchSize) still
      // resolve to their one buyable variant. findExactVariant is null-
      // tolerant per option now, and checkComboAvailable writes the correct
      // "colour X isn't available" / "size Y isn't available" / "product
      // isn't available" message if we come back empty.
      var exact = findExactVariant(root, state.swatchColor, state.swatchSize);
      if (!exact) {
        checkComboAvailable(body);
        return;
      }
      var exactVariantId = String(exact.id);
      var exactPrice = exact.price != null ? (exact.price / 100).toFixed(2) : null;

      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Setting up your cart line…';
      attemptResolveVariant(exactVariantId, exactPrice, 0)
        .then(function (res) {
          if (status) status.textContent = 'Adding to cart…';
          // Issue 10: line-item properties that (a) let appai-cart-images.js
          // recognise this as an AppAI line and swap the thumbnail to the
          // composite mockup, (b) tie the line back to generationJobs for the
          // existing fulfillment path, (c) tie it back to my_pet_renders for the
          // audit metafield written on orders/paid.
          //
          // Underscore-prefixed keys are hidden from buyer-facing cart UI (per
          // Shopify convention + our cart-guard script) — merchant / support
          // sees them on the Shopify order page.
          var properties = {
            '_design_id': res.designLabel || 'My Pet',
            '_appai_my_pet_render_id': res.renderId || state.renderId || '',
          };
          if (res.jobId) properties['_appai_job_id'] = res.jobId;
          if (res.previewUrl && res.previewUrl.indexOf('https://') === 0) {
            properties['_mockup_url'] = res.previewUrl;
          }
          // Bugs B/C — write the shopper's ACTUAL selected colour/size, not
          // whatever happened to be on the PDP form when ATC was clicked.
          // BUG A — only set when the option exists (single-variant products
          // have no colour/size swatches; leaving undefined keeps the line
          // properties clean).
          if (state.swatchColor != null) properties['_color'] = state.swatchColor;
          if (state.swatchSize != null) properties['_size'] = state.swatchSize;
          return fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: res.variantId, quantity: 1, properties: properties }] }),
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); });
        })
        .then(function (added) {
          if (!added.ok) throw new Error((added.json && added.json.description) || 'Could not add to cart');
          if (status) {
            status.innerHTML = 'Added to cart! <a href="/cart">View cart</a>';
            // Queued — the modal is max-height:92vh; overflow:auto, so on
            // tall content the status row can land below the fold. Scroll
            // it into view so the shopper actually sees the confirmation
            // (and the "View cart" link) rather than wondering if ATC
            // succeeded.
            try { status.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
          }
          // Suppress the on-close email-save prompt once the shopper already
          // acted — they do not need to save a design they just added.
          markDismissed(state.renderId);
          // Bug D — Section Rendering API refresh + theme-drawer open attempt.
          // Replaces the previous single-event dispatch that only fed our own
          // cart-images repaint, never the theme's drawer.
          refreshAndOpenCartDrawer();
        })
        .catch(function (err) {
          if (btn) btn.disabled = false;
          if (status) {
            status.textContent = err && err.message ? err.message : 'Could not add to cart. Please try again.';
            try { status.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
          }
        });
    }

    /**
     * Bug 10 — per-render dismissal (not a one-shot boolean) so a shopper who
     * dismisses the save prompt for one design still gets asked again for a
     * NEW design they generate afterward. emailModalOpen guards against
     * mouseleave firing more than once before the shopper reacts (would
     * otherwise stack a second modal over the first).
     *
     * BUG C (post-staging-90): opts.force skips the per-render dismissal
     * check so the "Try another photo at cap" trigger can re-prompt even if
     * the shopper previously dismissed the exit-intent prompt for this
     * design. opts.trigger is logged + optionally used to adapt the headline
     * ("Sign up to get 2 more" instead of "Save your design?") so the
     * mechanic (consent → +2 bonus) reads honestly at the cap-gate moment.
     */
    function maybePromptEmailSave(opts) {
      opts = opts || {};
      var force = !!opts.force;
      var trigger = opts.trigger || 'exit-intent';
      if (!state.renderId || state.emailModalOpen) return;
      if (!force && isDismissed(state.renderId)) return;
      state.emailModalOpen = true;
      var renderIdAtOpen = state.renderId;
      var modal = buildModal({
        onClose: function () {
          state.emailModalOpen = false;
          markDismissed(renderIdAtOpen); // closed without sending — don't re-ask for this design
        },
      });
      var thumbHtml = state.previewUrl
        ? '<img src="' + state.previewUrl + '" class="appai-thumb" alt="Your design (tap to enlarge)" />'
        : '';
      // Save modal state machine:
      //   State A (no consent, under cap, exit-intent)       → "Save your design?" + opt-in checkbox
      //   State B (no consent, at cap, try-another-photo)    → "Get 2 more custom designs" + opt-in checkbox
      //   State C (already consented, any trigger)           → "Save your design?" + NO checkbox
      //
      // State detection: capStatus.emailBonusApplied is the server's
      // authoritative "this device + listing + marketing_consent=true row
      // already exists" boolean (hasEmailBonus in server/my-pet.ts), so we
      // don't need to re-query — the latest refreshCapStatus already fetched
      // it. State C wins over A/B regardless of trigger: if the shopper is
      // already on the Press there's nothing new to offer, so we drop the
      // checkbox and reframe the body as a pure save link. For the "at cap +
      // already consented" case tryAnotherPhoto already routes to
      // showCapTerminalMessage instead of the save modal, so State C only
      // actually renders on exit-intent (or any future save-prompt entry
      // point) when the shopper is UNDER cap but has already consented.
      var alreadyConsented = !!(state.capStatus && state.capStatus.emailBonusApplied);
      var isCapGate = trigger === 'try-another-photo';
      var headline = isCapGate && !alreadyConsented
        ? "Get 2 more custom designs"
        : "Save your design?";
      var bodyCopy;
      if (alreadyConsented) {
        bodyCopy = "We'll email you a link back to this design — works for 30 days, on any device. You're already on the Petposterous Press, so this is just a save link.";
      } else if (isCapGate) {
        bodyCopy = "You've used your free designs on this product. Sign up to the Petposterous Press and we'll unlock 2 more for you — plus a save link to this design.";
      } else {
        bodyCopy = "We'll email you a link back to this design — works for 30 days, on any device.";
      }
      // Polish E + F (Model 2) — single primary "Email me this design" with
      // a default-checked "Join the Petposterous Press for 2 more custom
      // designs" checkbox. The checkbox is the single source of truth for
      // BOTH marketing_consent AND the +2 bonus (server-side hasEmailBonus
      // requires marketing_consent=true). Reverting from the staging-89
      // two-button UI because the explicit "Just save my design" secondary
      // felt heavier than the pattern the rest of the Petposterous site
      // already uses; the single primary with an explicit, pre-checked
      // opt-in keeps the mechanic honest without the extra chrome.
      // State A: checkbox reads "Join the Press for 2 more custom designs".
      // State B (cap-gate): checkbox reads "Yes, send me the Press (required
      //   for +2 designs)" — makes the exchange obvious.
      // State C (already consented): no checkbox at all — nothing new to
      //   offer, so pretending otherwise is the bug this change fixes.
      var consentLabel = isCapGate
        ? "Yes, send me the Petposterous Press (required for +2 designs)"
        : "Join the Petposterous Press for 2 more custom designs";
      var primaryLabel = isCapGate && !alreadyConsented
        ? "Unlock 2 more designs"
        : "Email me this design";
      var consentRowHtml = alreadyConsented
        ? ''
        : '<label class="appai-my-pet-consent">' +
          '  <input type="checkbox" data-action="consent-checkbox" checked />' +
          '  <span>' + consentLabel + '</span>' +
          '</label>';
      // Footnote only reads honestly when we're actually offering the Press.
      var footnoteHtml = alreadyConsented
        ? ''
        : '<p class="appai-my-pet-footnote">Press is weekly, small, witty. Unsubscribe in one click.</p>';
      modal.body.innerHTML =
        '<h3>' + headline + '</h3>' +
        thumbHtml +
        '<p class="appai-my-pet-msg">' + bodyCopy + '</p>' +
        '<input type="email" placeholder="you@example.com" class="appai-my-pet-email" value="' + readStoredEmail().replace(/"/g, '&quot;') + '" />' +
        consentRowHtml +
        '<button type="button" class="appai-primary" data-action="send-email">' + primaryLabel + '</button>' +
        footnoteHtml +
        '<p id="appai-my-pet-email-status" class="appai-my-pet-msg"></p>';
      var thumb = modal.body.querySelector('img.appai-thumb');
      if (thumb) thumb.addEventListener('click', function (e) { showZoom(e.currentTarget.src); });

      modal.body.querySelector('[data-action="send-email"]').addEventListener('click', function () {
        var emailInput = modal.body.querySelector('.appai-my-pet-email');
        var consentInput = modal.body.querySelector('[data-action="consent-checkbox"]');
        var email = (emailInput && emailInput.value) || '';
        // State C renders no checkbox, so consentInput is null → withConsent
        // is false → no spurious "consented again" audit row server-side.
        // The server is already one-shot on bonus (hasEmailBonus is a
        // boolean-exists check on marketing_consent=true, not a count), so
        // sending true here wouldn't double-grant, but sending false in State
        // C keeps the audit trail honest and avoids the Shopify customer
        // upsert API call on every re-send.
        var withConsent = !!(consentInput && consentInput.checked);
        var status = modal.body.querySelector('#appai-my-pet-email-status');
        var sendBtn = modal.body.querySelector('[data-action="send-email"]');
        if (sendBtn) sendBtn.disabled = true;
        if (status) status.textContent = 'Sending…';
        postJson('my-pet/email-save', { renderId: state.renderId, email: email, marketingConsent: withConsent, pageUrl: pageUrl })
          .then(function (res) {
            if (res && res.ok) {
              // Confirmation copy:
              //   State A+checked / State B+checked   → "You're in!" (just joined)
              //   State A+unchecked / State B+unchecked / State C → "Sent!"
              // State C uses "Sent!" because the shopper was already on the
              // Press — there's no "you're in" moment to celebrate.
              if (status) status.textContent = withConsent
                ? "You're in! Check your inbox for the save link."
                : 'Sent! Check your inbox for the save link.';
              writeStoredEmail(email);
              markDismissed(renderIdAtOpen); // sent successfully — stay suppressed for this design
              // Only the opt-in path changes perListingLimit (Model 2); refresh
              // the cap caption so the "+2 more" is reflected immediately.
              if (withConsent) refreshCapStatus();
            } else {
              if (status) status.textContent = (res && res.error) || 'Could not send email.';
              if (sendBtn) sendBtn.disabled = false;
            }
          })
          .catch(function () {
            if (status) status.textContent = 'Could not send email.';
            if (sendBtn) sendBtn.disabled = false;
          });
      });
    }

    // Desktop exit-intent (mouse leaving toward the browser chrome). Mobile has
    // no reliable equivalent — visibilitychange only fires once the page is
    // already hidden, too late to show new UI, so this is a best-effort nudge.
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY <= 0) maybePromptEmailSave();
    });

    // Email-saved link resume: ?my_pet_token=... loads that render directly,
    // cross-device, no re-upload (valid 30 days).
    try {
      var tokenParam = new URL(window.location.href).searchParams.get('my_pet_token');
      if (tokenParam) {
        getJson('my-pet/resolve-token', { token: tokenParam }).then(function (res) {
          if (res && res.ok) {
            state.renderId = res.renderId;
            state.previewUrl = res.previewUrl;
            state.previewUrlByColor = {}; // Bug A: different render — drop any session cache
            // UX 7 — honour inline mode on email-token resume as well.
            if (previewMode === 'inline' && activateInlinePreview(res.previewUrl)) return;
            openPreviewStep(res.previewUrl);
          }
        });
      }
    } catch (e) {}

    openBtn.addEventListener('click', function () {
      // UX 7 inline mode — when inline preview is CURRENTLY applied, the My
      // Pet button acts as "Try another photo" and routes through the
      // shared tryAnotherPhoto() so cap-at + save-modal + terminal-message
      // branches all behave the same as the modal-mode change-photo button.
      if (previewMode === 'inline' && state.inlineApplied) {
        tryAnotherPhoto();
        return;
      }
      // Issue 7 (post-staging-93) — reverted-but-already-generated state in
      // inline mode: the shopper clicked "Buy the original design instead"
      // but now wants their pet design back. Re-activate the existing
      // render on the hero without re-upload / cap hit. Must come BEFORE
      // the generic "already generated → open modal preview" branch below
      // so inline mode doesn't fall through to the modal.
      if (previewMode === 'inline' && state.renderId && state.previewUrl) {
        refreshCapStatus().then(function () {
          activateInlinePreview(state.previewUrl);
        });
        return;
      }
      // If the shopper already generated this visit, re-open the SAME preview
      // (no new generation call, no cap attempt consumed). Bug #2 was that
      // this branch returned silently without reopening anything.
      // Bugs 3 + 11 — also the "stale modal on first/re- open" case: await
      // the refresh so the subtitle reflects the current count, not whatever
      // was cached from the last refresh (e.g. before an email-save bonus).
      if (state.renderId && state.previewUrl) {
        refreshCapStatus().then(function () {
          openPreviewStep(state.previewUrl);
        });
        return;
      }
      refreshCapStatus()
        .then(function (cap) {
          if (cap && cap.allowed === false) {
            var modal = buildModal();
            showMessage(modal.body, cap.message || 'You have used your My Pet tries on this design.');
            return;
          }
          openUploadStep();
        });
    });

    // Show attempts-remaining caption on first load.
    refreshCapStatus();
  }

  function boot() {
    var roots = document.querySelectorAll('.appai-my-pet');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
