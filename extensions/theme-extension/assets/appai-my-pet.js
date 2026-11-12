/**
 * My Pet — storefront behaviour for the my-pet.liquid block.
 * Upload a pet photo → image-edit the published design → preview on the
 * garment → add to cart via the same shadow-SKU endpoint every other
 * customizer flow uses. See docs/ (My Pet plan) for the full spec.
 */
console.log('[My Pet] script build=e95f1b44 loaded');
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
  function readStoredRecord(shopifyProductId) {
    try {
      var raw = window.localStorage.getItem(renderStorageKey(shopifyProductId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  // One record per product. choices[renderId] is that design's own colour
  // and size. The top-level pair is the active design, which restore and the
  // default-size script already read.
  function choicesFromRecord(prev) {
    var choices = {};
    var raw = prev && prev.choices;
    if (raw && typeof raw === 'object') {
      var keys = Object.keys(raw);
      for (var i = 0; i < keys.length; i++) {
        var entry = raw[keys[i]];
        if (!entry || (!entry.colorName && !entry.sizeName)) continue;
        choices[keys[i]] = { colorName: entry.colorName || '', sizeName: entry.sizeName || '' };
      }
    }
    if (prev && prev.renderId && (prev.colorName || prev.sizeName) && !choices[prev.renderId]) {
      choices[prev.renderId] = { colorName: prev.colorName || '', sizeName: prev.sizeName || '' };
    }
    return choices;
  }
  function writeStoredRecord(shopifyProductId, next) {
    try { window.localStorage.setItem(renderStorageKey(shopifyProductId), JSON.stringify(next)); } catch (e) {}
  }
  function writeStoredRender(shopifyProductId, renderId, jobId) {
    var prev = readStoredRecord(shopifyProductId) || {};
    var choices = choicesFromRecord(prev);
    var own = choices[renderId];
    var next = {
      renderId: renderId,
      jobId: jobId || (prev.renderId === renderId ? prev.jobId : null) || null,
      savedAt: Date.now(),
      choices: choices,
    };
    if (own && own.colorName) next.colorName = own.colorName;
    if (own && own.sizeName) next.sizeName = own.sizeName;
    if (revertedFlagOn(shopifyProductId)) next.reverted = true;
    writeStoredRecord(shopifyProductId, next);
  }
  function revertedStorageKey(shopifyProductId) {
    var deviceKey = readStoredDeviceKey();
    var shortKey = deviceKey ? deviceKey.slice(0, 16) : 'anon';
    return 'appai_my_pet_reverted_v1:' + shopifyProductId + ':' + shortKey;
  }
  function revertedFlagOn(shopifyProductId) {
    var prev = readStoredRecord(shopifyProductId);
    if (prev && prev.reverted) return true;
    try { return window.localStorage.getItem(revertedStorageKey(shopifyProductId)) === '1'; } catch (e) { return false; }
  }
  function persistReverted(shopifyProductId, on) {
    try {
      if (on) window.localStorage.setItem(revertedStorageKey(shopifyProductId), '1');
      else window.localStorage.removeItem(revertedStorageKey(shopifyProductId));
    } catch (e) {}
    var prev = readStoredRecord(shopifyProductId);
    if (!prev || !prev.renderId) {
      console.log(TAG, on ? 'revert stored' : 'revert cleared', 'side-key only');
      return;
    }
    if (on) prev.reverted = true;
    else delete prev.reverted;
    writeStoredRecord(shopifyProductId, prev);
    console.log(TAG, on ? 'revert stored' : 'revert cleared', renderStorageKey(shopifyProductId));
  }
  function writeStoredVariantChoice(shopifyProductId, colorName, sizeName, reason) {
    var prev = readStoredRecord(shopifyProductId);
    if (!prev || !prev.renderId) return;
    var choices = choicesFromRecord(prev);
    var own = choices[prev.renderId] || { colorName: '', sizeName: '' };
    var colour = colorName || own.colorName || '';
    var size = sizeName || own.sizeName || '';
    choices[prev.renderId] = { colorName: colour, sizeName: size };
    prev.choices = choices;
    if (colour) prev.colorName = colour;
    if (size) prev.sizeName = size;
    writeStoredRecord(shopifyProductId, prev);
    console.log(TAG, 'design pref write render=' + prev.renderId +
      ' colour=' + colour + ' size=' + size + ' reason=' + (reason || ''));
  }
  // Make renderId active. Use its saved colour and size, or the pair on
  // screen when this design has never saved one. Returns the pair to select.
  function activateStoredDesign(shopifyProductId, renderId, jobId, fallbackColor, fallbackSize) {
    var prev = readStoredRecord(shopifyProductId) || {};
    var choices = choicesFromRecord(prev);
    var own = choices[renderId];
    var hadOwn = !!(own && (own.colorName || own.sizeName));
    var colorName = hadOwn && own.colorName ? own.colorName : '';
    var sizeName = hadOwn && own.sizeName ? own.sizeName : '';
    var next = {
      renderId: renderId,
      jobId: jobId || null,
      savedAt: Date.now(),
      choices: choices,
    };
    if (colorName) next.colorName = colorName;
    if (sizeName) next.sizeName = sizeName;
    if (revertedFlagOn(shopifyProductId)) next.reverted = true;
    writeStoredRecord(shopifyProductId, next);
    console.log(TAG, 'design pref write render=' + renderId +
      ' colour=' + colorName + ' size=' + sizeName + ' reason=activate');
    return {
      colorName: colorName || fallbackColor || '',
      sizeName: sizeName || fallbackSize || '',
      hadOwn: hadOwn,
    };
  }
  function storedChoiceFor(shopifyProductId, renderId) {
    var prev = readStoredRecord(shopifyProductId);
    var choices = choicesFromRecord(prev);
    var own = renderId && choices[renderId];
    if (own && (own.colorName || own.sizeName)) {
      return { colorName: own.colorName || '', sizeName: own.sizeName || '' };
    }
    return { colorName: '', sizeName: '' };
  }
  function clearStoredRender(shopifyProductId) {
    var prev = readStoredRecord(shopifyProductId);
    var choices = choicesFromRecord(prev);
    if (prev && prev.renderId) delete choices[prev.renderId];
    var remaining = Object.keys(choices);
    if (!remaining.length) {
      try { window.localStorage.removeItem(renderStorageKey(shopifyProductId)); } catch (e) {}
      return;
    }
    writeStoredRecord(shopifyProductId, { savedAt: Date.now(), choices: choices });
  }

  // Same-tab speed-up for the restore round-trip. Signed URLs live much
  // longer than this; 15 minutes is enough for a revisit in this tab and
  // short enough that a swept render doesn't linger.
  var RESOLVE_CACHE_PREFIX = 'appai_my_pet_resolve_v1:';
  var RESOLVE_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
  function readResolveCache(renderId) {
    try {
      var raw = window.sessionStorage.getItem(RESOLVE_CACHE_PREFIX + renderId);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.renderId !== renderId || !parsed.previewUrl || !parsed.expiresAt) return null;
      if (Date.now() > parsed.expiresAt) {
        window.sessionStorage.removeItem(RESOLVE_CACHE_PREFIX + renderId);
        return null;
      }
      if (!signedUrlUsable(parsed.previewUrl) || !signedMapUsable(parsed.previewUrlsByColor)) {
        window.sessionStorage.removeItem(RESOLVE_CACHE_PREFIX + renderId);
        return null;
      }
      return parsed;
    } catch (e) { return null; }
  }
  // Supabase signed URLs carry exp in the token JWT. Our 15-minute clock
  // can still hand out a URL whose token already expired.
  function signedUrlExpiryMs(url) {
    try {
      var q = String(url || '').split('?')[1] || '';
      if (!q) return 0;
      var token = '';
      var parts = q.split('&');
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf('=');
        var key = eq === -1 ? parts[i] : parts[i].slice(0, eq);
        if (key !== 'token') continue;
        token = decodeURIComponent(parts[i].slice(eq + 1));
      }
      if (!token || token.indexOf('.') === -1) return 0;
      var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) payload += '=';
      var json = JSON.parse(atob(payload));
      var exp = json && Number(json.exp);
      return exp ? exp * 1000 : 0;
    } catch (e) { return 0; }
  }
  function signedUrlUsable(url) {
    if (!url) return false;
    var exp = signedUrlExpiryMs(url);
    if (!exp) return true;
    return Date.now() < exp - 15000;
  }
  function signedMapUsable(map) {
    if (!map || typeof map !== 'object') return true;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (map[keys[i]] && !signedUrlUsable(map[keys[i]])) return false;
    }
    return true;
  }
  function earliestSignedExpiry(urls) {
    var exp = 0;
    for (var i = 0; i < urls.length; i++) {
      var one = signedUrlExpiryMs(urls[i]);
      if (one && (!exp || one < exp)) exp = one;
    }
    return exp;
  }

  function writeResolveCache(res) {
    if (!res || !res.ok || !res.renderId || !res.previewUrl) return;
    if (!signedUrlUsable(res.previewUrl) || !signedMapUsable(res.previewUrlsByColor)) return;
    var expiresAt = Date.now() + RESOLVE_CACHE_MAX_AGE_MS;
    var urls = [res.previewUrl];
    var map = res.previewUrlsByColor || {};
    var mapKeys = Object.keys(map);
    for (var i = 0; i < mapKeys.length; i++) if (map[mapKeys[i]]) urls.push(map[mapKeys[i]]);
    var tokenExp = earliestSignedExpiry(urls);
    if (tokenExp && tokenExp - 15000 < expiresAt) expiresAt = tokenExp - 15000;
    if (expiresAt <= Date.now()) return;
    try {
      window.sessionStorage.setItem(RESOLVE_CACHE_PREFIX + res.renderId, JSON.stringify({
        ok: true,
        renderId: res.renderId,
        jobId: res.jobId || null,
        previewUrl: res.previewUrl,
        previewUrlsByColor: res.previewUrlsByColor || {},
        colorName: res.colorName || '',
        expiresAt: expiresAt,
      }));
    } catch (e) { /* sessionStorage disabled or full */ }
  }

  function proxyPath(path) {
    return '/apps/appai/' + path.replace(/^\//, '');
  }

  function postJson(path, body, signal) {
    var payload = Object.assign({}, body || {});
    var key = readStoredDeviceKey();
    if (key && !payload.deviceKey) payload.deviceKey = key;
    return fetch(proxyPath(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
      signal: signal || undefined,
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
      var form = findMainProductForm(root);
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

  /**
   * STAGING-99 — Ritual / Horizon-family themes render MULTIPLE
   * form[action*="/cart/add"] on a PDP (main product form, sticky
   * add-to-cart form, related-products quick-add forms). A blind
   * document.querySelector picked up the first — on the user's
   * Petposterous Ritual storefront that was NOT the main product
   * form, so currentVariantInfo read a frozen variant id (symptom:
   * activate landed on Black while White was really selected; the
   * poll fallback never saw a change because the quick-add form
   * has no colour swatches wired to it).
   *
   * Strategy (first match wins):
   *   1. Form inside the My Pet block's enclosing product section
   *      whose current input[name=id] value is one of the base
   *      product's known variant ids.
   *   2. First form inside the enclosing product section (variant
   *      may currently be out of set — covers mid-change races).
   *   3. Document-wide: form whose current id matches one of our
   *      variant ids.
   *   4. First form[action*="/cart/add"] (pre-staging-99 fallback).
   *
   * The scope walk prefers the closest ancestor that looks like a
   * product section: a <main>, a <section>, or any element with
   * data-section-type / data-section-id / data-product-id. Stops
   * at <body>.
   */
  function findMainProductForm(root) {
    if (!root) return document.querySelector('form[action*="/cart/add"]');
    var forms = Array.prototype.slice.call(document.querySelectorAll('form[action*="/cart/add"]'));
    if (!forms.length) return null;
    if (forms.length === 1) return forms[0];
    var variantIdSet = {};
    try {
      var vs = JSON.parse(root.getAttribute('data-variants') || '[]');
      for (var i = 0; i < vs.length; i++) variantIdSet[String(vs[i].id)] = true;
    } catch (e) {}
    function formVariantIdInSet(form) {
      var inp = form.querySelector('input[name="id"], select[name="id"]');
      var v = inp ? String(inp.value || '') : '';
      return !!(v && variantIdSet[v]);
    }
    var scope = null;
    var cur = root.parentNode;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : '';
      if (tag === 'main' || tag === 'section' ||
          cur.hasAttribute('data-section-type') ||
          cur.hasAttribute('data-section-id') ||
          cur.hasAttribute('data-product-id')) {
        scope = cur; break;
      }
      cur = cur.parentNode;
    }
    if (scope) {
      var scoped = scope.querySelectorAll('form[action*="/cart/add"]');
      for (var s1 = 0; s1 < scoped.length; s1++) {
        if (formVariantIdInSet(scoped[s1])) return scoped[s1];
      }
      if (scoped.length) return scoped[0];
    }
    for (var s2 = 0; s2 < forms.length; s2++) {
      if (formVariantIdInSet(forms[s2])) return forms[s2];
    }
    return forms[0];
  }

  /**
   * STAGING-99 cross-check — read the selected colour directly from
   * the main product section's checked swatch input / selected option
   * label, independent of the form's variant id. Returned alongside
   * the form-based colour so a disagreement (poll watching the wrong
   * form) is immediately visible in the logs.
   *
   * Covers common Shopify theme patterns:
   *   - fieldset / block with data-option-name "Color"/"Colour" and a
   *     checked radio input (Dawn, Horizon, Ritual, Impulse, Prestige).
   *   - input[name="options[Color]"]:checked (name= pattern).
   *   - select[name="options[Color]"] (legacy select).
   *   - [data-option-name="Color"] [aria-checked="true"] (custom
   *     button-group swatches, aria-driven).
   */
  function readSwatchColor(root) {
    var scope = null;
    var cur = root ? root.parentNode : null;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : '';
      if (tag === 'main' || tag === 'section' ||
          cur.hasAttribute('data-section-type') ||
          cur.hasAttribute('data-section-id') ||
          cur.hasAttribute('data-product-id')) {
        scope = cur; break;
      }
      cur = cur.parentNode;
    }
    var search = scope || document;
    try {
      var inputs = search.querySelectorAll('input[type="radio"]:checked');
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var name = String(inp.name || '').toLowerCase();
        if (name.indexOf('color') !== -1 || name.indexOf('colour') !== -1) {
          var val = inp.value || '';
          if (val) return val;
        }
      }
    } catch (e) {}
    try {
      var sels = search.querySelectorAll('select[name*="olor" i], select[name*="olour" i]');
      for (var j = 0; j < sels.length; j++) {
        var sel = sels[j];
        if (sel && sel.value) return sel.value;
      }
    } catch (e) {}
    try {
      var aria = search.querySelectorAll('[aria-checked="true"]');
      for (var k = 0; k < aria.length; k++) {
        var node = aria[k];
        var container = node.closest ? node.closest('[data-option-name], [data-option]') : null;
        if (container) {
          var optName = String(container.getAttribute('data-option-name') || container.getAttribute('data-option') || '').toLowerCase();
          if (optName.indexOf('color') !== -1 || optName.indexOf('colour') !== -1) {
            var txt = (node.getAttribute('data-value') || node.getAttribute('aria-label') || node.textContent || '').trim();
            if (txt) return txt;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * STAGING-100 — Ritual / Horizon carousel-style galleries render ONE
   * <img> per variant media (data-media-id per slide). The theme hides
   * all slides except the "active" one and shows a different slide when
   * the shopper changes colour — the hero <img> we were tracking becomes
   * off-screen, so writing our composite to its src leaves the shopper
   * staring at the stock version of whatever slide the theme scrolled to.
   *
   * Build colour → media id from the product's variants data. First
   * variant per colour wins (apparel typically has one featured_media
   * per colour across all sizes). Variants without featured_media (DIY
   * / digital / un-imaged variants) are skipped — those colours fall
   * back to the single-hero code path.
   */
  function getMediaIdByColor(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var map = {};
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var mediaId = null;
      if (v.featured_media && v.featured_media.id != null) mediaId = String(v.featured_media.id);
      else if (v.featured_media_id != null) mediaId = String(v.featured_media_id);
      if (!mediaId) continue;
      var color = findOptionValue(v, optionNames, ['color', 'colour']);
      if (color && !map[color]) map[color] = mediaId;
    }
    return map;
  }

  function currentVariantInfo(root) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    var form = findMainProductForm(root);
    var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
    var variantId = idInput ? idInput.value : root.getAttribute('data-selected-variant');
    var variant = null;
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === String(variantId)) { variant = variants[i]; break; }
    }
    if (!variant) return { variantId: variantId, colorName: null, sizeId: null };
    var colorName = findOptionValue(variant, optionNames, ['color', 'colour']);
    var sizeId = findOptionValue(variant, optionNames, ['size']);
    return { variantId: variantId, colorName: colorName, sizeId: sizeId };
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
    // A requested size that this colour does not sell must not resolve to
    // another size. Callers that only asked for a colour still get one.
    if (preferSizeId) return exact;
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
    // A requested colour that this size does not sell must not resolve to
    // a different colour of the same size.
    if (preferColorName) return exact;
    return exact || sizeOnly;
  }

  function setModalLocked(overlay, locked) {
    if (!overlay) return;
    var closeBtn = overlay.querySelector('.appai-my-pet-modal__close');
    if (locked) {
      overlay.classList.add('appai-my-pet-modal--locked');
      if (closeBtn) {
        closeBtn.hidden = true;
        closeBtn.disabled = true;
      }
      return;
    }
    overlay.classList.remove('appai-my-pet-modal--locked');
    if (closeBtn) {
      closeBtn.hidden = false;
      closeBtn.disabled = false;
    }
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
    function dismiss() {
      if (overlay.classList.contains('appai-my-pet-modal--locked')) return;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (typeof options.onClose === 'function') options.onClose();
    }
    overlay.querySelector('.appai-my-pet-modal__close').addEventListener('click', function (e) {
      e.preventDefault();
      dismiss();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target !== overlay) return;
      if (overlay.classList.contains('appai-my-pet-modal--locked')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      dismiss();
    });
    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', onKey, true);
        return;
      }
      if (overlay.classList.contains('appai-my-pet-modal--locked')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      dismiss();
    }
    document.addEventListener('keydown', onKey, true);
    function swallowBackdropGesture(e) {
      if (!overlay.classList.contains('appai-my-pet-modal--locked')) return;
      if (e.target !== overlay) return;
      e.preventDefault();
      e.stopPropagation();
    }
    overlay.addEventListener('touchstart', swallowBackdropGesture, { passive: false });
    overlay.addEventListener('touchmove', swallowBackdropGesture, { passive: false });
    overlay.addEventListener('touchend', swallowBackdropGesture, { passive: false });
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
      '.appai-my-pet-modal--locked .appai-my-pet-modal__close{display:none;}' +
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
  // exist.
  //
  // STAGING-95 — the probe-then-bulk approach (staging-94) hit a Shopify
  // edge: all 7 individual-section probes returned 2xx, but the bulk call
  // with the 2xx-filtered list still returned 400 on Ritual. Rather than
  // chase the exact combination that trips Shopify's multi-section
  // validator, go fully per-section: one fetch per known-available section,
  // in parallel. Each call carries its own 400/404 independently — one bad
  // section can't poison the batch. 7 tiny GETs beat 1 call that blanks the
  // whole drawer refresh.
  //
  // The sessionStorage cache still helps: it skips the full discovery pass
  // after the first ATC per tab, so subsequent ATCs make exactly N real
  // fetches where N is the known-good count (2-4 for most themes), not the
  // 7-candidate probe sweep.
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

  // Fetch one section on its own and return { name, html } on success or
  // { name, html: null } on any failure. Never rejects — so Promise.all
  // across many sections never short-circuits.
  function fetchOneSection(name) {
    return fetch('/?sections=' + encodeURIComponent(name), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) return { name: name, html: null };
        return r.json().then(function (body) {
          var html = body && typeof body === 'object' ? body[name] : null;
          return { name: name, html: typeof html === 'string' && html ? html : null };
        }).catch(function () { return { name: name, html: null }; });
      })
      .catch(function () { return { name: name, html: null }; });
  }

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
    return Promise.all(CART_SECTIONS_CANDIDATES.map(fetchOneSection))
      .then(function (results) {
        // "Available" = fetched AND returned usable HTML on this discovery
        // pass. A section that 2xx'd but returned null/empty html is NOT
        // kept — staging-95 showed Shopify will sometimes 200 a probe but
        // 400 the real content fetch, so we need the content check too.
        var available = results.filter(function (r) { return r.html; }).map(function (r) { return r.name; });
        console.log(TAG, 'cart-sections available:', available);
        try { sessionStorage.setItem(CART_SECTIONS_SESSION_KEY, JSON.stringify(available)); } catch (_) {}
        return available;
      });
  }

  function applySection(name, html) {
    if (!html) return;
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
  }

  function refreshAndOpenCartDrawer() {
    console.log(TAG, 'refreshAndOpenCartDrawer start');
    discoverCartSections().then(function (available) {
      if (!available.length) {
        // Theme has none of our known sections — skip per-section fetches
        // and fall straight to event dispatch + cart-toggle click below.
        console.log(TAG, 'no known cart sections — skipping render fetches');
        return [];
      }
      // One fetch per known-available section, in parallel. Independent
      // 400/404 handling per section means one bad one can't blank the
      // whole drawer refresh — a Ritual-safe replacement for the bulk call.
      return Promise.all(available.map(fetchOneSection));
    })
      .then(function (results) {
        var applied = [];
        results.forEach(function (r) {
          if (r && r.html) { applySection(r.name, r.html); applied.push(r.name); }
          else if (r) { console.log(TAG, 'section', r.name, 'empty/400 on refresh — skipped'); }
        });
        console.log(TAG, 'sections applied:', applied);
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
    var designsBtn = root.querySelector('[data-appai-my-pet-designs]');
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
      revertLink.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        revertToOriginalDesign();
      });
      revertLink.addEventListener('pointerup', function (event) {
        if (event.pointerType === 'mouse') return;
        event.preventDefault();
        event.stopPropagation();
        revertToOriginalDesign();
      });
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
      emailedRenderIds: {},
      inCartRenderIds: {},
      leaveGuardShown: {},
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
      restorePending: false,
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
      // STAGING-98 — fallback poll on form[name=id] for themes whose
      // variant events don't match any of the 7 names in
      // installInlineVariantListeners (seen on Ritual). Set by
      // installInlineFormPollFallback; cleared by revertToOriginalDesign.
      inlineFormPollTimer: null,
      // STAGING-100 — per-slide pre-swap for carousel-style galleries
      // (Ritual, Horizon-family). List of <img> nodes we wrote our
      // composite onto; each carries data-appai-my-pet-slide-original-src
      // (+ -srcset) so revertVariantSlides can restore them cleanly.
      inlineSlideStash: [],
    };

    function markDismissed(renderId) {
      if (renderId) state.dismissedRenderIds[renderId] = true;
    }
    function isDismissed(renderId) {
      return !!(renderId && state.dismissedRenderIds[renderId]);
    }
    function markEmailed(renderId) {
      if (!renderId) return;
      state.emailedRenderIds[renderId] = true;
      try { window.localStorage.setItem('appai_my_pet_emailed_v1:' + renderId, '1'); } catch (e) {}
    }
    function renderWasEmailed(renderId) {
      if (!renderId) return false;
      if (state.emailedRenderIds[renderId]) return true;
      try {
        if (window.localStorage.getItem('appai_my_pet_emailed_v1:' + renderId) === '1') {
          state.emailedRenderIds[renderId] = true;
          return true;
        }
      } catch (e) {}
      return false;
    }
    function markInCart(renderId) {
      if (renderId) state.inCartRenderIds[renderId] = true;
    }
    function renderInCart(renderId) {
      return !!(renderId && state.inCartRenderIds[renderId]);
    }
    function markLeaveGuardShown(renderId) {
      if (!renderId) return;
      state.leaveGuardShown[renderId] = true;
      try { window.sessionStorage.setItem('appai_my_pet_leave_shown_v1:' + renderId, '1'); } catch (e) {}
    }
    function leaveGuardAlreadyShown(renderId) {
      if (!renderId) return false;
      if (state.leaveGuardShown[renderId]) return true;
      try {
        if (window.sessionStorage.getItem('appai_my_pet_leave_shown_v1:' + renderId) === '1') {
          state.leaveGuardShown[renderId] = true;
          return true;
        }
      } catch (e) {}
      return false;
    }
    function probeCartForRender(renderId) {
      if (!renderId) return;
      fetch('/cart.js', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cart) {
          var items = (cart && cart.items) || [];
          for (var i = 0; i < items.length; i++) {
            var props = items[i].properties || {};
            var id = props._appai_my_pet_render_id;
            if (id && String(id) === String(renderId)) markInCart(renderId);
          }
        })
        .catch(function () {});
    }
    function leaveGuardDestination(link) {
      if (!link || !link.getAttribute) return '';
      var raw = link.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#') return '';
      var lower = raw.trim().toLowerCase();
      if (lower.indexOf('javascript:') === 0 || lower.indexOf('mailto:') === 0 || lower.indexOf('tel:') === 0) return '';
      var url;
      try { url = new URL(link.href, window.location.href); } catch (e) { return ''; }
      if (url.origin !== window.location.origin) return '';
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      var path = url.pathname.toLowerCase();
      if (path === '/cart' || path.indexOf('/cart/') === 0) return '';
      if (path === '/checkout' || path.indexOf('/checkout') === 0 || path.indexOf('/checkouts/') !== -1) return '';
      if (link.closest && link.closest('.appai-my-pet, .appai-my-pet-modal, .appai-my-pet-modal__overlay, .appai-zoom-overlay, cart-drawer, cart-drawer-component, cart-notification, .cart-drawer, #cart-drawer, #CartDrawer, [data-cart-drawer]')) return '';
      return url.href;
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

    function noteRestoreLockOnOpenBtn() {
      if (!state.restorePending || !openBtn) return;
      openBtn.setAttribute('aria-disabled', 'true');
      openBtn.setAttribute('title', 'Loading your design…');
      openBtn.classList.add('appai-my-pet-restore-locked');
      openBtn.setAttribute('data-appai-restore-locked', '1');
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
        noteRestoreLockOnOpenBtn();
        return;
      }
      var message = formatAttemptsMessage(capStatus);
      var press = message === 'Sign up to the Petposterous Press for 2 more custom designs.'
        && capStatus.emailBonusAvailable
        && !capStatus.emailBonusApplied;
      if (press) {
        caption.classList.remove('appai-shimmer');
        if (!caption.querySelector('[data-appai-my-pet-press]')) {
          caption.textContent = '';
          var pressBtn = document.createElement('button');
          pressBtn.type = 'button';
          pressBtn.className = 'appai-my-pet__press';
          pressBtn.setAttribute('data-appai-my-pet-press', '1');
          pressBtn.textContent = message;
          pressBtn.addEventListener('click', function () {
            maybePromptEmailSave({ force: true, trigger: 'try-another-photo' });
          });
          caption.appendChild(pressBtn);
        }
      } else {
        caption.textContent = message;
      }
      if (capStatus.allowed === false) {
        openBtn.setAttribute('aria-disabled', 'true');
        caption.classList.remove('appai-shimmer');
        noteRestoreLockOnOpenBtn();
        return;
      }
      openBtn.removeAttribute('aria-disabled');
      noteRestoreLockOnOpenBtn();
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
          refreshDesignList();
          return state.capStatus;
        })
        .catch(function () { return null; });
    }

    var designSwitchToken = 0;
    var designsPop = null;

    function isDesignSheet() {
      return window.matchMedia('(max-width: 749px)').matches;
    }
    function isFineHover() {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches && !isDesignSheet();
    }
    function noteUserScroll() {
      state.designUserScroll = true;
      clearTimeout(state.designUserScrollTimer);
      state.designUserScrollTimer = setTimeout(function () { state.designUserScroll = false; }, 800);
    }
    function holdPageScroll(fn) {
      var x = window.scrollX || 0;
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var active = document.activeElement;
      fn();
      var next = document.activeElement;
      if (next && next !== active && next !== document.body && next.blur) {
        try { next.blur(); } catch (e) {}
      }
      window.scrollTo(x, y);
      if (window.requestAnimationFrame) window.requestAnimationFrame(function () { window.scrollTo(x, y); });
    }
    function urlForColourMap(map, colour) {
      if (!map || !colour) return '';
      if (map[colour]) return map[colour];
      var want = String(colour).trim().toLowerCase();
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).trim().toLowerCase() === want) return map[keys[i]] || '';
      }
      return '';
    }
    var resignedEdited = {};
    var rendersRefreshFlight = null;
    function forgetCachedThumb(url) {
      try {
        var key = 'appai_my_pet_thumbs_v1:' + shopifyProductId;
        var raw = window.sessionStorage.getItem(key);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || !parsed.urls) return;
        var ids = Object.keys(parsed.urls);
        var changed = false;
        for (var i = 0; i < ids.length; i++) {
          if (parsed.urls[ids[i]] === url || !signedUrlUsable(parsed.urls[ids[i]])) {
            delete parsed.urls[ids[i]];
            changed = true;
          }
        }
        if (!Object.keys(parsed.urls).length) window.sessionStorage.removeItem(key);
        else if (changed) window.sessionStorage.setItem(key, JSON.stringify(parsed));
      } catch (e) {}
    }
    function resignEditedUrl(url) {
      var match = String(url || '').match(/my-pet\/edited\/([0-9a-f-]{8,})/i);
      var renderId = match ? match[1] : '';
      if (!renderId || resignedEdited[renderId]) return;
      resignedEdited[renderId] = true;
      console.log(TAG, 'signed url 400 render=' + renderId);
      forgetCachedThumb(url);
      try { window.sessionStorage.removeItem(RESOLVE_CACHE_PREFIX + renderId); } catch (e) {}
      getJson('my-pet/resolve-render', { renderId: renderId }).then(function (res) {
        if (!res || !res.ok || !res.previewUrl) return;
        writeResolveCache(res);
        console.log(TAG, 'signed url refreshed render=' + renderId);
      });
      if (!rendersRefreshFlight) {
        rendersRefreshFlight = getJson('my-pet/renders', { productId: shopifyProductId }).then(function (res) {
          rendersRefreshFlight = null;
          var list = res && res.ok && Array.isArray(res.renders) ? res.renders : [];
          if (list.length) preloadDesignThumbs(list);
        }, function () { rendersRefreshFlight = null; });
      }
    }
    function preloadUrl(url) {
      if (!url || String(url).indexOf('http') !== 0) return;
      if (!signedUrlUsable(url)) {
        resignEditedUrl(url);
        return;
      }
      try {
        var img = new Image();
        img.decoding = 'async';
        if (previewNeedsCors(url)) img.crossOrigin = 'anonymous';
        img.onerror = function () {
          if (String(url).indexOf('my-pet/edited/') === -1) return;
          resignEditedUrl(url);
        };
        img.src = url;
      } catch (e) {}
    }
    function currentColourName() {
      return checkedProductOption('colour') || currentInlineColour() || (currentVariantInfo(root).colorName || '') || '';
    }
    function currentSizeName() {
      return checkedProductOption('size') || (currentVariantInfo(root).sizeId || '') || '';
    }

    function refreshDesignList() {
      if (!designsBtn) return;
      warmCachedDesignThumbs();
      var count = state.capStatus && state.capStatus.perListingCount;
      if (typeof count !== 'number' || count < 2) {
        designsBtn.hidden = true;
        return;
      }
      getJson('my-pet/renders', { productId: shopifyProductId }).then(function (res) {
        var list = res && res.ok && Array.isArray(res.renders) ? res.renders : [];
        state.designs = list;
        if (list.length < 2) {
          designsBtn.hidden = true;
          closeDesigns();
          return;
        }
        designsBtn.hidden = false;
        designsBtn.textContent = 'Your designs (' + list.length + ')';
        preloadDesignThumbs(list);
        preloadDesignHeroes(list);
        if (designsPop && !designsPop.hidden) fillDesigns(list);
      }).catch(function () { designsBtn.hidden = true; });
    }

    function closeDesigns() {
      if (!designsPop) return;
      cancelDesignHover(true);
      designsPop.hidden = true;
      if (designsBtn) designsBtn.setAttribute('aria-expanded', 'false');
      setSheetScrollLock(false);
    }

    function setSheetScrollLock(on) {
      if (!document.body) return;
      if (on) {
        document.body.setAttribute('data-appai-my-pet-scroll-lock', '1');
        document.body.style.overflow = 'hidden';
        return;
      }
      if (document.body.getAttribute('data-appai-my-pet-scroll-lock') !== '1') return;
      document.body.style.overflow = '';
      document.body.removeAttribute('data-appai-my-pet-scroll-lock');
    }

    function shirtHex(colorName) {
      var want = String(colorName || '').trim().toLowerCase();
      if (!want) return '#f3f3f3';
      var radios = document.querySelectorAll('input[type="radio"]');
      for (var i = 0; i < radios.length; i++) {
        if (String(radios[i].value || '').trim().toLowerCase() !== want) continue;
        var radioName = String(radios[i].name || '').toLowerCase();
        if (radioName.indexOf('color') === -1 && radioName.indexOf('colour') === -1) continue;
        var label = radios[i].closest ? radios[i].closest('label') : null;
        if (!label && radios[i].id) label = document.querySelector('label[for="' + radios[i].id + '"]');
        var host = label || radios[i].parentElement;
        if (!host) continue;
        var nodes = [host];
        var painted = host.querySelectorAll ? host.querySelectorAll('*') : [];
        for (var n = 0; n < painted.length && n < 6; n++) nodes.push(painted[n]);
        for (var k = 0; k < nodes.length; k++) {
          if (nodes[k] === host) continue;
          var rect = null;
          try { rect = nodes[k].getBoundingClientRect(); } catch (e2) {}
          if (rect && (rect.width > 48 || rect.height > 48 || rect.width < 8)) continue;
          var bg = '';
          try { bg = window.getComputedStyle(nodes[k]).backgroundColor; } catch (e) {}
          var hex = rgbToHex(bg);
          if (hex) return hex;
        }
      }
      var known = {
        black: '#1a1a1a',
        white: '#f7f7f7',
        sage: '#9DC183',
        'dark grey': '#4B4B4B',
        'dark gray': '#4B4B4B',
        'light grey': '#d4d4d4',
        'light gray': '#d4d4d4',
        red: '#C41E3A',
        blue: '#2563EB',
        pink: '#F4A6C3',
      };
      return known[want] || '#f3f3f3';
    }

    function rgbToHex(bg) {
      var text = String(bg || '');
      var m = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
      if (!m) return '';
      if (m[4] != null && Number(m[4]) === 0) return '';
      function hex(n) {
        var s = Number(n).toString(16);
        return s.length === 1 ? '0' + s : s;
      }
      return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
    }

    function designLabelPair(item) {
      var saved = storedChoiceFor(shopifyProductId, item.renderId);
      var color = saved.colorName || item.colorName || '';
      var size = saved.sizeName || item.sizeName || '';
      if (color && size) return color + ' · ' + size;
      return color || size || '';
    }

    function fillDesigns(list) {
      var row = designsPop.querySelector('.appai-my-pet-designs__row');
      if (!row) return;
      row.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var active = item.renderId === state.renderId;
        var name = 'Design ' + (i + 1);
        var pair = designLabelPair(item);
        var savedChoice = storedChoiceFor(shopifyProductId, item.renderId);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'appai-my-pet-designs__thumb';
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.setAttribute('aria-label', name + (pair ? ', ' + pair : '') + (active ? ', current' : ''));
        var frame = document.createElement('span');
        frame.className = 'appai-my-pet-designs__frame';
        var shirt = shirtHex(savedChoice.colorName || item.colorName || '');
        frame.style.backgroundColor = shirt;
        var img = document.createElement('img');
        img.alt = '';
        assignImgSrc(img, item.thumbnailUrl || '');
        frame.appendChild(img);
        var zoom = document.createElement('span');
        zoom.className = 'appai-my-pet-designs__zoom';
        zoom.style.backgroundColor = shirt;
        var zoomImg = document.createElement('img');
        zoomImg.alt = '';
        assignImgSrc(zoomImg, item.thumbnailUrl || '');
        zoom.appendChild(zoomImg);
        var title = document.createElement('span');
        title.className = 'appai-my-pet-designs__name';
        title.textContent = name;
        var meta = document.createElement('span');
        meta.className = 'appai-my-pet-designs__pair';
        meta.textContent = pair;
        btn.appendChild(frame);
        btn.appendChild(zoom);
        btn.appendChild(title);
        if (pair) btn.appendChild(meta);
        if (active) {
          var current = document.createElement('span');
          current.className = 'appai-my-pet-designs__current';
          current.textContent = 'Current';
          btn.appendChild(current);
        }
        btn.addEventListener('pointerdown', (function (chosen) {
          return function (event) {
            if (event.button != null && event.button !== 0) return;
            var targetName = '';
            try {
              targetName = (event.target && event.target.className)
                ? String(event.target.className).split(/\s+/)[0]
                : (event.target && event.target.tagName);
            } catch (e) {}
            clearTimeout(state.hoverTimer);
            selectListedDesign(chosen, targetName || 'pointerdown');
          };
        })(item));
        btn.addEventListener('click', (function (chosen) {
          return function (event) {
            var targetName = '';
            try { targetName = event.target && event.target.tagName; } catch (e) {}
            selectListedDesign(chosen, targetName || 'click');
          };
        })(item));
        if (isFineHover()) {
          btn.addEventListener('mouseenter', (function (chosen) {
            return function () {
              clearTimeout(state.hoverTimer);
              state.hoverTimer = setTimeout(function () { previewDesignHover(chosen); }, 180);
            };
          })(item));
          btn.addEventListener('mouseleave', function () {
            clearTimeout(state.hoverTimer);
            cancelDesignHover(true);
          });
        }
        row.appendChild(btn);
      }
    }

    function placeDesigns() {
      if (!designsPop || !designsBtn) return;
      var sheet = isDesignSheet();
      designsPop.classList.toggle('appai-my-pet-designs--sheet', sheet);
      setSheetScrollLock(sheet);
      var panel = designsPop.querySelector('.appai-my-pet-designs');
      if (!panel) return;
      if (sheet) {
        panel.style.left = '';
        panel.style.bottom = '';
        panel.style.width = '';
        return;
      }
      panel.style.width = 'max-content';
      panel.style.maxWidth = (window.innerWidth - 16) + 'px';
      var rect = designsBtn.getBoundingClientRect();
      var width = panel.offsetWidth || 360;
      var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      panel.style.left = left + 'px';
      panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    }

    function revealHeroAboveSheet() {
      if (!isDesignSheet() || state.designUserScroll || !designsPop || designsPop.hidden) return;
      var hero = (state.inlineHero && document.body.contains(state.inlineHero) && state.inlineHero) || findProductHeroImg() || findVisibleHeroImg();
      if (!hero || !hero.getBoundingClientRect) return;
      var rect = hero.getBoundingClientRect();
      var panel = designsPop.querySelector('.appai-my-pet-designs');
      var limit = panel ? panel.getBoundingClientRect().top : window.innerHeight * 0.6;
      var pad = 12;
      if (rect.top >= pad && rect.bottom <= limit - pad) return;
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var available = limit - pad * 2;
      var next = rect.height >= available || rect.top < pad
        ? y + rect.top - pad
        : y + rect.bottom - (limit - pad);
      window.scrollTo({ top: Math.max(0, next), behavior: 'smooth' });
    }

    function warmCachedDesignThumbs() {
      try {
        var key = 'appai_my_pet_thumbs_v1:' + shopifyProductId;
        var raw = window.sessionStorage.getItem(key);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        var urls = parsed && parsed.urls;
        if (!urls) return;
        // Signed thumbs last about an hour. A tab that stays open keeps
        // sessionStorage, so a later load must not replay a dead token.
        var stale = !parsed.at || (Date.now() - parsed.at > 50 * 60 * 1000);
        var ids = Object.keys(urls);
        var live = {};
        for (var i = 0; i < ids.length; i++) {
          if (!stale && signedUrlUsable(urls[ids[i]])) live[ids[i]] = urls[ids[i]];
        }
        if (Object.keys(live).length !== ids.length) {
          if (!Object.keys(live).length) window.sessionStorage.removeItem(key);
          else window.sessionStorage.setItem(key, JSON.stringify({ at: parsed.at, urls: live }));
        }
        if (stale || !Object.keys(live).length) return;
        ids = Object.keys(live);
        for (var j = 0; j < ids.length; j++) preloadUrl(live[ids[j]]);
      } catch (e) {}
    }

    function preloadDesignThumbs(list) {
      if (!list || !list.length) return;
      var key = 'appai_my_pet_thumbs_v1:' + shopifyProductId;
      var urls = {};
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var url = item && item.thumbnailUrl;
        if (!url) continue;
        urls[item.renderId] = url;
        preloadUrl(url);
      }
      try {
        var keep = {};
        var keepIds = Object.keys(urls);
        for (var k = 0; k < keepIds.length; k++) {
          if (signedUrlUsable(urls[keepIds[k]])) keep[keepIds[k]] = urls[keepIds[k]];
        }
        window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), urls: keep }));
      } catch (e) {}
      console.log(TAG, 'design thumbs preloaded', Object.keys(urls).length);
    }

    function preloadDesignHeroes(list) {
      if (!list || !list.length) return;
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var url = list[i] && list[i].heroUrl;
        if (!url || String(url).indexOf('http') !== 0) continue;
        n++;
        decodeHeroUrl(url);
      }
      if (n) console.log(TAG, 'design heroes preloaded', n);
    }

    function decodeHeroUrl(url) {
      var path = urlPath(url);
      if (!path) return Promise.resolve(false);
      if (state.decodedHeroPaths && state.decodedHeroPaths[path]) return Promise.resolve(true);
      state.heroDecodeWait = state.heroDecodeWait || {};
      if (state.heroDecodeWait[path]) return state.heroDecodeWait[path];
      state.heroDecodeFlight = state.heroDecodeFlight || {};
      state.heroDecodeFlight[path] = true;
      var promise = new Promise(function (resolve) {
        var img = new Image();
        img.decoding = 'async';
        if (previewNeedsCors(url)) {
          try { img.crossOrigin = 'anonymous'; } catch (e) {}
        }
        var finish = function () { markHeroDecoded(url); resolve(true); };
        img.onload = function () {
          if (typeof img.decode === 'function') img.decode().then(finish, finish);
          else finish();
        };
        img.onerror = function () {
          delete state.heroDecodeFlight[path];
          if (String(url).indexOf('my-pet/edited/') !== -1) resignEditedUrl(url);
          resolve(false);
        };
        img.src = url;
      });
      state.heroDecodeWait[path] = promise;
      return promise;
    }

    function prefetchDesigns(list) {
      var colour = currentColourName();
      for (var i = 0; i < list.length; i++) {
        (function (item) {
          var saved = storedChoiceFor(shopifyProductId, item.renderId);
          var cached = readResolveCache(item.renderId);
          var pending = cached
            ? Promise.resolve(cached)
            : getJson('my-pet/resolve-render', { renderId: item.renderId });
          pending.then(function (res) {
            if (!res || !res.ok || !res.previewUrl) return;
            writeResolveCache(res);
            var map = res.previewUrlsByColor || {};
            preloadUrl(urlForColourMap(map, colour) || res.previewUrl);
            if (saved.colorName && saved.colorName !== colour) preloadUrl(urlForColourMap(map, saved.colorName));
          });
        })(list[i]);
      }
    }

    function openDesigns() {
      if (!designsBtn || designsBtn.hidden || state.restorePending) return;
      if (!designsPop) {
        designsPop = document.createElement('div');
        designsPop.className = 'appai-my-pet-designs-backdrop';
        designsPop.hidden = true;
        designsPop.innerHTML = '<div class="appai-my-pet-designs" role="dialog" aria-label="Your designs"><div class="appai-my-pet-designs__row"></div><button type="button" class="appai-my-pet-designs__done">Done</button></div>';
        document.body.appendChild(designsPop);
        designsPop.addEventListener('click', function (event) {
          if (event.target === designsPop) closeDesigns();
        });
        designsPop.querySelector('.appai-my-pet-designs__done').addEventListener('click', closeDesigns);
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') closeDesigns();
        });
        window.addEventListener('resize', function () { if (designsPop && !designsPop.hidden) placeDesigns(); });
        window.addEventListener('wheel', noteUserScroll, { passive: true });
        window.addEventListener('touchmove', noteUserScroll, { passive: true });
        document.addEventListener('keydown', function (event) {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown' || event.key === ' ') noteUserScroll();
        });
        document.addEventListener('click', function (event) {
          if (!designsPop || designsPop.hidden || isDesignSheet()) return;
          var target = event.target;
          if (!target || !target.closest) return;
          if (target.closest('.appai-my-pet-designs') || target.closest('[data-appai-my-pet-designs]')) return;
          closeDesigns();
        });
        window.addEventListener('scroll', function () {
          if (!designsPop || designsPop.hidden || isDesignSheet()) return;
          placeDesigns();
        }, { passive: true });
      }
      fillDesigns(state.designs || []);
      designsPop.hidden = false;
      placeDesigns();
      designsBtn.setAttribute('aria-expanded', 'true');
      prefetchDesigns(state.designs || []);
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { window.requestAnimationFrame(revealHeroAboveSheet); });
      } else {
        revealHeroAboveSheet();
      }
    }

    function paintHeroUrl(url) {
      if (!url || state.reverted) return;
      var hero = findVisibleHeroImg() || findProductHeroImg();
      if (!hero || !galleryImgAllowed(hero)) return;
      state.inlineHero = hero;
      swapInlineHero(hero, url);
    }

    function cancelDesignHover(restore) {
      var stash = state.hoverStash;
      state.designHovering = false;
      state.designHoverId = null;
      state.hoverStash = null;
      if (!restore || !stash || state.designSwitchColour) return;
      state.previewUrlByColor = stash.map || {};
      state.previewUrl = stash.previewUrl || state.previewUrl;
      state.holdColour = null;
      var colour = currentColourName();
      paintHeroUrl(urlForColourMap(state.previewUrlByColor, colour) || state.previewUrl);
    }

    function previewDesignHover(item) {
      if (!isFineHover() || !item || state.designSwitchColour) return;
      if (item.renderId === state.renderId || state.designHoverId === item.renderId) return;
      state.designHoverId = item.renderId;
      state.designHovering = true;
      if (!state.hoverStash) {
        state.hoverStash = {
          map: Object.assign({}, state.previewUrlByColor || {}),
          previewUrl: state.previewUrl || '',
        };
      }
      var colour = currentColourName();
      var cached = readResolveCache(item.renderId);
      var pending = cached
        ? Promise.resolve(cached)
        : getJson('my-pet/resolve-render', { renderId: item.renderId });
      pending.then(function (res) {
        if (state.designHoverId !== item.renderId || !state.designHovering) return;
        if (!res || !res.ok || !res.previewUrl) return;
        writeResolveCache(res);
        var map = (res.previewUrlsByColor && typeof res.previewUrlsByColor === 'object') ? res.previewUrlsByColor : {};
        var url = urlForColourMap(map, colour) || res.previewUrl;
        paintHeroUrl(url);
      });
    }

    function clearDesignSwitchBadge() {
      if (state.restorePending) return;
      var badge = document.querySelector('.appai-my-pet-restore');
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    }

    function namesMatch(a, b) {
      return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    function releaseDesignSwitch(token, force) {
      if (token != null && token !== designSwitchToken) return;
      var colourOk = !state.designSwitchColour || namesMatch(currentColourName(), state.designSwitchColour);
      var sizeOk = !state.designSwitchSize || namesMatch(currentSizeName(), state.designSwitchSize);
      var media = '';
      try { if (state.inlineHero) media = mediaColourForImg(state.inlineHero) || ''; } catch (e) {}
      var mediaOk = !media || !state.designSwitchColour || namesMatch(media, state.designSwitchColour);
      if (!force && (!colourOk || !sizeOk || !mediaOk) && Date.now() < (state.designSwitchDeadline || 0)) {
        setTimeout(function () { releaseDesignSwitch(token, false); }, 150);
        return;
      }
      state.designSwitchColour = null;
      state.designSwitchSize = null;
    }

    function finishDesignSwitch(token) {
      if (token != null && token !== designSwitchToken) return;
      clearTimeout(state.designSwitchTimer);
      state.designSwitchTimer = null;
      clearDesignSwitchBadge();
      clearDesignCover();
      releaseDesignSwitch(token, true);
    }

    function armDesignSwitch() {
      var token = ++designSwitchToken;
      state.designSwitchDeadline = Date.now() + 8000;
      clearTimeout(state.designSwitchTimer);
      var tries = 0;
      function arm() {
        if (token !== designSwitchToken) return;
        if (showRestoreBadge() || tries > 20) return;
        tries++;
        setTimeout(arm, 80);
      }
      arm();
      state.designSwitchTimer = setTimeout(function () { finishDesignSwitch(token); }, 8000);
      return token;
    }

    function waitForDesignHero(url, token) {
      function tick() {
        if (token !== designSwitchToken) return;
        var hero = state.inlineHero || findProductHeroImg() || findVisibleHeroImg();
        var src = hero ? String(hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '') : '';
        var ready = hero && url && hero.naturalWidth > 0 && urlsMatch(src, url);
        if (!ready) {
          paintDesignCover();
          setTimeout(tick, 60);
          return;
        }
        var done = function () {
          if (token !== designSwitchToken) return;
          clearDesignSwitchBadge();
          var still = findVisibleHeroImg() || state.inlineHero || findProductHeroImg();
          var stillSrc = still ? String(still.currentSrc || (still.getAttribute && still.getAttribute('src')) || '') : '';
          if (url && still && still.naturalWidth > 0 && urlsMatch(stillSrc, url)) {
            clearDesignCover();
            releaseDesignSwitch(token, false);
            return;
          }
          paintDesignCover();
          setTimeout(tick, 60);
        };
        if (hero.decode) hero.decode().then(done).catch(done);
        else done();
      }
      tick();
    }

    function showResolvedDesign(res, colourOverride, recompositeMissing) {
      if (state.reverted || revertedFlagOn(shopifyProductId)) return null;
      if (!res || !res.ok || !res.previewUrl) return null;
      writeResolveCache(res);
      state.renderId = res.renderId;
      state.jobId = res.jobId;
      state.previewUrl = res.previewUrl;
      probeCartForRender(res.renderId);
      state.previewUrlByColor = (res.previewUrlsByColor && typeof res.previewUrlsByColor === 'object')
        ? Object.assign({}, res.previewUrlsByColor)
        : {};
      logColourMap('resolved');
      preloadPreviewUrls(state.previewUrlByColor);
      writeStoredRender(shopifyProductId, res.renderId, res.jobId);
      if (previewMode !== 'inline') return res.previewUrl;
      var colour = colourOverride || currentInlineColour();
      var key = colour ? canonicalPreviewColor(colour) : '';
      var mapped = (key && state.previewUrlByColor[key]) || (colour && state.previewUrlByColor[colour]) || '';
      var activationUrl = mapped || res.previewUrl;
      if (designTransitionActive()) {
        state.previewUrl = activationUrl;
        state.designTransition.url = activationUrl;
        if (colour) state.designTransition.colour = colour;
        state.inlineApplied = true;
        var heroNow = findVisibleHeroImg() || findProductHeroImg();
        if (heroNow) state.inlineHero = heroNow;
        installInlineATCIntercept();
        fillMissingColours(res.renderId, state.renderGeneration || 0);
        scheduleTransitionSwap(state.designTransition.token);
        return activationUrl;
      }
      activateInlinePreviewWithRetry(activationUrl);
      fillMissingColours(res.renderId, state.renderGeneration || 0);
      if (recompositeMissing && !mapped && colour) swapInlineColor(colour);
      return activationUrl;
    }

    function reapplyActiveDesign() {
      if (!state.renderId) return;
      console.log(TAG, 're-apply');
      state.reverted = false;
      persistReverted(shopifyProductId, false);
      var gen = bumpRenderGeneration('re-apply');
      var colour = currentInlineColour() || (currentVariantInfo(root).colorName || '');
      var url = urlForColourMap(state.previewUrlByColor, colour) || state.previewUrl;
      if (url) {
        activateInlinePreviewWithRetry(url);
        fillMissingColours(state.renderId, gen);
        return;
      }
      getJson('my-pet/resolve-render', { renderId: state.renderId }).then(function (res) {
        if (!res || !res.ok || !res.previewUrl || state.reverted) return;
        if (!generationCurrent(gen, state.renderId)) return;
        showResolvedDesign(res, colour);
      }).catch(function () {});
    }

    function selectListedDesign(item, fromTarget) {
      var targetLabel = fromTarget || 'click';
      if (!item || state.restorePending) {
        console.log(TAG, 'design click', 'target=' + targetLabel, 'handled=false', 'reason=pending');
        return;
      }
      if (state.designSelectId === item.renderId && Date.now() - (state.designSelectAt || 0) < 500) {
        console.log(TAG, 'design click', 'target=' + targetLabel, 'handled=false', 'reason=duplicate');
        return;
      }
      state.designSelectId = item.renderId;
      state.designSelectAt = Date.now();
      console.log(TAG, 'design click', 'target=' + targetLabel, 'render=' + String(item.renderId).slice(0, 8), 'handled=true');
      clearTimeout(state.hoverTimer);
      cancelDesignHover(false);
      if (!isDesignSheet()) closeDesigns();
      var saved = storedChoiceFor(shopifyProductId, item.renderId);
      var fallbackColor = currentColourName();
      var fallbackSize = currentSizeName();
      var colorName = saved.colorName || fallbackColor;
      var sizeName = saved.sizeName || fallbackSize;
      if (colorName) noteColourSelection(colorName, false);
      var same = item.renderId === state.renderId
        && namesMatch(colorName, fallbackColor)
        && namesMatch(sizeName, fallbackSize);
      var wasReverted = !!state.reverted || revertedFlagOn(shopifyProductId);
      if (wasReverted) {
        state.reverted = false;
        persistReverted(shopifyProductId, false);
        console.log(TAG, 're-apply');
      }
      var gen = bumpRenderGeneration('select');
      if (!(same && !wasReverted)) state.selectionOnce = gen;
      var token = null;
      if (!(same && !wasReverted)) {
        token = beginDesignTransition(item.renderId, colorName, sizeName);
        state.designSwitchColour = colorName || '';
        state.designSwitchSize = sizeName || '';
        if (state.applyExactVariant && colorName) {
          state.applyExactVariant(colorName, sizeName || fallbackSize || 'M');
        }
        if (state.designTransition && state.designTransition.token === token) {
          state.designTransition.expectsRerender = !!(state.variantDispatchedAt && (Date.now() - state.variantDispatchedAt) < 300);
          if (state.designTransition.expectsRerender) armTransitionFallback(token);
        }
      }
      if (same && !wasReverted) {
        console.log(TAG, 'design select', item.renderId,
          'stored colour=' + (saved.colorName || '(none)'),
          'stored size=' + (saved.sizeName || '(none)'),
          'selected colour=' + (fallbackColor || '(none)'),
          'selected size=' + (fallbackSize || '(none)'));
        if (designsPop && !designsPop.hidden) fillDesigns(state.designs || []);
        revealHeroAboveSheet();
        lockProductGallery();
        if (state.previewUrlByColor) swapVariantSlides(state.previewUrlByColor);
        var sameUrl = previewUrlForColour(colorName);
        if (sameUrl) paintColourNow(colorName, sameUrl);
        fillMissingColours(state.renderId, gen);
        return;
      }
      state.renderId = item.renderId;
      var cachedNow = readResolveCache(item.renderId);
      if (cachedNow && cachedNow.previewUrl) {
        state.previewUrl = cachedNow.previewUrl;
        state.previewUrlByColor = (cachedNow.previewUrlsByColor && typeof cachedNow.previewUrlsByColor === 'object')
          ? Object.assign({}, cachedNow.previewUrlsByColor)
          : {};
        state.inlineApplied = true;
      } else {
        state.previewUrlByColor = {};
        state.previewUrl = '';
        state.inlineApplied = true;
        holdMissingColours();
      }
      var pending = cachedNow
        ? Promise.resolve(cachedNow)
        : getJson('my-pet/resolve-render', { renderId: item.renderId });
      pending.then(function (res) {
        if (!token || token !== designSwitchToken || !generationCurrent(gen, item.renderId)) return;
        if (!res || !res.ok || !res.previewUrl) {
          endDesignTransition(token, 'resolve-failed');
          return;
        }
        var picked = activateStoredDesign(shopifyProductId, item.renderId, res.jobId || item.jobId, fallbackColor, fallbackSize);
        state.designSwitchColour = picked.colorName || colorName || '';
        state.designSwitchSize = picked.sizeName || sizeName || '';
        if (state.designTransition && state.designTransition.token === token) {
          state.designTransition.colour = state.designSwitchColour;
          state.designTransition.sizeName = state.designSwitchSize;
        }
        var selectedColour = currentColourName();
        var selectedSize = currentSizeName();
        console.log(TAG, 'design select', item.renderId,
          'stored colour=' + (saved.colorName || '(none)'),
          'stored size=' + (saved.sizeName || '(none)'),
          'selected colour=' + (selectedColour || '(none)'),
          'selected size=' + (selectedSize || '(none)'));
        showResolvedDesign(res, state.designSwitchColour || selectedColour, true);
        if (designsPop && !designsPop.hidden) fillDesigns(state.designs || []);
        revealHeroAboveSheet();
      }).catch(function () {
        if (token && token === designSwitchToken) endDesignTransition(token, 'resolve-failed');
      });
    }

    if (designsBtn) {
      designsBtn.setAttribute('aria-expanded', 'false');
      designsBtn.addEventListener('click', function () {
        if (designsPop && !designsPop.hidden) closeDesigns();
        else openDesigns();
      });
    }

    function restoreControlInCart(el) {
      return !!(el && el.closest && el.closest('cart-drawer, cart-drawer-component, cart-notification, .cart-drawer, #cart-drawer, #CartDrawer, [data-cart-drawer]'));
    }

    function eachRestoreControl(fn) {
      var nodes;
      try {
        nodes = document.querySelectorAll(
          'button[name="add"], form[action*="/cart/add"] button[type="submit"], button.sticky-add-to-cart__button, .sticky-add-to-cart__button, .shopify-payment-button, .shopify-payment-button__button, shopify-buy-it-now-button, shopify-accelerated-checkout, [data-appai-my-pet-open]'
        );
      } catch (e) { return; }
      for (var i = 0; i < nodes.length; i++) {
        if (restoreControlInCart(nodes[i])) continue;
        fn(nodes[i]);
      }
    }

    function lockRestoreControl(el) {
      if (!el || el.getAttribute('data-appai-restore-locked') === '1') return;
      el.setAttribute('data-appai-restore-locked', '1');
      el.setAttribute('data-appai-restore-had-aria', el.hasAttribute('aria-disabled') ? '1' : '0');
      el.setAttribute('data-appai-restore-aria', el.getAttribute('aria-disabled') || '');
      el.setAttribute('data-appai-restore-had-title', el.hasAttribute('title') ? '1' : '0');
      el.setAttribute('data-appai-restore-title', el.getAttribute('title') || '');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('title', 'Loading your design…');
      if (el.classList) el.classList.add('appai-my-pet-restore-locked');
    }

    function unlockRestoreControl(el) {
      if (!el || el.getAttribute('data-appai-restore-locked') !== '1') return;
      if (el.classList) el.classList.remove('appai-my-pet-restore-locked');
      if (el.getAttribute('data-appai-restore-had-aria') === '1') el.setAttribute('aria-disabled', el.getAttribute('data-appai-restore-aria') || '');
      else el.removeAttribute('aria-disabled');
      if (el.getAttribute('data-appai-restore-had-title') === '1') el.setAttribute('title', el.getAttribute('data-appai-restore-title') || '');
      else el.removeAttribute('title');
      el.removeAttribute('data-appai-restore-locked');
      el.removeAttribute('data-appai-restore-had-aria');
      el.removeAttribute('data-appai-restore-aria');
      el.removeAttribute('data-appai-restore-had-title');
      el.removeAttribute('data-appai-restore-title');
    }

    function lockRestoreButtons() {
      if (!state.restorePending) return;
      eachRestoreControl(lockRestoreControl);
      noteRestoreLockOnOpenBtn();
    }

    function unlockRestoreButtons() {
      eachRestoreControl(unlockRestoreControl);
      var leftovers;
      try { leftovers = document.querySelectorAll('[data-appai-restore-locked="1"]'); } catch (e) { leftovers = []; }
      for (var i = 0; i < leftovers.length; i++) unlockRestoreControl(leftovers[i]);
    }

    function showRestoreBadge() {
      var hero = findProductHeroImg() || findVisibleHeroImg();
      if (!hero || !hero.parentNode) return false;
      var host = hero.parentNode;
      var existing = document.querySelector('.appai-my-pet-restore');
      if (existing && existing.parentNode === host) return true;
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var pos = '';
      try { pos = window.getComputedStyle(host).position; } catch (e) {}
      if ((!pos || pos === 'static') && !host.getAttribute('data-appai-restore-host')) {
        host.setAttribute('data-appai-restore-host', '1');
        host.style.position = 'relative';
      }
      var badge = document.createElement('div');
      badge.className = 'appai-my-pet-restore';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      var spin = document.createElement('span');
      spin.className = 'appai-my-pet-restore__spin';
      spin.setAttribute('aria-hidden', 'true');
      badge.appendChild(spin);
      badge.appendChild(document.createTextNode('Loading your design…'));
      host.appendChild(badge);
      return true;
    }

    function clearRestoreChrome() {
      var badge = document.querySelector('.appai-my-pet-restore');
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      var hosts;
      try { hosts = document.querySelectorAll('[data-appai-restore-host]'); } catch (e) { hosts = []; }
      for (var i = 0; i < hosts.length; i++) {
        hosts[i].style.position = '';
        hosts[i].removeAttribute('data-appai-restore-host');
      }
      unlockRestoreButtons();
    }

    function checkedProductOption(kind) {
      var pickers;
      try { pickers = document.querySelectorAll('variant-picker'); } catch (e) { return ''; }
      var picker = null;
      for (var p = 0; p < pickers.length; p++) {
        if (pickers[p].getAttribute('data-template-product-match') !== 'true') continue;
        if (pickers[p].closest && (pickers[p].closest('product-card') || pickers[p].closest('quick-add-dialog'))) continue;
        picker = pickers[p];
        break;
      }
      if (!picker) return '';
      var radios = picker.querySelectorAll('input[type="radio"]:checked');
      for (var i = 0; i < radios.length; i++) {
        var ctx = String(radios[i].name || '').toLowerCase();
        var box = radios[i].closest ? radios[i].closest('fieldset, [data-option-name]') : null;
        if (box) ctx += ' ' + String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
        var isSize = ctx.indexOf('size') !== -1 && ctx.indexOf('color') === -1 && ctx.indexOf('colour') === -1;
        var isColour = ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1;
        if (kind === 'size' && isSize) return String(radios[i].value || '').trim();
        if (kind === 'colour' && isColour) return String(radios[i].value || '').trim();
      }
      return '';
    }

    // Related-product colour chips are not the main product's swatches.
    // Capture handlers log them and leave the click alone. A real card
    // link still reaches the leave guard.
    function relatedSwatchKind(event) {
      var t = event && event.target;
      if (!t || !t.closest) return '';
      if (t.nodeType !== 1) t = t.parentElement;
      if (!t || !t.closest) return '';
      var host = t.closest('card-colour-swatches');
      if (!host || !host.closest('product-recommendations, .product-recommendations')) return '';
      if (t.closest('button[data-swatch-more], .card-colour-swatches__more')) return 'more';
      if (t.closest('button[data-variant-id], .card-colour-swatches__swatch')) return 'chip';
      return '';
    }

    function logRelatedSwatch(handler, event) {
      var kind = relatedSwatchKind(event);
      if (!kind) return '';
      console.log(TAG, 'related ' + kind, 'handler=' + handler, 'defaultPrevented=' + !!(event && event.defaultPrevented));
      return kind;
    }

    function clickInMainProduct(event) {
      var t = event && event.target;
      if (!t) return false;
      if (t.nodeType !== 1) t = t.parentElement;
      if (!t || !t.closest) return false;
      var section = mainProductSection();
      if (!section) return true;
      return !!section.contains(t);
    }

    function blockRestoreAction(event) {
      if (logRelatedSwatch('restore-lock', event)) return;
      if (!clickInMainProduct(event)) return;
      var surface = logCapture('restore-lock', event);
      if (surface === 'main-image' || surface === 'zoom-chrome' || surface === 'zoom-thumb') return;
      if (!state.restorePending) return;
      var node = event.target;
      if (!node) return;
      if (node.nodeType !== 1) node = node.parentElement;
      if (!node || !node.closest) return;
      if (!node.closest('[data-appai-restore-locked="1"]')) return;
      event.preventDefault();
      event.stopPropagation();
    }

    // UX 6 — restore a same-device, cross-session render on page load so
    // "Add My Pet" reopens the existing preview instead of offering a fresh
    // (cap-consuming) generation. The loading badge goes up as soon as a
    // stored render is found, before resolve-render returns, so the shopper
    // can't buy the stock design during the wait.
    (function restoreStoredRender() {
      state.applyExactVariant = applyExactVariant;
      var stored = readStoredRender(shopifyProductId);
      if (!stored || !stored.renderId) return;
      if (stored.reverted || revertedFlagOn(shopifyProductId)) {
        console.log(TAG, 'restore skipped, reverted');
        state.reverted = true;
        state.renderId = stored.renderId;
        state.jobId = stored.jobId || null;
        var cachedRevert = readResolveCache(stored.renderId);
        var keepUrls = function (res) {
          if (!state.reverted || !res || !res.ok || !res.previewUrl) return;
          state.jobId = res.jobId || state.jobId;
          state.previewUrl = res.previewUrl;
          state.previewUrlByColor = (res.previewUrlsByColor && typeof res.previewUrlsByColor === 'object')
            ? Object.assign({}, res.previewUrlsByColor)
            : {};
          writeResolveCache(res);
          preloadPreviewUrls(state.previewUrlByColor);
        };
        if (cachedRevert) keepUrls(cachedRevert);
        else getJson('my-pet/resolve-render', { renderId: stored.renderId }).then(keepUrls).catch(function () {});
        return;
      }
      state.restorePending = true;
      var finished = false;
      var badgeTimer = null;
      function armBadge() {
        if (finished) return;
        if (showRestoreBadge()) return;
        badgeTimer = setTimeout(armBadge, 80);
      }
      lockRestoreButtons();
      armBadge();
      setTimeout(lockRestoreButtons, 300);
      setTimeout(lockRestoreButtons, 1000);
      if (!state._restoreBlocker) {
        state._restoreBlocker = blockRestoreAction;
        document.addEventListener('click', blockRestoreAction, true);
        document.addEventListener('submit', blockRestoreAction, true);
        document.addEventListener('keydown', function (event) {
          if (!state.restorePending) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          blockRestoreAction(event);
        }, true);
      }
      function finishRestore(ok) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (badgeTimer) clearTimeout(badgeTimer);
        var apply = function () {
          state.restorePending = false;
          if (!ok && state.inlineApplied) revertToOriginalDesign();
          clearRestoreChrome();
          if (state.capStatus) renderAttemptsCaption(state.capStatus);
        };
        if (ok && window.requestAnimationFrame) {
          window.requestAnimationFrame(function () { window.requestAnimationFrame(apply); });
        } else {
          apply();
        }
      }
      var timer = setTimeout(function () { finishRestore(false); }, 8000);

      function restoredColour() {
        var restoreInfo = currentVariantInfo(root);
        var restoreSw = readSwatchColor(root);
        if (restoreSw && restoreInfo.colorName && restoreSw !== restoreInfo.colorName) return restoreSw;
        return restoreInfo.colorName || restoreSw || null;
      }

      function sameOption(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
      }

      function radioAvailable(radio) {
        if (!radio || radio.disabled) return false;
        if (radio.getAttribute('aria-disabled') === 'true') return false;
        if (radio.getAttribute('data-option-available') === 'false') return false;
        return true;
      }

      function optionContext(radio) {
        var ctx = String(radio.name || '').toLowerCase();
        var box = radio.closest ? radio.closest('fieldset, [data-option-name]') : null;
        if (box) ctx += ' ' + String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
        var legend = box && box.querySelector ? box.querySelector('legend') : null;
        if (legend) ctx += ' ' + String(legend.textContent || '').toLowerCase();
        return ctx;
      }

      function radioKind(radio) {
        var ctx = optionContext(radio);
        if (ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1) return 'colour';
        if (ctx.indexOf('size') !== -1) return 'size';
        return '';
      }

      function productPicker() {
        var pickers;
        try { pickers = document.querySelectorAll('variant-picker'); } catch (e) { return null; }
        for (var p = 0; p < pickers.length; p++) {
          if (pickers[p].getAttribute('data-template-product-match') !== 'true') continue;
          if (pickers[p].closest && (pickers[p].closest('product-card') || pickers[p].closest('quick-add-dialog'))) continue;
          return pickers[p];
        }
        return null;
      }

      function findKindRadio(picker, kind, value, force) {
        if (!picker || !value) return null;
        var radios = picker.querySelectorAll('input[type="radio"]');
        for (var i = 0; i < radios.length; i++) {
          if (radioKind(radios[i]) !== kind) continue;
          if (!sameOption(radios[i].value, value)) continue;
          if (radios[i].disabled) continue;
          // The theme marks a colour sold out for the size currently on the
          // page (Sage has no XS). The variant we already resolved is the
          // real combo, so select it anyway.
          if (!force && !radioAvailable(radios[i])) continue;
          return radios[i];
        }
        return null;
      }

      function markRadio(radio, variantId) {
        var all;
        try { all = document.querySelectorAll('input[type="radio"]'); } catch (e) { all = []; }
        for (var i = 0; i < all.length; i++) {
          if (all[i].name !== radio.name || all[i] === radio) continue;
          all[i].removeAttribute('data-current-checked');
        }
        radio.checked = true;
        if (variantId) {
          radio.setAttribute('data-variant-id', variantId);
          radio.setAttribute('data-option-available', 'true');
          radio.removeAttribute('aria-disabled');
        }
        radio.setAttribute('data-current-checked', 'true');
      }

      function applyExactVariant(colorName, sizeName) {
        if (!colorName) return null;
        var colours = allColorOptions(root);
        var sizes = allSizeOptions(root);
        var color = colorName;
        var size = sizeName;
        for (var c = 0; c < colours.length; c++) if (sameOption(colours[c], colorName)) color = colours[c];
        for (var s = 0; s < sizes.length; s++) if (sameOption(sizes[s], sizeName)) size = sizes[s];
        var names = [];
        try { names = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
        var variant = findExactVariant(root, color, size || null);
        if (!variant) return null;
        var actualColor = findOptionValue(variant, names, ['color', 'colour']) || colorName;
        var actualSize = findOptionValue(variant, names, ['size']) || sizeName;
        var picker = productPicker();
        var id = String(variant.id);
        var form = findMainProductForm(root);
        var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
        holdPageScroll(function () {
          window.__appaiSelectingDefaultSize = true;
          try {
            var sizeRadio = findKindRadio(picker, 'size', actualSize, true);
            var colourRadio = findKindRadio(picker, 'colour', actualColor, true);
            var sizeNeeds = !!(sizeRadio && !sizeRadio.checked);
            var colourNeeds = !!(colourRadio && !colourRadio.checked);
            // Check both, then fire one change. A second change aborts the
            // theme's section fetch (AbortError in variant-picker.js).
            if (sizeRadio) markRadio(sizeRadio, null);
            if (colourRadio) markRadio(colourRadio, id);
            var dispatch = null;
            if (colourNeeds || (sizeNeeds && colourRadio)) dispatch = colourRadio;
            else if (sizeNeeds) dispatch = sizeRadio;
            state.variantDispatchedAt = 0;
            if (dispatch) {
              dispatch.setAttribute('data-variant-id', id);
              dispatch.setAttribute('data-option-available', 'true');
              dispatch.removeAttribute('aria-disabled');
              dispatch.dispatchEvent(new Event('change', { bubbles: true }));
              state.variantDispatchedAt = Date.now();
            } else if (idInput && String(idInput.value) !== id) {
              idInput.value = id;
              idInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (idInput && String(idInput.value) !== id) idInput.value = id;
          } finally {
            window.__appaiSelectingDefaultSize = false;
          }
        });
        // A design select swaps the gallery itself, once. Scheduling another
        // pass here walks the same nodes again before the theme's own
        // section render arrives.
        if (state.selectionOnce !== (state.renderGeneration || 0)) scheduleGallerySync('variant');
        return actualColor;
      }

      function selectRestoredVariant(storedRender, res) {
        if (window.__appaiVariantOnLoad) return restoredColour();
        var color = (storedRender && storedRender.colorName) || (res && res.colorName) || '';
        var size = (storedRender && storedRender.sizeName) || 'M';
        if (!color) return applyExactVariant(restoredColour(), 'M') || restoredColour();
        var info = currentVariantInfo(root);
        if (sameOption(info.colorName, color) && sameOption(info.sizeId, size)) return info.colorName;
        return applyExactVariant(color, size) || restoredColour();
      }

      function waitForHero(url, fromCache) {
        function tick() {
          if (finished) return;
          showRestoreBadge();
          lockRestoreButtons();
          var hero = state.inlineHero || findProductHeroImg() || findVisibleHeroImg();
          var src = hero ? String(hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '') : '';
          var ready = hero && (urlsMatch(src, url) || urlsMatch(hero.__appaiAssertUrl, url));
          if (!ready) {
            setTimeout(tick, 100);
            return;
          }
          var pass = function () { finishRestore(true); };
          var miss = function () {
            if (finished) return;
            if (fromCache) fetchFresh();
            else finishRestore(false);
          };
          if (hero.decode) {
            hero.decode().then(pass).catch(function () {
              if (hero.naturalWidth > 0) pass();
              else miss();
            });
          } else if (hero.complete && hero.naturalWidth > 0) pass();
          else {
            hero.addEventListener('load', pass, { once: true });
            hero.addEventListener('error', miss, { once: true });
          }
        }
        tick();
      }

      function applyResolved(res, fromCache) {
        if (finished || state.reverted || revertedFlagOn(shopifyProductId)) return;
        if (!res || !res.ok || !res.previewUrl) {
          if (fromCache) { fetchFresh(); return; }
          clearStoredRender(shopifyProductId);
          finishRestore(false);
          return;
        }
        var restoreColor = selectRestoredVariant(stored, res);
        var activationUrl = showResolvedDesign(res, restoreColor);
        console.log(TAG, 'restore activate: effectiveColor=' + (restoreColor || '(unknown)') +
          ' fromSession=' + !!fromCache);
        if (previewMode !== 'inline') {
          finishRestore(true);
          return;
        }
        waitForHero(activationUrl, fromCache);
      }

      var refreshing = false;
      function fetchFresh() {
        if (finished || refreshing) return;
        refreshing = true;
        getJson('my-pet/resolve-render', { renderId: stored.renderId })
          .then(function (res) { refreshing = false; applyResolved(res, false); })
          .catch(function () { refreshing = false; if (!finished) finishRestore(false); });
      }

      var cached = readResolveCache(stored.renderId);
      if (cached) applyResolved(cached, true);
      else fetchFresh();
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
      console.log(TAG, 'design colours preloaded', urls.length);
      for (var i = 0; i < urls.length; i++) decodeHeroUrl(urls[i]);
    }

    // STAGING-98 diagnostic — log each colour → url tail so a Black mockup
    // showing under the White key (wrong mapping) is immediately visible.
    // Tail strips the signed query + path prefix so the log line stays
    // scannable. Safe to call with an empty map.
    function logPreviewUrlTails(label, urlsByColor) {
      try {
        var keys = Object.keys(urlsByColor || {});
        for (var i = 0; i < keys.length; i++) {
          var name = keys[i];
          var tail = String(urlsByColor[name] || '').split('?')[0].split('/').pop();
          console.log(TAG, label + ' map:', name, '→', tail);
        }
      } catch (e) {}
    }

    // STAGING-98 — activateInlinePreview can fail (return false) on a hard
    // refresh if restoreStoredRender resolves BEFORE the product gallery is
    // in the DOM. Without this retry, the restore silently gives up and
    // state.inlineApplied stays false — the hero never swaps, the observers
    // never install, and every subsequent swatch click bails silently
    // (matches the symptom the user reported). 5 × 500ms = 2.5s budget,
    // well within the "page felt loaded" window on 3G.
    function activateInlinePreviewWithRetry(url) {
      var attempts = 0;
      var MAX = 5;
      function tryOnce() {
        if (state.reverted || revertedFlagOn(shopifyProductId)) return;
        attempts++;
        var ok = activateInlinePreview(url);
        if (ok) {
          console.log(TAG, 'inline activate: success on attempt', attempts);
          return;
        }
        if (attempts >= MAX) {
          console.warn(TAG, 'inline activate: hero not found after', attempts, 'attempts — giving up');
          return;
        }
        console.log(TAG, 'inline activate: hero not found, retrying in 500ms (attempt', attempts, 'of', MAX, ')');
        setTimeout(tryOnce, 500);
      }
      tryOnce();
    }

    function findProductHeroImg() {
      // Priority list: most-specific (is-active media item) → broad
      // (product section <img>). Skip anything inside our own block so we
      // don't accidentally swap our own thumbnail. Only the main gallery —
      // the zoom dialog's copy of the same markup is hidden and must not
      // win, or Add My Pet relabels while the visible hero stays stock.
      var scope = mainMediaGallery() || productSectionScope();
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
        var nodes = [];
        try { nodes = scope.querySelectorAll ? scope.querySelectorAll(SELECTORS[i]) : []; } catch (e) { continue; }
        for (var n = 0; n < nodes.length; n++) {
          var el = nodes[n];
          if (!el || el.tagName !== 'IMG') continue;
          if (!galleryImgAllowed(el)) continue;
          if (el.closest && el.closest('dialog, zoom-dialog')) continue;
          return el;
        }
      }
      return null;
    }

    function urlTail(url) {
      return String(url || '').split('#')[0].split('?')[0].split('/').pop();
    }

    function urlPath(url) {
      var raw = String(url || '').split('#')[0];
      if (!raw) return '';
      try { return new URL(raw, window.location.href).pathname || ''; }
      catch (e) { return raw.split('?')[0]; }
    }

    // Pathname only. Signed query strings (Supabase tokens, CDN params)
    // must not keep a swapped hero from counting as the custom image.
    function urlsMatch(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;
      var pa = urlPath(a);
      var pb = urlPath(b);
      if (pa && pb && pa === pb) return true;
      var ta = urlTail(a);
      var tb = urlTail(b);
      return ta.length > 8 && ta === tb;
    }

    // The visible pixels are currentSrc. The src attribute can already be
    // ours while the browser is still painting a srcset/stock candidate.
    function heroShowsCustom(hero, url) {
      if (!hero || !url) return false;
      var current = String(hero.currentSrc || '');
      if (current) return urlsMatch(current, url);
      if (hero.complete && hero.naturalWidth > 0) {
        var attr = (hero.getAttribute && hero.getAttribute('src')) || hero.src || '';
        return !!(attr && urlsMatch(attr, url));
      }
      return false;
    }

    function visibleHeroShowsCustom(url) {
      return heroShowsCustom(resolveActiveHero(), url);
    }

    function markHeroDecoded(url) {
      var path = urlPath(url);
      if (!path) return;
      state.decodedHeroPaths = state.decodedHeroPaths || {};
      state.decodedHeroPaths[path] = url;
    }

    function colourUrlReady(url) {
      var path = urlPath(url);
      return !!(path && state.decodedHeroPaths && state.decodedHeroPaths[path]);
    }

    function preferDecodedUrl(url) {
      var path = urlPath(url);
      var cached = path && state.decodedHeroPaths && state.decodedHeroPaths[path];
      return cached || url;
    }

    // currentSrc can match before the browser has painted the bytes.
    // The cover stays until the visible hero has actually decoded.
    function heroReady(hero, url) {
      if (!heroShowsCustom(hero, url)) return false;
      return !!(hero.complete && hero.naturalWidth > 0);
    }

    function visibleHeroReady(url) {
      var t = state.designTransition;
      return heroReady(resolveActiveHero(t && t.colour), url);
    }

    function nodeStamp(el) {
      if (!el) return '(none)';
      if (!el.__appaiMyPetNodeId) {
        state._heroNodeSeq = (state._heroNodeSeq || 0) + 1;
        try { el.__appaiMyPetNodeId = 'n' + state._heroNodeSeq; } catch (e) { return 'anon'; }
      }
      var id = el.id ? '#' + el.id : '';
      var cls = (el.className && typeof el.className === 'string')
        ? '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      return el.__appaiMyPetNodeId + '<' + String(el.tagName || '?').toLowerCase() + id + cls + '>';
    }

    function sourceSummary(img) {
      var picture = img && img.closest ? img.closest('picture') : null;
      if (!picture) return 'picture=false';
      var sources = picture.querySelectorAll('source');
      var withSrcset = 0;
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].getAttribute('srcset')) withSrcset++;
      }
      return 'picture=true sources=' + sources.length + ' srcsetSources=' + withSrcset;
    }

    function describeImg(el) {
      if (!el) return '(none)';
      var srcset = el.getAttribute ? (el.getAttribute('srcset') || '') : '';
      var sizes = el.getAttribute ? (el.getAttribute('sizes') || '') : '';
      var connected = false;
      try { connected = !!(el.isConnected || document.body.contains(el)); } catch (e) {}
      return nodeStamp(el) +
        ' connected=' + connected +
        ' src=' + urlTail(el.getAttribute ? el.getAttribute('src') : '') +
        ' currentSrc=' + urlTail(el.currentSrc || el.src || '') +
        ' srcsetLen=' + srcset.length +
        ' sizes=' + (sizes ? String(sizes).slice(0, 80) : '(none)') +
        ' ' + sourceSummary(el);
    }

    function closestProductSection(node) {
      if (!node || !node.closest) return null;
      return node.closest('.shopify-section, [data-section-id]');
    }

    function mainProductSection() {
      return closestProductSection(root);
    }

    // The product block lives in a div.shopify-section, not a <section>.
    // Walking up to <main> also contains recommendations, so every image
    // query stops at this product's own section.
    function productSectionScope() {
      return mainProductSection() || root.parentNode || document;
    }

    function mainMediaGallery() {
      var section = mainProductSection();
      var scope = section || root.parentNode;
      if (!scope || !scope.querySelector) return null;
      try { return scope.querySelector('media-gallery, product-media-gallery'); } catch (e) { return null; }
    }

    // Horizon replaces the gallery element. The product section stays, so
    // the observers that have to write before paint watch the section.
    function stableGalleryHost() {
      var section = mainProductSection();
      if (section && section !== document && section !== document.body) return section;
      return mainMediaGallery();
    }

    function mainZoomDialog() {
      var gallery = mainMediaGallery();
      var zoom = gallery && gallery.querySelector
        ? gallery.querySelector('zoom-dialog, dialog.dialog-zoomed-gallery__dialog')
        : null;
      if (zoom) return zoom;
      var section = mainProductSection();
      if (!section || !section.querySelector) return null;
      try { return section.querySelector('zoom-dialog, dialog.dialog-zoomed-gallery__dialog'); } catch (e) { return null; }
    }

    function galleryImgAllowed(img) {
      if (!img || img.tagName !== 'IMG') return false;
      if (isCoverImg(img)) return false;
      if (img.closest && img.closest('.appai-my-pet, .appai-my-pet-designs, .appai-my-pet-modal, .appai-my-pet-modal__overlay, .appai-zoom-overlay')) return false;
      var gallery = mainMediaGallery();
      var zoom = mainZoomDialog();
      var inGallery = !!(gallery && gallery.contains && gallery.contains(img));
      var inZoom = !!(zoom && zoom.contains && zoom.contains(img));
      var banned = img.closest && img.closest('product-recommendations, product-card, cart-drawer, cart-drawer-component, .cart-drawer, #cart-drawer, #CartDrawer, quick-add-dialog, quick-add-modal, [data-quick-add]');
      var mainSec = mainProductSection();
      var sec = closestProductSection(img);
      var otherSection = !!(mainSec && sec && sec !== mainSec);
      if (banned || otherSection || (!inGallery && !inZoom)) {
        if (!img.__appaiSkipLogged) {
          img.__appaiSkipLogged = true;
          var why = banned ? 'related/cart/quick-add' : (otherSection ? 'other product section' : 'not in main gallery');
          console.log(TAG, 'skip img outside main gallery', why, String(img.getAttribute('alt') || img.className || '').slice(0, 60));
        }
        return false;
      }
      return true;
    }

    function abortShadowFetches() {
      var list = state.shadowAborts || [];
      state.shadowAborts = [];
      for (var i = 0; i < list.length; i++) {
        try { list[i].abort(); } catch (e) {}
      }
    }

    function bumpRenderGeneration(reason) {
      state.renderGeneration = (state.renderGeneration || 0) + 1;
      state.gallerySyncGeneration = (state.gallerySyncGeneration || 0) + 1;
      state.gallerySyncTimers = false;
      state.shadowEpoch = (state.shadowEpoch || 0) + 1;
      state.warmToken = 'gen-' + state.renderGeneration;
      if (state.prefetchCtrl) {
        try { state.prefetchCtrl.abort(); } catch (e) {}
        state.prefetchCtrl = null;
      }
      abortShadowFetches();
      console.log(TAG, 'render generation', state.renderGeneration, reason || '');
      return state.renderGeneration;
    }

    function generationCurrent(gen, renderId) {
      if (gen != null && gen !== (state.renderGeneration || 0)) return false;
      if (renderId && state.renderId && renderId !== state.renderId) return false;
      if (state.reverted) return false;
      return true;
    }

    function logColourMap(reason) {
      var keys = [];
      try { keys = Object.keys(state.previewUrlByColor || {}); } catch (e) {}
      console.log(TAG, 'colour map', reason || '', keys.join(', ') || '(empty)');
    }

    function findVisibleHeroImg() {
      var scope = mainMediaGallery() || productSectionScope();
      var imgs;
      try { imgs = scope.querySelectorAll('img'); } catch (e) { return null; }
      var best = null;
      var bestArea = 0;
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!galleryImgAllowed(img)) continue;
        if (img.closest && img.closest('dialog, zoom-dialog')) continue;
        var rect;
        try { rect = img.getBoundingClientRect(); } catch (e) { continue; }
        if (rect.width < 160 || rect.height < 160) continue;
        var ix = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
        var iy = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        var area = ix * iy;
        if (area > bestArea) { bestArea = area; best = img; }
      }
      return best;
    }

    function selectedHeroColour() {
      var t = state.designTransition;
      if (t && t.colour) return t.colour;
      return currentColourName() || currentInlineColour() || '';
    }

    function mediaIdForColour(colour) {
      var map = getMediaIdByColor(root);
      if (!map || !colour) return '';
      if (map[colour]) return String(map[colour]);
      var want = String(colour).trim().toLowerCase();
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).trim().toLowerCase() === want) return String(map[keys[i]]);
      }
      return '';
    }

    function slideIsHidden(slide) {
      if (!slide) return true;
      if (slide.hasAttribute && (slide.hasAttribute('hidden') || slide.hasAttribute('inert'))) return true;
      var aria = slide.getAttribute && slide.getAttribute('aria-hidden');
      if (aria === 'true') return true;
      try {
        var cs = window.getComputedStyle(slide);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      } catch (e) {}
      return false;
    }

    function heroImgIn(node) {
      if (!node || !node.querySelectorAll) return null;
      var imgs;
      try { imgs = node.querySelectorAll('img.product-media__image, img'); } catch (e) { return null; }
      var best = null;
      var bestArea = 0;
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!img || img.tagName !== 'IMG') continue;
        if (!galleryImgAllowed(img)) continue;
        if (looksLikeThumb(img)) continue;
        if (img.closest && img.closest('dialog, zoom-dialog')) continue;
        var rect;
        try { rect = img.getBoundingClientRect(); } catch (e2) { continue; }
        var area = Math.max(0, rect.width) * Math.max(0, rect.height);
        if (area < 160 * 160) continue;
        if (area > bestArea) { bestArea = area; best = img; }
      }
      return best;
    }

    // Hidden slides have no layout box, so the visible-area search cannot
    // see them. The colour's own <img> still has to be the one we read.
    function imgForMediaId(mediaId) {
      var scope = mainMediaGallery() || productSectionScope();
      if (!scope || !mediaId || !scope.querySelectorAll) return null;
      var hosts = [];
      try {
        hosts = scope.querySelectorAll(
          '[data-media-id="' + mediaId + '"], slideshow-slide[slide-id="' + mediaId + '"]'
        );
      } catch (e) { return null; }
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (host.closest && host.closest('button, dialog, zoom-dialog')) continue;
        var img = null;
        try { img = host.querySelector('img.product-media__image, img'); } catch (e2) {}
        if (!img || img.tagName !== 'IMG') continue;
        if (!galleryImgAllowed(img) || looksLikeThumb(img)) continue;
        return img;
      }
      return null;
    }

    function perColourSlides() {
      return pageGallerySlides().length > 1;
    }

    // Horizon's slideshow scrolls to a slide. It does not change that
    // slide's <img>. Colour changes use this so the visible hero and the
    // slide swap never write the same node.
    function showColourSlide(colorName) {
      if (customGalleryLocked()) return false;
      if (!colorName || !perColourSlides()) return false;
      var mediaId = mediaIdForColour(colorName);
      if (!mediaId) return false;
      var gallery = mainMediaGallery();
      var shows = [];
      var main = gallery && (gallery.slideshow || (gallery.querySelector && gallery.querySelector('slideshow-component')));
      if (main) shows.push(main);
      var zoom = mainZoomDialog();
      if (zoom && (zoom.open || zoom.hasAttribute && zoom.hasAttribute('open'))) {
        var zoomShow = zoom.querySelector && zoom.querySelector('slideshow-component');
        if (zoomShow) shows.push(zoomShow);
      }
      var selected = false;
      for (var i = 0; i < shows.length; i++) {
        if (!shows[i] || typeof shows[i].select !== 'function') continue;
        try {
          shows[i].select({ id: String(mediaId) }, null, { animate: false });
          selected = true;
        } catch (e3) {}
      }
      if (!selected) return false;
      var hero = imgForMediaId(mediaId);
      if (hero) {
        state.inlineHero = hero;
        installHeroGuard(hero);
      }
      colourMark('slide select', colorName + ' media=' + mediaId);
      return true;
    }

    // The slide for the selected colour. Horizon does not mark it .is-active,
    // so the old selector list returned null and the guard stayed on the
    // base/black slide. Never the first product-media__image.
    function resolveActiveHero(colour) {
      if (customGalleryLocked()) {
        var pinned = state.inlineHero;
        if (pinned && document.body.contains(pinned)) return pinned;
        return findVisibleHeroImg();
      }
      var want = colour || selectedHeroColour();
      var mediaId = want ? mediaIdForColour(want) : '';
      if (mediaId) {
        var mapped = imgForMediaId(mediaId);
        if (mapped) return mapped;
        if (colour) return null;
      }
      var slides = pageGallerySlides();
      for (var s = 0; s < slides.length; s++) {
        if (slideIsHidden(slides[s])) continue;
        var shown = heroImgIn(slides[s]);
        if (shown) return shown;
      }
      return null;
    }

    function findActiveSlideImg() {
      return resolveActiveHero();
    }

    function responsiveLeftovers(img) {
      if (!img || !img.getAttribute) return false;
      if (img.getAttribute('srcset') || img.getAttribute('sizes')) return true;
      var picture = img.closest ? img.closest('picture') : null;
      if (!picture) return false;
      var sources = picture.querySelectorAll('source');
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].getAttribute('srcset') || sources[i].getAttribute('sizes')) return true;
      }
      return false;
    }

    function previewWinning(img, url) {
      if (!img || !url) return false;
      var cur = img.currentSrc || img.src || '';
      return urlsMatch(cur, url) && !responsiveLeftovers(img);
    }

    // STAGING-105 — <picture><source srcset> wins over <img src>. Clearing the
    // attribute is not enough on a freshly inserted theme node: the browser
    // keeps the already-chosen candidate. Detach the <source> nodes (stashed
    // on the img so revert can put them back) and drop srcset + sizes.
    function detachPictureSources(img) {
      var picture = img && img.closest ? img.closest('picture') : null;
      if (!picture) return 0;
      var sources = picture.querySelectorAll('source');
      if (!sources.length) return 0;
      if (!img.__appaiDetachedSources) img.__appaiDetachedSources = [];
      var list = [];
      for (var i = 0; i < sources.length; i++) list.push(sources[i]);
      var n = 0;
      for (var j = 0; j < list.length; j++) {
        var src = list[j];
        if (src.__appaiDetached) continue;
        if (!src.hasAttribute('data-appai-my-pet-source-original-srcset')) {
          src.setAttribute('data-appai-my-pet-source-original-srcset', src.getAttribute('srcset') || '');
          var dataSrcset = src.getAttribute('data-srcset');
          if (dataSrcset != null) src.setAttribute('data-appai-my-pet-source-original-data-srcset', dataSrcset);
          var srcSizes = src.getAttribute('sizes');
          if (srcSizes != null) src.setAttribute('data-appai-my-pet-source-original-sizes', srcSizes);
        }
        src.__appaiDetached = true;
        src.__appaiDetachedParent = picture;
        src.__appaiDetachedNext = src.nextSibling;
        try { picture.removeChild(src); } catch (e) { continue; }
        img.__appaiDetachedSources.push(src);
        n++;
      }
      return n;
    }

    function restoreDetachedSources(img) {
      var list = img && img.__appaiDetachedSources;
      if (!list || !list.length) return 0;
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var src = list[i];
        if (!src) continue;
        var parent = src.__appaiDetachedParent;
        try {
          if (parent && !src.parentNode) parent.insertBefore(src, src.__appaiDetachedNext || null);
        } catch (e) {}
        if (src.hasAttribute('data-appai-my-pet-source-original-srcset')) {
          var orig = src.getAttribute('data-appai-my-pet-source-original-srcset');
          if (orig) src.setAttribute('srcset', orig);
          else src.removeAttribute('srcset');
          src.removeAttribute('data-appai-my-pet-source-original-srcset');
        }
        if (src.hasAttribute('data-appai-my-pet-source-original-data-srcset')) {
          var origData = src.getAttribute('data-appai-my-pet-source-original-data-srcset');
          if (origData) src.setAttribute('data-srcset', origData);
          src.removeAttribute('data-appai-my-pet-source-original-data-srcset');
        }
        if (src.hasAttribute('data-appai-my-pet-source-original-sizes')) {
          var origSizes = src.getAttribute('data-appai-my-pet-source-original-sizes');
          if (origSizes) src.setAttribute('sizes', origSizes);
          src.removeAttribute('data-appai-my-pet-source-original-sizes');
        }
        src.__appaiDetached = false;
        n++;
      }
      img.__appaiDetachedSources = [];
      return n;
    }

    function stashHeroOriginals(img) {
      if (!img || img.hasAttribute('data-appai-my-pet-original-src') || img.hasAttribute('data-appai-my-pet-slide-original-src')) return;
      img.setAttribute('data-appai-my-pet-original-src', img.getAttribute('src') || '');
      var origSrcset = img.getAttribute('srcset');
      if (origSrcset) img.setAttribute('data-appai-my-pet-original-srcset', origSrcset);
      var origSizes = img.getAttribute('sizes');
      if (origSizes) img.setAttribute('data-appai-my-pet-original-sizes', origSizes);
    }

    function srcAlready(img, url) {
      if (!img || !url) return false;
      var attr = img.getAttribute ? (img.getAttribute('src') || '') : '';
      if (attr === url || img.src === url) return true;
      return urlsMatch(attr, url) || urlsMatch(img.src || '', url);
    }

    // Disconnect before our own src/srcset writes so the hero and section
    // observers do not see them. Nested calls share one pause.
    function pauseMediaObservers(img) {
      state.mediaWriting = (state.mediaWriting || 0) + 1;
      if (state.mediaWriting !== 1) return;
      state._pausedHeroObs = img && img.__appaiMyPetObserver;
      state._pausedSectionObs = state.productMediaObserver;
      state._pausedZoomObs = state.zoomObserver;
      state._pausedGalleryObs = state.inlineGalleryObserver;
      try { if (state._pausedHeroObs) state._pausedHeroObs.disconnect(); } catch (e) {}
      try { if (state._pausedSectionObs) state._pausedSectionObs.disconnect(); } catch (e2) {}
      try { if (state._pausedZoomObs) state._pausedZoomObs.disconnect(); } catch (e3) {}
      try { if (state._pausedGalleryObs) state._pausedGalleryObs.disconnect(); } catch (e4) {}
    }

    function resumeMediaObservers(img) {
      state.mediaWriting = Math.max(0, (state.mediaWriting || 1) - 1);
      if (state.mediaWriting !== 0) return;
      var heroObs = state._pausedHeroObs;
      var sectionObs = state._pausedSectionObs;
      var zoomObs = state._pausedZoomObs;
      var galleryObs = state._pausedGalleryObs;
      state._pausedHeroObs = null;
      state._pausedSectionObs = null;
      state._pausedZoomObs = null;
      state._pausedGalleryObs = null;
      if (heroObs && img) {
        try { heroObs.observe(img, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] }); } catch (e) {}
      }
      if (sectionObs) {
        var container = productSectionScope();
        if (container && container !== document) {
          try {
            sectionObs.observe(container, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['src', 'srcset'],
            });
          } catch (e2) {}
        }
      }
      if (zoomObs) {
        var zoomTarget = zoomObserveTarget();
        if (zoomTarget) {
          try {
            zoomObs.observe(zoomTarget, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['open', 'src', 'srcset'],
            });
          } catch (e3) {}
        }
      }
      if (galleryObs && state.galleryGuardRoot && document.contains(state.galleryGuardRoot)) {
        try { galleryObs.observe(state.galleryGuardRoot, { childList: true, subtree: true }); } catch (e4) {}
      }
    }

    function previewNeedsCors(url) {
      var u = String(url || '');
      if (u.indexOf('http') !== 0) return false;
      if (u.indexOf('blob:') === 0 || u.indexOf('data:') === 0) return false;
      if (u.indexOf('myshopify.com') !== -1 || u.indexOf('cdn.shopify') !== -1 || u.indexOf('shopifycdn') !== -1) return false;
      return true;
    }

    function assignImgSrc(img, url) {
      if (!img || !url) return;
      if (previewNeedsCors(url)) {
        try { img.crossOrigin = 'anonymous'; } catch (e) {}
      }
      try { img.src = url; } catch (e2) {}
    }

    function applyPreviewSrc(img, url) {
      if (!img || !url) return;
      url = preferDecodedUrl(url);
      if (!galleryImgAllowed(img)) return;
      var same = srcAlready(img, url);
      var dirty = !!(img.getAttribute('srcset') || img.getAttribute('sizes'));
      if (same && !dirty) return;
      pauseMediaObservers(img);
      try {
        stashHeroOriginals(img);
        if (img.getAttribute('sizes') && !img.hasAttribute('data-appai-my-pet-original-sizes') && !img.hasAttribute('data-appai-my-pet-slide-original-sizes')) {
          img.setAttribute('data-appai-my-pet-original-sizes', img.getAttribute('sizes'));
        }
        try { img.removeAttribute('srcset'); } catch (e) {}
        try { img.removeAttribute('sizes'); } catch (e) {}
        if (img.dataset) {
          try { delete img.dataset.src; } catch (e) {}
          try { delete img.dataset.srcset; } catch (e) {}
        }
        detachPictureSources(img);
        if (state.colourPaint && state.colourPaint.url && urlsMatch(state.colourPaint.url, url)) {
          try { img.decoding = 'sync'; } catch (eDec) {}
        }
        assignImgSrc(img, url);
        img.__appaiAssertUrl = url;
        img.__appaiAssertAt = Date.now();
        img.setAttribute('data-appai-my-pet-preview', 'true');
      } finally {
        resumeMediaObservers(img);
      }
    }

    function heroAssertTargets(colour) {
      var el = resolveActiveHero(colour);
      if (!el) return [];
      try { if (!document.body.contains(el)) return []; } catch (e) { return []; }
      return [el];
    }

    function logHeroNodes(reason, colorName, expectedUrl) {
      var guard = state.inlineHero;
      var visible = findVisibleHeroImg();
      var active = findActiveSlideImg();
      console.log(TAG, 'hero-assert', reason,
        'colour=' + (colorName || '?'),
        'expected=' + urlTail(expectedUrl));
      console.log(TAG, '  guard', describeImg(guard));
      console.log(TAG, '  visible', describeImg(visible), 'sameAsGuard=' + (visible === guard));
      console.log(TAG, '  activeSlide', describeImg(active),
        'sameAsGuard=' + (active === guard),
        'sameAsVisible=' + (active === visible));
    }

    function heroAssertGiveUp(node, colour) {
      if (!node) return false;
      var now = Date.now();
      var id = nodeStamp(node);
      var stop = state.heroAssertStop;
      if (stop && stop.id === id && now - stop.t < 8000) return true;
      var hits = state.heroAssertHits || [];
      var kept = [];
      var same = 0;
      for (var i = 0; i < hits.length; i++) {
        if (now - hits[i].t >= 1500) continue;
        kept.push(hits[i]);
        if (hits[i].id === id) same++;
      }
      kept.push({ id: id, t: now });
      state.heroAssertHits = kept;
      if (same >= 3) {
        state.heroAssertStop = { id: id, t: now, colour: colour || '' };
        console.log(TAG, 'hero-assert loop broken colour=' + (colour || ''));
        return true;
      }
      return false;
    }

    function scheduleHeroVerify(colorName, expectedUrl) {
      if (customGalleryLocked()) return;
      var token = (state._heroVerifyToken = (state._heroVerifyToken || 0) + 1);
      setTimeout(function () {
        if (token !== state._heroVerifyToken || !state.inlineApplied) return;
        var liveVerify = liveColourChoice();
        colorName = liveVerify.colour || colorName;
        expectedUrl = liveVerify.url || expectedUrl;
        logHeroNodes('verify+300ms', colorName, expectedUrl);
        var targets = heroAssertTargets(colorName);
        var fixed = 0;
        for (var i = 0; i < targets.length; i++) {
          if (previewWinning(targets[i], expectedUrl)) continue;
          applyPreviewSrc(targets[i], expectedUrl);
          fixed++;
        }
        if (!fixed) return;
        console.warn(TAG, 'hero-assert verify+300ms MISMATCH — re-asserted',
          colorName, 'nodes=' + fixed, 'expected=' + urlTail(expectedUrl));
        setTimeout(function () {
          if (token !== state._heroVerifyToken || !state.inlineApplied) return;
          logHeroNodes('verify+300ms after re-assert', colorName, expectedUrl);
        }, 300);
      }, 300);
    }

    // Writes a slide's own colour file onto that slide. A visible slide is
    // never given another colour's file; the slideshow selects that slide.
    function reassertColourPreview(reason, colorName, url) {
      var liveNow = liveColourChoice();
      if (customGalleryLocked()) {
        colorName = liveNow.colour || colorName;
        url = liveNow.url || url;
        var pinned = (state.inlineHero && document.body.contains(state.inlineHero))
          ? state.inlineHero
          : findVisibleHeroImg();
        if (!pinned || !url) return;
        if (srcAlready(pinned, url) && !pinned.getAttribute('srcset') && !pinned.getAttribute('sizes')) return;
        if (heroAssertGiveUp(pinned, colorName)) return;
        applyPreviewSrc(pinned, url);
        state.inlineHero = pinned;
        return;
      }
      if (colorName && liveNow.colour && !namesMatch(colorName, liveNow.colour)) {
        logColourRace(state.sectionFetchSeq || 0, liveNow);
        if (perColourSlides()) showColourSlide(liveNow.colour);
        else {
          colorName = liveNow.colour;
          url = liveNow.url || url;
        }
      }
      if (!url && colorName) url = previewUrlForColour(colorName);
      if (!url) return;
      var targets = heroAssertTargets(colorName);
      if (!targets.length) return;
      var now = Date.now();
      var wrote = 0;
      var slides = perColourSlides();
      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        if (state.swapMaskWaiting && state.holdOldHero && el === state.holdOldHero) continue;
        var own = mediaColourForImg(el);
        var ownUrl = own ? previewUrlForColour(own) : '';
        var useUrl = url;
        if (slides) {
          if (!ownUrl || (own && colorName && !namesMatch(own, colorName))) continue;
          useUrl = ownUrl;
        }
        if (!useUrl) continue;
        // Skip a node we just wrote. currentSrc lags the attribute write, so
        // the guard observer would otherwise re-enter until the stack melts.
        // A different node (theme replacement) still gets written.
        if (el.__appaiAssertUrl === useUrl && (now - (el.__appaiAssertAt || 0)) < 250) continue;
        if (srcAlready(el, useUrl) && !el.getAttribute('srcset') && !el.getAttribute('sizes')) continue;
        if (previewWinning(el, useUrl)) {
          el.__appaiAssertUrl = useUrl;
          el.__appaiAssertAt = now;
          continue;
        }
        el.__appaiAssertUrl = useUrl;
        el.__appaiAssertAt = now;
        applyPreviewSrc(el, useUrl);
        wrote++;
      }
      if (targets.length && state.inlineHero && !document.body.contains(state.inlineHero)) {
        state.inlineHero = targets[0];
      }
      var colourChanged = !!(colorName && colorName !== state._lastLoggedColour);
      if (!wrote && !colourChanged) return;
      state._lastLoggedColour = colorName || state._lastLoggedColour;
      logHeroNodes(reason + (wrote ? '' : ' (no write)'), colorName, url);
      scheduleHeroVerify(colorName, url);
    }

    function canonicalPreviewColor(raw) {
      var want = String(raw || '').trim().toLowerCase();
      if (!want) return null;
      var map = state.previewUrlByColor || {};
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).trim().toLowerCase() === want) return keys[i];
      }
      return String(raw).trim();
    }

    // Colour or size control the shopper clicked. Size changes still
    // replace the hero node, so they take the same mask path; the colour
    // used for the preview stays the one already selected.
    function colorFromSwatchEvent(event) {
      var node = event && event.target;
      if (!node) return null;
      if (node.nodeType === 3) node = node.parentNode;
      if (!node || node.nodeType !== 1) return null;
      if (node.closest && node.closest('.appai-my-pet')) return null;
      var probed = node;
      if (node.tagName !== 'INPUT' && node.tagName !== 'SELECT' && node.tagName !== 'OPTION') {
        var label = node.closest ? node.closest('label') : null;
        var viaLabel = null;
        if (label) {
          viaLabel = label.querySelector('input, select');
          if (!viaLabel && label.htmlFor) viaLabel = document.getElementById(label.htmlFor);
        }
        probed = viaLabel || (node.closest ? node.closest('input, select, button') : null) || node;
      }
      if (!probed || probed.nodeType !== 1) return null;
      if (probed.tagName === 'OPTION') probed = probed.parentNode || probed;
      var box = probed.closest ? probed.closest('fieldset, [data-option-name], [data-option]') : null;
      var ctx = '';
      if (box) {
        ctx = String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
        var legend = box.querySelector ? box.querySelector('legend') : null;
        if (legend) ctx += ' ' + String(legend.textContent || '').trim().toLowerCase();
      }
      ctx += ' ' + String(probed.name || '').toLowerCase();
      var isColor = ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1;
      var isSize = !isColor && ctx.indexOf('size') !== -1;
      if (!isColor && !isSize) return null;
      if (isSize) {
        return {
          kind: 'size',
          colorName: checkedProductOption('colour') || currentInlineColour(),
          sizeName: String(valueOf(probed) || '').trim(),
        };
      }
      var value = valueOf(probed);
      value = String(value || '').trim();
      if (!value || value.length > 40) return null;
      return {
        kind: 'color',
        colorName: canonicalPreviewColor(value),
        sizeName: checkedProductOption('size') || '',
      };
    }

    function valueOf(node) {
      if (!node) return '';
      if (node.tagName === 'SELECT' || node.tagName === 'INPUT') return node.value || '';
      return node.getAttribute('data-option-value') || node.getAttribute('data-value') || node.getAttribute('aria-label') || '';
    }

    function currentInlineColour() {
      var sw = readSwatchColor(root);
      var info = currentVariantInfo(root);
      var raw = (sw && info.colorName && String(sw).trim().toLowerCase() !== String(info.colorName).trim().toLowerCase())
        ? sw
        : (info.colorName || sw || '');
      return raw ? canonicalPreviewColor(raw) : null;
    }

    function isCoverImg(img) {
      return !!(img && img.classList && img.classList.contains('appai-my-pet-cover'));
    }

    // The product section and media-gallery survive Horizon's inner swap.
    // Never document.body — a background there paints the whole storefront.
    function mediaHoldContainer(hero) {
      var gallery = mainMediaGallery();
      if (gallery) return gallery;
      var section = productSectionScope();
      var scope = section && section !== document ? section : document;
      try { gallery = scope.querySelector('media-gallery, .media-gallery, product-media-gallery'); } catch (e) {}
      if (gallery) return gallery;
      if (hero && hero.parentElement && hero.parentElement !== document.body) return hero.parentElement;
      if (section && section !== document) return section;
      return null;
    }

    function holdBackgroundUrl(hero) {
      if (hero) {
        var shown = hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '';
        if (shown) return shown;
      }
      var colour = currentInlineColour();
      return previewUrlForColour(colour) || state.previewUrl || '';
    }

    function designTransitionActive() {
      return !!(state.designTransition && state.designTransition.token === designSwitchToken);
    }

    function openingHostRect() {
      var host = mainMediaGallery() || mediaHoldContainer(findVisibleHeroImg());
      if (!host || !host.getBoundingClientRect) return null;
      var rect = host.getBoundingClientRect();
      if (!rect || rect.width < 2 || rect.height < 2) return null;
      return rect;
    }

    function placeOpeningCover() {
      var cover = state.openingCover;
      if (!cover) return;
      var rect = openingHostRect();
      if (!rect) return;
      cover.style.left = Math.round(rect.left) + 'px';
      cover.style.top = Math.round(rect.top) + 'px';
      cover.style.width = Math.round(rect.width) + 'px';
      cover.style.height = Math.round(rect.height) + 'px';
    }

    function showOpeningCover() {
      var cover = state.openingCover;
      if (!cover) {
        cover = document.createElement('div');
        cover.className = 'appai-my-pet-opening';
        cover.setAttribute('aria-hidden', 'true');
        cover.innerHTML = '<span class="appai-my-pet-opening__spin"></span><span class="appai-my-pet-opening__label">Opening design…</span>';
        cover.style.position = 'fixed';
        cover.style.zIndex = '40';
        cover.style.background = '#fff';
        cover.style.display = 'flex';
        cover.style.flexDirection = 'column';
        cover.style.alignItems = 'center';
        cover.style.justifyContent = 'center';
        cover.style.gap = '8px';
        cover.style.pointerEvents = 'auto';
        stableCoverHost().appendChild(cover);
        state.openingCover = cover;
        if (!state.openingCoverBound) {
          state.openingCoverBound = true;
          var move = function () { if (state.openingCover) placeOpeningCover(); };
          window.addEventListener('scroll', move, true);
          window.addEventListener('resize', move);
        }
      }
      placeOpeningCover();
    }

    function removeOpeningCover() {
      var cover = state.openingCover;
      if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
      state.openingCover = null;
    }

    // position:fixed is viewport-relative only on document.body. Horizon's
    // section morph removes a cover that lives inside the gallery, so a
    // missing cover is created again here.
    function stableCoverHost() {
      return document.body;
    }

    function ensureOpeningCover() {
      if (!designTransitionActive()) return;
      var host = stableCoverHost();
      var cover = state.openingCover;
      if (!cover || !cover.isConnected) {
        state.openingCover = null;
        showOpeningCover();
        return;
      }
      if (cover.parentNode !== host) host.appendChild(cover);
      placeOpeningCover();
    }

    function beginDesignTransition(renderId, colorName, sizeName) {
      var token = ++designSwitchToken;
      clearTimeout(state.designSwitchTimer);
      state.designTransition = {
        token: token,
        renderId: renderId,
        colour: colorName || '',
        sizeName: sizeName || '',
        startedAt: Date.now(),
        lastMutationAt: Date.now(),
        sawMutation: false,
        expectsRerender: false,
        fallbackDue: false,
        swapped: false,
        allowSwap: false,
        watching: false,
        holdLogged: false,
        url: '',
      };
      showOpeningCover();
      if (!state.inlineGalleryObserver) installGalleryGuard();
      installProductMediaObserver();
      installInlineATCIntercept();
      console.log(TAG, 'design transition start render=' + renderId);
      clearTimeout(state.designTransition.hardTimer);
      state.designTransition.hardTimer = setTimeout(function () {
        var live = state.designTransition;
        if (!live || live.token !== token) return;
        if (live.url && visibleHeroReady(live.url)) {
          endDesignTransition(token, 'settled');
          return;
        }
        endDesignTransition(token, 'cap');
      }, 4000);
      return token;
    }

    function armTransitionFallback(token) {
      var t = state.designTransition;
      if (!t || t.token !== token) return;
      clearTimeout(t.fallbackTimer);
      t.fallbackTimer = setTimeout(function () {
        var live = state.designTransition;
        if (!live || live.token !== token || live.swapped) return;
        live.fallbackDue = true;
        runDesignTransitionSwap(token);
      }, 1200);
    }

    function scheduleTransitionSwap(token) {
      var t = state.designTransition;
      if (!t || t.token !== token || t.swapped) return;
      if (t.expectsRerender && !t.sawMutation && !t.fallbackDue) return;
      clearTimeout(t.swapTimer);
      // Wait until Horizon's section re-render stops mutating, then swap once.
      var delay = t.sawMutation ? 200 : 0;
      t.swapTimer = setTimeout(function () { runDesignTransitionSwap(token); }, delay);
    }

    function noteDesignGalleryMutation() {
      var t = state.designTransition;
      if (!t || t.token !== designSwitchToken) return;
      t.lastMutationAt = Date.now();
      t.sawMutation = true;
      ensureOpeningCover();
      // A mutation after we painted means Horizon replaced the gallery.
      // Swap again once this re-render settles. Don't reveal stock.
      if (t.swapped) t.swapped = false;
      scheduleTransitionSwap(t.token);
    }

    function runDesignTransitionSwap(token) {
      var t = state.designTransition;
      if (!t || t.token !== token || token !== designSwitchToken || t.swapped) return;
      var map = state.previewUrlByColor;
      if (!map || !Object.keys(map).length || !t.url) return;
      t.swapped = true;
      clearTimeout(t.fallbackTimer);
      clearTimeout(t.swapTimer);
      console.log(TAG, 'theme re-render settled');
      t.allowSwap = true;
      try { swapVariantSlides(map); }
      finally { t.allowSwap = false; }
      if (t.colour) {
        noteColourSelection(t.colour, false);
        lockProductGallery();
        var lockedUrl = previewUrlForColour(t.colour) || t.url;
        if (lockedUrl) paintColourNow(t.colour, lockedUrl);
      }
      watchOpeningCover(token);
    }

    function watchOpeningCover(token) {
      var t = state.designTransition;
      if (!t || t.token !== token || t.watching) return;
      t.watching = true;
      function tick() {
        var live = state.designTransition;
        if (!live || live.token !== token) return;
        var hero = resolveActiveHero(live.colour);
        if (Date.now() - live.startedAt >= 4000) {
          live.watching = false;
          endDesignTransition(token, 'cap');
          return;
        }
        if (live.url && heroReady(hero, live.url)) {
          if (!live.matchedAt) live.matchedAt = Date.now();
          // Held until the visible hero stays on the custom image. A stock
          // re-render clears matchedAt because currentSrc no longer matches.
          if (Date.now() - live.matchedAt >= 200) {
            live.watching = false;
            endDesignTransition(token, 'settled');
            return;
          }
        } else {
          live.matchedAt = 0;
          if (!live.holdLogged) {
            live.holdLogged = true;
            console.log(TAG, 'cover waiting reason=' + coverWaitDetail(live), 'elapsedMs=' + (Date.now() - live.startedAt));
          }
        }
        setTimeout(tick, 60);
      }
      tick();
    }

    function coverWaitDetail(t) {
      if (!t || !t.url) return 'no-preview-url';
      var hero = resolveActiveHero(t.colour);
      if (!hero) return 'no-hero';
      var src = hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '';
      if (!src) return 'hero-empty';
      if (!heroShowsCustom(hero, t.url)) return 'hero-stock src=' + srcTail(src);
      if (!(hero.complete && hero.naturalWidth > 0)) return 'hero-decoding src=' + srcTail(src);
      return 'hero-custom';
    }

    function endDesignTransition(token, reason) {
      var t = state.designTransition;
      if (!t || t.token !== token) return;
      var elapsed = Date.now() - t.startedAt;
      var switchColour = t.colour || '';
      var heroNow = resolveActiveHero(switchColour);
      var capped = reason === 'cap' || elapsed >= 4000;
      if (!capped && t.url && !heroReady(heroNow, t.url)) {
        if (!t.holdLogged) {
          t.holdLogged = true;
          console.log(TAG, 'cover waiting reason=' + coverWaitDetail(t), 'elapsedMs=' + elapsed);
        }
        t.swapped = false;
        t.fallbackDue = true;
        runDesignTransitionSwap(token);
        return;
      }
      if (capped && t.url && !heroReady(heroNow, t.url)) {
        console.log(TAG, 'cover waiting reason=' + coverWaitDetail(t), 'elapsedMs=' + elapsed);
      }
      if (!t.swapped && state.previewUrlByColor && t.url) {
        t.allowSwap = true;
        try { swapVariantSlides(state.previewUrlByColor); } catch (e) {}
        t.allowSwap = false;
        t.swapped = true;
      }
      clearTimeout(t.hardTimer);
      clearTimeout(t.swapTimer);
      clearTimeout(t.fallbackTimer);
      removeOpeningCover();
      clearDesignCover();
      state.designTransition = null;
      state.designSwitchColour = null;
      state.designSwitchSize = null;
      console.log(TAG, 'cover off reason=' + reason, 'elapsedMs=' + elapsed);
      var hero = resolveActiveHero(switchColour);
      if (hero && state.inlineApplied && state.renderId) {
        state.inlineHero = hero;
        installHeroGuard(hero);
      }
      scheduleShadowWarm('design');
    }

    function showDesignCover() {
      state.designCover = true;
      paintDesignCover();
    }

    function paintDesignCover() {
      if (!state.designCover) return;
      var host = mainMediaGallery() || mediaHoldContainer(findVisibleHeroImg());
      if (!host) return;
      try {
        if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
      } catch (e) {}
      var cover = host.querySelector('.appai-my-pet-switch-cover');
      if (!cover) {
        cover = document.createElement('img');
        cover.className = 'appai-my-pet-cover appai-my-pet-switch-cover';
        cover.alt = '';
        cover.setAttribute('aria-hidden', 'true');
        host.appendChild(cover);
      }
      var url = state.designCoverUrl || '';
      if (url && cover.getAttribute('src') !== url) {
        try { cover.src = url; } catch (e2) {}
      }
    }

    function clearDesignCover() {
      state.designCover = false;
      state.designCoverUrl = '';
      var nodes = [];
      try { nodes = document.querySelectorAll('.appai-my-pet-switch-cover'); } catch (e) {}
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
    }

    function holdFrameOn(colorName) {
      var hero = visibleSlideImg();
      if (isCoverImg(hero)) hero = findProductHeroImg();
      var target = previewUrlForColour(colorName);
      var shown = holdBackgroundUrl(hero);
      var url = target || shown;
      if (!target && hero) {
        var orig = hero.getAttribute('data-appai-my-pet-original-src') || hero.getAttribute('data-appai-my-pet-slide-original-src') || '';
        if (orig && shown && urlsMatch(shown, orig)) url = state.previewUrl || '';
      }
      var host = mediaHoldContainer(hero);
      if (!url || !host) {
        console.log(TAG, 'hold on skipped colour=' + (colorName || '?'));
        return;
      }
      if (!state.swapMaskStarted) state.swapMaskStarted = Date.now();
      state.holdOldHero = hero || null;
      var fit = 'cover';
      var objectPosition = 'center';
      try {
        var sample = hero || host;
        var cs = window.getComputedStyle(sample);
        if (hero && cs.objectFit && cs.objectFit !== 'auto') fit = cs.objectFit;
        if (hero && cs.objectPosition) objectPosition = cs.objectPosition;
      } catch (e) {}
      if (!state.holdBgSaved || state.holdBgSaved.el !== host) {
        state.holdBgSaved = {
          el: host,
          image: host.style.backgroundImage || '',
          size: host.style.backgroundSize || '',
          position: host.style.backgroundPosition || '',
          repeat: host.style.backgroundRepeat || '',
        };
      }
      host.style.backgroundImage = 'url("' + String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
      host.style.backgroundSize = (fit === 'contain' || fit === 'scale-down') ? 'contain' : (fit === 'fill' ? '100% 100%' : 'cover');
      host.style.backgroundPosition = objectPosition || 'center';
      host.style.backgroundRepeat = 'no-repeat';
      console.log(TAG, 'hold on colour=' + (colorName || '?'));
    }

    function clearHoldBackground(why, colorName) {
      var elapsed = state.swapMaskStarted ? (Date.now() - state.swapMaskStarted) : 0;
      var saved = state.holdBgSaved;
      if (saved && saved.el) {
        saved.el.style.backgroundImage = saved.image || '';
        saved.el.style.backgroundSize = saved.size || '';
        saved.el.style.backgroundPosition = saved.position || '';
        saved.el.style.backgroundRepeat = saved.repeat || '';
      }
      state.holdBgSaved = null;
      state.holdOldHero = null;
      state.swapMaskStarted = 0;
      if (why) console.log(TAG, 'hold off reason=' + why, 'elapsedMs=' + elapsed, 'colour=' + (colorName || '?'));
    }

    function previewUrlForColour(colorName) {
      if (colorName && state.previewUrlByColor && state.previewUrlByColor[colorName]) {
        return state.previewUrlByColor[colorName];
      }
      return state.previewUrl || null;
    }

    function looksLikeThumb(img) {
      return !!(img && img.closest && img.closest('.thumbnail, .thumbnails, .product-thumbnails, [class*="thumbnail"]'));
    }

    function slideMediaId(img) {
      var node = img && img.closest ? img.closest('[data-media-id]') : null;
      return node ? String(node.getAttribute('data-media-id') || '') : '';
    }

    // A replaced hero stays hidden until currentSrc is the selected colour
    // file and that file has decoded. Revealing on the cached stock decode
    // is what painted the previous colour for about a second on desktop.
    function revealPaintedHero(img, url) {
      if (!img) return;
      var own = mediaColourForImg(img);
      var ownUrl = own ? previewUrlForColour(own) : '';
      if (customGalleryLocked()) {
        var liveLocked = liveColourChoice();
        if (liveLocked.url) url = liveLocked.url;
        ownUrl = '';
      } else if (perColourSlides() && ownUrl) {
        if (!srcAlready(img, ownUrl)) applyPreviewSrc(img, ownUrl);
        var liveNow = liveColourChoice();
        if (liveNow.colour && !namesMatch(own, liveNow.colour)) {
          img.style.visibility = '';
          showColourSlide(liveNow.colour);
          return;
        }
        url = ownUrl;
      }
      if (img.__appaiRevealTimer) {
        clearInterval(img.__appaiRevealTimer);
        img.__appaiRevealTimer = 0;
      }
      function want() {
        if (ownUrl) return ownUrl;
        var live = liveColourChoice();
        return (live && live.url) || url || '';
      }
      function show() {
        var expected = want();
        if (!expected || !heroReady(img, expected)) return;
        img.style.visibility = '';
        if (img.__appaiRevealTimer) {
          clearInterval(img.__appaiRevealTimer);
          img.__appaiRevealTimer = 0;
        }
      }
      img.style.visibility = 'hidden';
      if (heroReady(img, want())) {
        show();
        return;
      }
      img.addEventListener('load', show, { once: true });
      var tries = 0;
      img.__appaiRevealTimer = setInterval(function () {
        tries += 1;
        var expected = want();
        if (perColourSlides() && ownUrl) {
          if (!srcAlready(img, ownUrl)) applyPreviewSrc(img, ownUrl);
        } else if (expected && !srcAlready(img, expected)) {
          applyPreviewSrc(img, expected);
        }
        if (typeof img.decode === 'function' && srcAlready(img, expected)) {
          img.decode().then(show, show);
        }
        if (heroReady(img, expected)) show();
        else if (tries > 80) {
          clearInterval(img.__appaiRevealTimer);
          img.__appaiRevealTimer = 0;
        }
      }, 50);
    }

    function paintProductMediaImage(img, colorName, force) {
      if (!img || img.tagName !== 'IMG' || !galleryImgAllowed(img)) return false;
      if (isCoverImg(img)) return false;
      if (!img.classList || !img.classList.contains('product-media__image')) return false;
      if (img.closest && img.closest('.appai-my-pet')) return false;
      if (looksLikeThumb(img)) return false;
      if (state.holdOldHero && img === state.holdOldHero) return false;
      var colour = colorName || liveColourChoice().colour || state.holdColour || currentInlineColour();
      var url = previewUrlForColour(colour);
      if (!url) return false;
      var mediaId = slideMediaId(img);
      var expectedMedia = '';
      try {
        var map = getMediaIdByColor(root);
        if (colour && map && map[colour]) expectedMedia = String(map[colour]);
      } catch (e) {}
      if (state.colourPaint && state.colourPaint.url && img === findVisibleHeroImg() && !perColourSlides()) {
        if (!(srcAlready(img, state.colourPaint.url) && !img.getAttribute('srcset') && !img.getAttribute('sizes'))) {
          applyPreviewSrc(img, state.colourPaint.url);
        }
        state.inlineHero = img;
        return true;
      }
      var own = mediaColourForImg(img);
      var ownUrl = own ? previewUrlForColour(own) : '';
      if (customGalleryLocked() && (img === state.inlineHero || img === findVisibleHeroImg())) {
        var liveImg = liveColourChoice();
        if (!liveImg.url) return false;
        if (srcAlready(img, liveImg.url) && !img.getAttribute('srcset') && !img.getAttribute('sizes')) return true;
        applyPreviewSrc(img, liveImg.url);
        state.inlineHero = img;
        return true;
      }
      if (perColourSlides()) {
        if (!ownUrl) return false;
        if (srcAlready(img, ownUrl) && !img.getAttribute('srcset') && !img.getAttribute('sizes')) return true;
        applyPreviewSrc(img, ownUrl);
        return true;
      }
      if (!force && mediaId && expectedMedia && mediaId !== expectedMedia) return false;
      if (!mediaId && !isHeroCandidate(img)) return false;
      if (srcAlready(img, url) && !img.getAttribute('srcset') && !img.getAttribute('sizes')) return true;
      applyPreviewSrc(img, url);
      state.inlineHero = img;
      return true;
    }

    function releaseHeroHold() {
      var scope = productSectionScope();
      var held = [];
      try { held = scope.querySelectorAll('[data-appai-my-pet-held]'); } catch (e) {}
      for (var i = 0; i < held.length; i++) {
        held[i].style.visibility = held[i].__appaiHeldVisibility || '';
        held[i].removeAttribute('data-appai-my-pet-held');
      }
    }

    function endSwapMask(why, colorName) {
      if (!state.swapMaskWaiting) {
        clearHoldBackground('', colorName);
        return;
      }
      var colour = colorName || state.holdColour || currentInlineColour();
      var url = previewUrlForColour(colour);
      var hero = findVisibleHeroImg() || state.inlineHero;
      if (url && !heroReady(hero, url)) {
        if (!state.holdStockLogged) {
          state.holdStockLogged = true;
          var elapsed = state.swapMaskStarted ? (Date.now() - state.swapMaskStarted) : 0;
          console.log(TAG, 'hold holding reason=' + (why || 'stock') + ' hero=stock', 'elapsedMs=' + elapsed, 'colour=' + (colour || ''));
        }
        if (state.previewUrlByColor && Object.keys(state.previewUrlByColor).length) {
          try { swapVariantSlides(state.previewUrlByColor); } catch (e) {}
        }
        if (hero && url) applyPreviewSrc(hero, url);
        return;
      }
      state.holdStockLogged = false;
      state.colourMatchedAt = 0;
      state.colourHoldWatching = false;
      state.swapMaskWaiting = 0;
      state.swapMaskEndedAt = Date.now();
      if (state.swapMaskTimer) {
        clearTimeout(state.swapMaskTimer);
        state.swapMaskTimer = null;
      }
      releaseHeroHold();
      clearHoldBackground(why, colour);
    }

    function watchColourHold(colorName) {
      var token = state.swapMaskWaiting;
      if (!token || state.colourHoldWatching) return;
      state.colourHoldWatching = true;
      var started = state.swapMaskStarted || Date.now();
      function tick() {
        if (state.swapMaskWaiting !== token) {
          state.colourHoldWatching = false;
          return;
        }
        var colour = colorName || state.holdColour;
        var url = previewUrlForColour(colour);
        var hero = findVisibleHeroImg() || state.inlineHero;
        if (url && heroReady(hero, url)) {
          if (!state.colourMatchedAt) state.colourMatchedAt = Date.now();
          if (Date.now() - state.colourMatchedAt >= 200) {
            state.colourHoldWatching = false;
            endSwapMask('settled', colour);
            return;
          }
        } else {
          state.colourMatchedAt = 0;
        }
        if (Date.now() - started >= 6000) {
          if (!state.holdStockLogged) {
            state.holdStockLogged = true;
            console.log(TAG, 'hold holding reason=timeout hero=stock', 'elapsedMs=' + (Date.now() - started), 'colour=' + (colour || ''));
          }
          if (state.previewUrlByColor && Object.keys(state.previewUrlByColor).length) {
            try { swapVariantSlides(state.previewUrlByColor); } catch (e) {}
          }
          var live = findVisibleHeroImg() || state.inlineHero;
          if (live && url) applyPreviewSrc(live, url);
          if (url && heroReady(findVisibleHeroImg() || live, url)) {
            state.colourHoldWatching = false;
            endSwapMask('settled', colour);
            return;
          }
          setTimeout(tick, 120);
          return;
        }
        setTimeout(tick, 60);
      }
      tick();
    }

    function noteReplacementDecoded(img, colorName) {
      var token = state.swapMaskWaiting;
      if (!token || !img) return;
      var finish = function () {
        if (state.swapMaskWaiting !== token) return;
        var url = previewUrlForColour(colorName);
        var hero = findVisibleHeroImg() || img;
        if (url && !heroReady(hero, url)) return;
        endSwapMask('replaced', colorName);
      };
      if (typeof img.decode === 'function') img.decode().then(finish, finish);
      else finish();
    }

    // STAGING-108 — the theme inserts img.product-media__image after our
    // decode of the old node. This observer runs in the mutation microtask,
    // before paint, and writes the cached preview onto that new node.
    function installProductMediaObserver() {
      if (state.productMediaObserver) return;
      var container = stableGalleryHost() || mediaHoldContainer(null);
      if (!container || container === document || container === document.body) return;
      var observer = new MutationObserver(function (mutations) {
        if (state.mediaWriting) return;
        if (designTransitionActive()) {
          noteDesignGalleryMutation();
          return;
        }
        if (!state.renderId || !state.inlineApplied || state.reverted) return;
        var liveNow = liveColourChoice();
        if (state.sectionFetchSeq && state.sectionFetchSeq !== liveNow.seq) logColourRace(state.sectionFetchSeq, liveNow);
        var colorName = liveNow.colour;
        var replaced = null;
        var replacedArea = -1;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'childList') {
            for (var n = 0; n < m.addedNodes.length; n++) {
              var node = m.addedNodes[n];
              if (!node || node.nodeType !== 1) continue;
              if (isCoverImg(node)) continue;
              if (node.classList && node.classList.contains('appai-my-pet-veil')) continue;
              var imgs = node.tagName === 'IMG' ? [node] : (node.querySelectorAll ? node.querySelectorAll('img.product-media__image') : []);
              for (var k = 0; k < imgs.length; k++) {
                var fresh = liveColourChoice();
                var slide = imgs[k].closest ? imgs[k].closest('slideshow-slide') : null;
                var showNow = !slide || !slideIsHidden(slide);
                if (showNow) imgs[k].style.visibility = 'hidden';
                var painted = paintProductMediaImage(imgs[k], fresh.colour, showNow);
                if (!painted && showNow && fresh.url) applyPreviewSrc(imgs[k], fresh.url);
                if (showNow) revealPaintedHero(imgs[k], fresh.url);
                if (!painted && !fresh.url) {
                  imgs[k].style.visibility = '';
                  continue;
                }
                var area = 0;
                try {
                  var rect = imgs[k].getBoundingClientRect();
                  area = Math.max(0, rect.width) * Math.max(0, rect.height);
                } catch (e) {}
                if (!replaced || area >= replacedArea) {
                  replaced = imgs[k];
                  replacedArea = area;
                }
              }
            }
          } else if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG' && !isCoverImg(m.target)) {
            if (state.holdOldHero && m.target === state.holdOldHero) continue;
            if (m.attributeName === 'src' && srcAlready(m.target, m.target.__appaiAssertUrl || '')) continue;
            paintProductMediaImage(m.target, colorName);
          }
        }
        if (replaced && state.swapMaskWaiting) noteReplacementDecoded(replaced, colorName);
      });
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset'],
      });
      state.productMediaObserver = observer;
      console.log(TAG, 'product-media observer watching',
        container.tagName ? String(container.tagName).toLowerCase() : '?');
    }

    function visibleSlideImg() {
      return findVisibleHeroImg() || findActiveSlideImg() || findProductHeroImg() || state.inlineHero;
    }

    function applyHeroHold(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.getAttribute('data-appai-my-pet-held') === '1') return;
      el.setAttribute('data-appai-my-pet-held', '1');
      el.__appaiHeldVisibility = el.style.visibility || '';
      el.style.visibility = 'hidden';
    }

    function hideHeroForSwatch() {
      var targets = heroAssertTargets();
      for (var i = 0; i < targets.length; i++) {
        applyHeroHold(targets[i]);
        var picture = targets[i].closest ? targets[i].closest('picture') : null;
        if (picture) applyHeroHold(picture);
      }
    }

    function clearHeroHold() {
      var scope = productSectionScope();
      var held = [];
      try { held = scope.querySelectorAll('[data-appai-my-pet-held]'); } catch (e) {}
      for (var i = 0; i < held.length; i++) {
        var el = held[i];
        el.style.visibility = el.__appaiHeldVisibility || '';
        el.removeAttribute('data-appai-my-pet-held');
      }
      state.heroHoldToken = 0;
      state.swapMaskWaiting = 0;
      state.holdColour = null;
      if (state.swapMaskTimer) {
        clearTimeout(state.swapMaskTimer);
        state.swapMaskTimer = null;
      }
      clearHoldBackground('cleared', currentInlineColour());
    }

    function onScreenHeroImgs() {
      var scope = mainMediaGallery() || productSectionScope();
      var imgs;
      try { imgs = scope.querySelectorAll('img'); } catch (e) { return []; }
      var ranked = [];
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!galleryImgAllowed(img)) continue;
        if (img.closest && img.closest('dialog, zoom-dialog')) continue;
        var rect;
        try { rect = img.getBoundingClientRect(); } catch (e2) { continue; }
        var ix = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
        var iy = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        var area = ix * iy;
        if (area < 160 * 160 && (rect.width < 160 || rect.height < 160)) continue;
        if (area < 160 * 80) continue;
        ranked.push({ img: img, area: area });
      }
      ranked.sort(function (a, b) { return b.area - a.area; });
      var out = [];
      for (var r = 0; r < ranked.length; r++) out.push(ranked[r].img);
      return out;
    }

    function noteColourSelection(colour, bump) {
      var name = colour ? (canonicalPreviewColor(colour) || colour) : (state.selectedColour || '');
      if (name) state.selectedColour = name;
      if (bump) {
        state.colourSeq = (state.colourSeq || 0) + 1;
        state.heroAssertHits = [];
        state.heroAssertStop = null;
      }
      return state.colourSeq || 0;
    }

    function liveColourChoice() {
      var name = state.selectedColour || state.holdColour || currentInlineColour() || '';
      return {
        seq: state.colourSeq || 0,
        colour: name,
        url: name ? (previewUrlForColour(name) || '') : '',
      };
    }

    function logColourRace(staleSeq, live) {
      var now = live || liveColourChoice();
      var key = String(staleSeq || 0) + '>' + now.seq + ':' + (now.colour || '');
      if (state.colourRaceLogged === key) return;
      state.colourRaceLogged = key;
      console.log(
        TAG,
        'colour race guard stale=' + (staleSeq || 0) +
        ' current=' + now.seq +
        ' colour=' + (now.colour || ''),
      );
    }

    function colourMark(label, extra) {
      var tl = state.colourTimeline;
      if (!tl) return;
      var now = window.performance && performance.now ? performance.now() : Date.now();
      var t = Math.round(now - tl.t0);
      var line = label + (extra ? ' ' + extra : '');
      tl.events.push('+' + t + 'ms ' + line);
      console.log(TAG, 'colour timeline +' + t + 'ms', line);
    }

    function logColourTimeline(why) {
      var tl = state.colourTimeline;
      if (!tl) return;
      console.log(TAG, 'colour timeline summary', why || '', tl.events.join(' | '));
    }

    function colourFetchInteresting(url) {
      var u = String(url || '');
      if (!u) return false;
      if (u.indexOf('section_id') !== -1 || u.indexOf('sections=') !== -1) return true;
      if (u.indexOf('variant=') !== -1 && u.indexOf('/products/') !== -1) return true;
      return false;
    }

    function customDesignActive() {
      return !!(state.renderId && state.inlineApplied && !state.reverted);
    }

    function customGalleryLocked() {
      return !!(state.galleryLocked && state.renderId && !state.reverted);
    }

    function productSlideshow() {
      var gallery = mainMediaGallery();
      if (!gallery) return null;
      return gallery.slideshow || (gallery.querySelector && gallery.querySelector('slideshow-component'));
    }

    // Custom designs use the colour swatches and one hero image. The product
    // gallery's thumbnail strip and slideshow selection stay available on
    // the stock page, and come back when the design is reverted.
    function lockProductGallery() {
      if (state.reverted || !state.renderId) return;
      var gallery = mainMediaGallery();
      if (!gallery) return;
      state.galleryLocked = true;
      gallery.setAttribute('data-appai-gallery-lock', '1');
      if (!state.galleryLockStyle) {
        var style = document.createElement('style');
        style.setAttribute('data-appai-gallery-lock', '1');
        style.textContent = 'media-gallery[data-appai-gallery-lock] slideshow-component > slideshow-controls,media-gallery[data-appai-gallery-lock] slideshow-component > slideshow-arrows,media-gallery[data-appai-gallery-lock] slideshow-component > .slideshow-controls{display:none !important;}';
        (document.head || document.documentElement).appendChild(style);
        state.galleryLockStyle = style;
      }
      var show = productSlideshow();
      if (show && !show.__appaiSelectLocked) {
        show.__appaiSelectLocked = true;
        show.__appaiSelect = show.select;
        show.__appaiNext = show.next;
        show.__appaiPrev = show.previous;
        var ignore = function () {};
        try { show.select = ignore; } catch (e) {}
        try { show.next = ignore; } catch (e2) {}
        try { show.previous = ignore; } catch (e3) {}
      }
      var strips = gallery.querySelectorAll('slideshow-controls, slideshow-arrows, .slideshow-controls');
      for (var s = 0; s < strips.length; s++) {
        if (strips[s].closest && strips[s].closest('dialog, zoom-dialog')) continue;
        if (strips[s].getAttribute('data-appai-thumbs-hidden') === '1') continue;
        strips[s].setAttribute('data-appai-thumbs-hidden', '1');
        strips[s].__appaiThumbsDisplay = strips[s].style.display;
        strips[s].style.display = 'none';
      }
      if (!state.galleryLockClick) {
        state.galleryLockClick = function (event) {
          if (!customGalleryLocked()) return;
          var t = event.target;
          if (!t || !t.closest) return;
          var host = mainMediaGallery();
          if (!host || !host.contains(t)) return;
          if (t.closest('dialog, zoom-dialog')) return;
          if (!t.closest('slideshow-controls, slideshow-arrows, .slideshow-controls, button.slideshow-controls__thumbnail')) return;
          event.preventDefault();
          event.stopPropagation();
        };
        document.addEventListener('click', state.galleryLockClick, true);
      }
    }

    function unlockProductGallery() {
      state.galleryLocked = false;
      var gallery = mainMediaGallery();
      if (gallery) gallery.removeAttribute('data-appai-gallery-lock');
      var show = productSlideshow();
      if (show && show.__appaiSelectLocked) {
        if (show.__appaiSelect) show.select = show.__appaiSelect;
        if (show.__appaiNext) show.next = show.__appaiNext;
        if (show.__appaiPrev) show.previous = show.__appaiPrev;
        show.__appaiSelectLocked = false;
      }
      var hiddenStrips = document.querySelectorAll('[data-appai-thumbs-hidden]');
      for (var h = 0; h < hiddenStrips.length; h++) {
        hiddenStrips[h].style.display = hiddenStrips[h].__appaiThumbsDisplay || '';
        hiddenStrips[h].removeAttribute('data-appai-thumbs-hidden');
      }
    }

    // Horizon's media-gallery replaces itself from the variant-picker HTML
    // on every colour and size change. While a custom design is showing,
    // that HTML is the stock image. Price, variant id, and the form still
    // update from the same response. Stock pages are not patched.
    function installMediaReplacementGuard() {
      if (state.mediaReplaceGuard) return;
      state.mediaReplaceGuard = true;
      var orig = Element.prototype.replaceWith;
      Element.prototype.replaceWith = function () {
        var main = null;
        try { main = mainMediaGallery(); } catch (e) {}
        if (customDesignActive() && main && this === main) {
          console.log(TAG, 'media gallery replacement skipped');
          return;
        }
        return orig.apply(this, arguments);
      };
    }

    function installColourFetchWatch() {
      if (state.colourFetchWatch) return;
      state.colourFetchWatch = true;
      if (typeof window.fetch === 'function') {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
          var url = '';
          try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
          var watch = colourFetchInteresting(url);
          var seq = watch ? (state.colourSeq || 0) : 0;
          if (watch) {
            state.sectionFetchSeq = seq;
            colourMark('horizon fetch start', String(url).slice(0, 160));
          }
          var pending;
          try { pending = origFetch.apply(this, arguments); }
          catch (err) {
            if (watch) colourMark('horizon fetch end', 'throw');
            throw err;
          }
          if (watch && pending && typeof pending.then === 'function') {
            pending.then(function (res) {
              if ((state.colourSeq || 0) !== seq) logColourRace(seq);
              if (!state.colourTimeline || state.colourTimeline.seq !== seq) return res;
              colourMark('horizon fetch end', String(res && res.status) + ' ' + String(url).slice(0, 120));
              return res;
            }, function (err) {
              if ((state.colourSeq || 0) !== seq) logColourRace(seq);
              if (state.colourTimeline && state.colourTimeline.seq === seq) colourMark('horizon fetch end', 'error');
              throw err;
            });
          }
          return pending;
        };
      }
    }

    function paintColourNow(colorName, url) {
      var heroes = onScreenHeroImgs();
      var hero = heroes[0] || findVisibleHeroImg() || findActiveSlideImg() || state.inlineHero;
      colourMark('hero write', hero ? describeImg(hero) : 'no visible hero');
      if (!hero) return;
      state.holdOldHero = null;
      applyPreviewSrc(hero, url);
      state.inlineHero = hero;
      var shown = hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '';
      colourMark('hero wrote', 'onScreen=' + heroes.length + ' match=' + urlsMatch(shown, url) + ' complete=' + !!hero.complete + ' ' + describeImg(hero));
    }

    function watchColourVisible(started, colorName, url) {
      var seq = state.colourTimeline ? state.colourTimeline.seq : 0;
      var lastNode = null;
      var matchedFrames = 0;
      var loggedVisible = false;
      var tick = function () {
        if (!state.colourTimeline || state.colourTimeline.seq !== seq) return;
        var hero = (onScreenHeroImgs()[0]) || findVisibleHeroImg();
        var shown = hero ? (hero.currentSrc || '') : '';
        var match = !!(hero && urlsMatch(shown, url) && hero.complete && hero.naturalWidth > 0);
        if (!match) {
          if (loggedVisible) {
            loggedVisible = false;
            matchedFrames = 0;
            colourMark('currentSrc lost', describeImg(hero));
          } else {
            matchedFrames = 0;
          }
          lastNode = hero;
        } else if (hero !== lastNode) {
          matchedFrames = 1;
          lastNode = hero;
          colourMark('currentSrc matched', nodeStamp(hero) + ' tail=' + urlTail(shown));
        } else {
          matchedFrames++;
          lastNode = hero;
        }
        if (match && matchedFrames >= 2 && !loggedVisible) {
          loggedVisible = true;
          var ms = Date.now() - started;
          colourMark('currentSrc stayed', 'node=' + nodeStamp(hero));
          console.log(TAG, 'colour swap click→visible ms=' + ms, 'colour=' + (colorName || ''), 'node=' + nodeStamp(hero));
          logColourTimeline('stayed');
        }
        if (Date.now() - started < 6000) {
          if (window.requestAnimationFrame) requestAnimationFrame(tick);
          else setTimeout(tick, 32);
        } else if (!loggedVisible) {
          console.log(TAG, 'colour swap click→visible timeout', 'colour=' + (colorName || ''), 'currentSrc=' + urlTail(shown), describeImg(hero));
          logColourTimeline('timeout');
        } else {
          logColourTimeline('end');
        }
      };
      tick();
    }

    function repaintColourReplacement(reason) {
      var paint = state.colourPaint;
      if (!paint || !paint.url || !state.previewUrlByColor) return 0;
      if (reason === 'section-load' && paint.lastRepaint && (Date.now() - paint.lastRepaint) < 400) {
        colourMark('re-swap skipped', reason);
        return 0;
      }
      paint.lastRepaint = Date.now();
      colourMark('gallery replacement', reason || '');
      var swapped = 0;
      if (!state.gallerySyncing) {
        try { swapped = swapVariantSlides(state.previewUrlByColor) || 0; } catch (e) {}
      }
      if (paint.colour) {
        var livePaint = liveColourChoice();
        if (customGalleryLocked()) {
          if (livePaint.url) paintColourNow(livePaint.colour, livePaint.url);
        } else {
          showColourSlide(paint.colour);
        }
      }
      colourMark('re-swap', 'nodes=' + swapped + ' slide=' + (paint.colour || '') + ' ' + (reason || ''));
      return swapped;
    }

    function installSwatchPreempt() {
      if (state.swatchPreemptInstalled) return;
      state.swatchPreemptInstalled = true;
      installColourFetchWatch();
      installMediaReplacementGuard();
      installProductMediaObserver();
      var handler = function (event) {
        if (logRelatedSwatch('swatch', event)) return;
        if (!clickInMainProduct(event)) return;
        var surface = logCapture('swatch', event);
        if (surface === 'main-image' || surface === 'zoom-chrome' || surface === 'zoom-thumb') return;
        if (window.__appaiSelectingDefaultSize) return;
        if (designTransitionActive()) return;
        if (!state.inlineApplied || !state.renderId) return;
        var hit = event.target && event.target.closest
          ? event.target.closest('button.slideshow-controls__thumbnail, button.dialog-thumbnails-list__thumbnail')
          : null;
        if (hit) return;
        var scope = productSectionScope();
        if (scope && scope !== document && event.target && event.target.nodeType === 1 && !scope.contains(event.target)) return;
        var intent = colorFromSwatchEvent(event);
        if (!intent || !intent.colorName) return;
        var colorName = intent.colorName;
        if (intent.kind === 'color') {
          var sizeForColour = intent.sizeName || checkedProductOption('size') || '';
          if (sizeForColour && !findExactVariant(root, colorName, sizeForColour)) {
            event.preventDefault();
            event.stopPropagation();
            try { event.stopImmediatePropagation(); } catch (eStop) {}
            return;
          }
        }
        if (event.type === 'click' && intent.kind === 'color') noteColourSelection(colorName, true);
        else if (event.type === 'click' && intent.kind === 'size') noteColourSelection(state.selectedColour || colorName, true);
        // click then change is one gesture. Re-arming on change either
        // resets the wait or, if the replacement already landed, hides
        // the gallery until the 1500ms safety with nothing left to replace.
        if (state.swapMaskWaiting) return;
        if (event.type === 'change' && state.swapMaskEndedAt && (Date.now() - state.swapMaskEndedAt) < 500) return;
        var url = previewUrlForColour(colorName);
        state.thumbColour = null;
        state.holdColour = colorName;
        state.colourSwapPending = false;
        if (url) state.previewUrl = url;
        releaseHeroHold();
        if (intent.kind === 'color' && url && event.type === 'click') {
          var swapStarted = Date.now();
          state.colourPaintSeq = (state.colourPaintSeq || 0) + 1;
          state.colourPaint = { colour: colorName, url: url, started: swapStarted, seq: state.colourPaintSeq };
          state.colourTimeline = {
            seq: state.colourPaintSeq,
            t0: window.performance && performance.now ? performance.now() : swapStarted,
            started: swapStarted,
            events: [],
          };
          colourMark('swatch click captured', 'colour=' + colorName);
          if (!showColourSlide(colorName)) paintColourNow(colorName, url);
          var prefSize = intent.sizeName || checkedProductOption('size') || '';
          writeStoredVariantChoice(shopifyProductId, colorName, prefSize, 'colour-click');
          watchColourVisible(swapStarted, colorName, url);
          var paintSeq = state.colourPaintSeq;
          setTimeout(function () {
            if (!state.colourPaint || state.colourPaint.seq !== paintSeq) return;
            logColourTimeline('end');
            state.colourPaint = null;
            state.colourTimeline = null;
          }, 6000);
        } else if (intent.kind === 'color' && !url) {
          swapInlineColor(colorName);
          if (event.type === 'click') {
            writeStoredVariantChoice(shopifyProductId, colorName, intent.sizeName || checkedProductOption('size') || '', 'colour-click');
          }
        } else if (event.type === 'click' && intent.kind === 'size') {
          writeStoredVariantChoice(shopifyProductId, state.selectedColour || colorName, intent.sizeName || '', 'size-click');
        }
        scheduleShadowWarm(intent.kind === 'size' ? 'size' : 'colour', {
          colour: intent.kind === 'color' ? colorName : (intent.colorName || ''),
          size: intent.sizeName || checkedProductOption('size') || '',
        });
      };
      document.addEventListener('click', handler, true);
      document.addEventListener('change', handler, true);
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
      applyPreviewSrc(hero, url);
    }

    /**
     * STAGING-100 — pre-swap every per-variant slide + thumbnail with the
     * matching colour composite, up front at activate time. Ritual's
     * media-gallery--carousel + Horizon-family themes render one <img> per
     * variant image; the native swatch handler just scrolls / toggles
     * active class. By pre-swapping, the theme's own behaviour SHOWS our
     * image with no race, no flash, no observer chase. The single-hero
     * guard remains as a safety net for Dawn-style themes that mutate src
     * on one node.
     *
     * Lookup is scoped to the nearest product section (same walk as
     * findMainProductForm / readSwatchColor) so related-product carousels
     * and store-wide "trending now" strips are never touched. Match is
     * by Shopify's own data-media-id attribute, so the thumbnail strip
     * (also tagged with data-media-id) is swapped in the same pass.
     *
     * Idempotent — can be called repeatedly (on activate, on every
     * gallery mutation, on every recomposite success). Nodes already
     * carrying our stash attribute get their src re-applied without
     * stashing a second original.
     */
    function colourForMediaId(mediaId) {
      if (!mediaId) return null;
      var map = getMediaIdByColor(root);
      var id = String(mediaId);
      for (var color in map) {
        if (!Object.prototype.hasOwnProperty.call(map, color)) continue;
        if (String(map[color]) === id) return canonicalPreviewColor(color) || color;
      }
      return null;
    }

    function mediaIdForImg(img) {
      if (!img) return '';
      var id = slideMediaId(img);
      if (id) return id;
      var slide = img.closest ? img.closest('slideshow-slide, [slide-id]') : null;
      if (slide && slide.getAttribute('slide-id')) return String(slide.getAttribute('slide-id'));
      return '';
    }

    function mediaColourForImg(img) {
      return colourForMediaId(mediaIdForImg(img));
    }

    function pageGallerySlides() {
      var gallery = mainMediaGallery();
      var scope = gallery || productSectionScope() || document;
      var all = [];
      try { all = scope.querySelectorAll('slideshow-slide'); } catch (e) { return []; }
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].closest && all[i].closest('dialog, zoom-dialog, .announcement-bar')) continue;
        if (all[i].classList && all[i].classList.contains('announcement-bar__slide')) continue;
        out.push(all[i]);
      }
      return out;
    }

    function colourFromLabel(text) {
      var m = String(text || '').match(/\bon\s+(.+)$/i);
      if (!m) return null;
      var raw = m[1].trim();
      return canonicalPreviewColor(raw) || raw;
    }

    function fileKey(url) {
      var path = String(url || '').split('?')[0].split('#')[0];
      var file = path.split('/').pop() || '';
      try { file = decodeURIComponent(file); } catch (e) {}
      return file.toLowerCase();
    }

    function thumbImageFile(img) {
      if (!img || !img.getAttribute) return '';
      var raw = img.getAttribute('data-appai-my-pet-slide-original-src')
        || img.getAttribute('data-appai-my-pet-original-src')
        || img.getAttribute('src')
        || '';
      return fileKey(raw);
    }

    function attrMediaId(el) {
      if (!el || !el.getAttribute) return '';
      var names = ['data-media-id', 'data-media', 'slide-id', 'data-slide-id', 'data-appai-my-pet-slide'];
      for (var i = 0; i < names.length; i++) {
        var value = el.getAttribute(names[i]);
        if (value) return String(value);
      }
      return '';
    }

    // Colour comes from this thumbnail's own media, never from its index
    // and never from whichever slide the theme currently calls active.
    // Horizon's page thumbs have no data-media-id; the img (or the src we
    // stashed before swapping it) matches a variant featured_media.
    function mediaIdFromThumb(btn) {
      if (!btn) return '';
      var img = btn.querySelector ? btn.querySelector('img') : null;
      var direct = attrMediaId(btn) || attrMediaId(img);
      if (direct && colourForMediaId(direct)) return direct;
      var controls = btn.getAttribute('aria-controls') || '';
      if (controls && typeof document.getElementById === 'function') {
        var target = document.getElementById(controls);
        var fromTarget = attrMediaId(target);
        if (fromTarget && colourForMediaId(fromTarget)) return fromTarget;
      }
      var file = thumbImageFile(img);
      var alt = (img && img.getAttribute('alt')) || '';
      var variants = [];
      try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
      var fileHit = '';
      var altHit = '';
      for (var i = 0; i < variants.length; i++) {
        var media = variants[i] && variants[i].featured_media;
        if (!media || media.id == null) continue;
        var id = String(media.id);
        if (!colourForMediaId(id)) continue;
        if (file && !fileHit) {
          var src = '';
          if (media.preview_image && media.preview_image.src) src = media.preview_image.src;
          else if (media.src) src = media.src;
          if (src && fileKey(src) === file) fileHit = id;
        }
        if (alt && !altHit && media.alt && String(media.alt).trim() === String(alt).trim()) altHit = id;
      }
      if (fileHit) return fileHit;
      if (altHit) return altHit;
      if (file) {
        var slides = pageGallerySlides();
        for (var s = 0; s < slides.length; s++) {
          var simg = slides[s].querySelector ? slides[s].querySelector('img') : null;
          if (!simg || thumbImageFile(simg) !== file) continue;
          var sid = slides[s].getAttribute('slide-id') || attrMediaId(slides[s]);
          if (sid && colourForMediaId(sid)) return String(sid);
        }
      }
      var labelled = (img && colourFromLabel(img.getAttribute('alt') || ''))
        || colourFromLabel(btn.getAttribute('aria-label') || '');
      if (labelled) {
        var map = getMediaIdByColor(root);
        var want = String(labelled).trim().toLowerCase();
        for (var color in map) {
          if (!Object.prototype.hasOwnProperty.call(map, color)) continue;
          if (String(color).trim().toLowerCase() === want) return String(map[color]);
        }
      }
      return '';
    }

    function thumbIndex(btn) {
      if (!btn) return -1;
      var isZoom = btn.classList && btn.classList.contains('dialog-thumbnails-list__thumbnail');
      var sel = isZoom ? 'button.dialog-thumbnails-list__thumbnail' : 'button.slideshow-controls__thumbnail';
      var list = btn.parentElement ? btn.parentElement.querySelectorAll(sel) : [];
      for (var i = 0; i < list.length; i++) if (list[i] === btn) return i;
      return -1;
    }

    function colourForThumbButton(btn) {
      return colourForMediaId(mediaIdFromThumb(btn));
    }

    function paintSlidesForMedia(mediaId) {
      if (!mediaId) return;
      var colour = colourForMediaId(mediaId);
      var url = colour ? urlForColourMap(state.previewUrlByColor, colour) : null;
      if (!url) return;
      var id = String(mediaId);
      var slides = pageGallerySlides();
      for (var i = 0; i < slides.length; i++) {
        var sid = slides[i].getAttribute('slide-id') || attrMediaId(slides[i]);
        if (String(sid) !== id) continue;
        var imgs = slides[i].querySelectorAll ? slides[i].querySelectorAll('img') : [];
        for (var k = 0; k < imgs.length; k++) applyPreviewSrc(imgs[k], url);
      }
    }

    function srcTail(url) {
      return String(url || '').split('?')[0].split('#')[0].split('/').pop();
    }

    function applyOwnPreview(img) {
      if (!img || img.tagName !== 'IMG') return false;
      if (img.closest && img.closest('.appai-my-pet')) return false;
      if (isCoverImg(img)) return false;
      if (state.holdOldHero && img === state.holdOldHero) return false;
      var colour = mediaColourForImg(img);
      if (!colour) {
        var btn = img.closest ? img.closest('button.slideshow-controls__thumbnail, button.dialog-thumbnails-list__thumbnail') : null;
        if (btn) colour = colourForThumbButton(btn);
      }
      if (!colour) colour = colourFromLabel(img.getAttribute('alt') || '');
      if (!colour || !state.previewUrlByColor) return false;
      var url = urlForColourMap(state.previewUrlByColor, colour);
      if (!url) return false;
      if (srcAlready(img, url) && !img.getAttribute('srcset') && !img.getAttribute('sizes')) return false;
      applyPreviewSrc(img, url);
      return true;
    }

    // Page thumbnail buttons and zoom thumbs are not inside [data-media-id],
    // so the media-id pass never reaches them. Search the product section
    // and the zoom dialog, not only the first media-gallery.
    function swapLooseThumbnails(scope) {
      var n = 0;
      var roots = [];
      var gallery = mainMediaGallery();
      var zoom = mainZoomDialog();
      if (gallery) roots.push(gallery);
      if (zoom && roots.indexOf(zoom) === -1) roots.push(zoom);
      if (scope && scope.querySelectorAll && roots.indexOf(scope) === -1 && gallery && gallery.contains && gallery.contains(scope)) roots.push(scope);
      var seen = [];
      for (var r = 0; r < roots.length; r++) {
        var buttons = [];
        try {
          buttons = roots[r].querySelectorAll('button.slideshow-controls__thumbnail, button.dialog-thumbnails-list__thumbnail');
        } catch (e) { continue; }
        for (var i = 0; i < buttons.length; i++) {
          if (seen.indexOf(buttons[i]) !== -1) continue;
          if (inHiddenZoom(buttons[i])) continue;
          seen.push(buttons[i]);
          var imgs = buttons[i].querySelectorAll ? buttons[i].querySelectorAll('img') : [];
          for (var j = 0; j < imgs.length; j++) {
            if (applyOwnPreview(imgs[j])) n++;
          }
        }
      }
      return n;
    }

    function selectSwatch(colour) {
      var want = String(colour || '').trim().toLowerCase();
      if (!want) return;
      var current = currentInlineColour();
      if (current && String(current).trim().toLowerCase() === want) return;
      var radios = document.querySelectorAll('input[type="radio"]');
      for (var i = 0; i < radios.length; i++) {
        var name = String(radios[i].name || '').toLowerCase();
        if (name.indexOf('color') === -1 && name.indexOf('colour') === -1) continue;
        if (String(radios[i].value || '').trim().toLowerCase() !== want) continue;
        if (radios[i].disabled) return;
        if (radios[i].checked) return;
        radios[i].checked = true;
        radios[i].dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }

    function selectGalleryColour(colour) {
      if (!colour) return;
      var picked = canonicalPreviewColor(colour) || colour;
      state.designSwitchColour = null;
      state.thumbColour = picked;
      state.holdColour = picked;
      var current = currentInlineColour();
      var same = current && String(current).trim().toLowerCase() === String(picked).trim().toLowerCase();
      if (!same) {
        var size = currentSizeName() || 'M';
        if (state.applyExactVariant) state.applyExactVariant(picked, size);
        else {
          var scrollY = window.scrollY;
          selectSwatch(picked);
          if (window.requestAnimationFrame) {
            requestAnimationFrame(function () {
              if (window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY);
            });
          }
        }
      }
      var url = urlForColourMap(state.previewUrlByColor, picked);
      var visible = findVisibleHeroImg() || state.inlineHero;
      if (visible && url) applyPreviewSrc(visible, url);
      scheduleGallerySync('thumbnail');
    }

    function clickSurface(event) {
      var t = event && event.target;
      if (!t || !t.closest) return '';
      var gallery = mainMediaGallery();
      if (!gallery || !gallery.contains(t)) return '';
      if (t.closest('button.dialog-thumbnails-list__thumbnail')) return 'zoom-thumb';
      if (t.closest('button.slideshow-controls__thumbnail')) return 'page-thumb';
      if (t.closest('dialog, zoom-dialog')) return 'zoom-chrome';
      if (t.closest('slideshow-slide, .product-media, img')) return 'main-image';
      return '';
    }

    function logCapture(name, event) {
      var surface = clickSurface(event);
      if (surface !== 'main-image' && surface !== 'zoom-chrome') return surface;
      var t = event.target;
      var label = '';
      try { label = (t && t.getAttribute && (t.getAttribute('aria-label') || t.tagName)) || ''; } catch (e) {}
      console.log(TAG, 'capture', name, 'surface=' + surface, 'target=' + (t && t.tagName), String(label).slice(0, 80));
      return surface;
    }

    function installThumbnailSync() {
      if (state.thumbnailSyncInstalled) return;
      state.thumbnailSyncInstalled = true;
      document.addEventListener('click', function (event) {
        if (logRelatedSwatch('thumbnail', event)) return;
        if (!clickInMainProduct(event)) return;
        var surface = logCapture('thumbnail', event);
        if (surface === 'main-image' || surface === 'zoom-chrome') return;
        if (!state.inlineApplied || !state.renderId || state.reverted) return;
        var t = event.target;
        if (!t || !t.closest) return;
        var btn = t.closest('button.slideshow-controls__thumbnail, button.dialog-thumbnails-list__thumbnail');
        if (!btn) return;
        var isZoom = surface === 'zoom-thumb' || (btn.classList && btn.classList.contains('dialog-thumbnails-list__thumbnail'));
        if (customGalleryLocked() && !isZoom) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        var zoomOpen = zoomDialogOpen(zoomObserveTarget());
        if (isZoom || zoomOpen) {
          var zoomColour = colourForThumbButton(btn);
          if (!zoomColour) return;
          console.log(TAG, 'zoom thumb', zoomColour, 'stay in zoom');
          state.zoomSlideColour = zoomColour;
          var zoom = mainZoomDialog();
          if (zoom) swapZoomDialog(zoom);
          return;
        }
        // Theme's own click handler runs on the way back up. Sync on the
        // next frame so we don't read or fight its slide change. Colour
        // is taken from the clicked button, not from the active slide.
        var afterTheme = window.requestAnimationFrame
          ? function (fn) { requestAnimationFrame(fn); }
          : function (fn) { setTimeout(fn, 16); };
        afterTheme(function () {
          if (!state.inlineApplied || state.reverted || zoomDialogOpen(zoomObserveTarget())) return;
          if (!document.body.contains(btn)) return;
          var mediaId = mediaIdFromThumb(btn);
          var index = thumbIndex(btn);
          var colour = colourForMediaId(mediaId);
          var written = '';
          if (colour) {
            paintSlidesForMedia(mediaId);
            var thumbImg = btn.querySelector('img');
            written = urlForColourMap(state.previewUrlByColor, colour) || '';
            if (thumbImg && written) applyPreviewSrc(thumbImg, written);
            selectGalleryColour(colour);
          }
          var swatch = '';
          try { swatch = readSwatchColor(root) || ''; } catch (e) {}
          var hero = findVisibleHeroImg() || state.inlineHero;
          var heroSrc = hero ? (hero.currentSrc || hero.getAttribute('src') || '') : '';
          console.log(TAG, 'thumb click',
            'media=' + (mediaId || ''),
            'index=' + index,
            'colour=' + (colour || ''),
            'swatch=' + (swatch || ''),
            'hero=' + srcTail(heroSrc || written));
        });
      }, true);
    }

    function zoomObserveTarget() {
      return mainZoomDialog()
        || document.querySelector('zoom-dialog')
        || document.querySelector('dialog.dialog-zoomed-gallery__dialog');
    }

    function zoomDialogOpen(target) {
      if (!target) return false;
      var dialog = target.tagName === 'DIALOG' ? target : (target.querySelector ? target.querySelector('dialog') : null);
      if (dialog && (dialog.open || dialog.hasAttribute('open'))) return true;
      if (target.hasAttribute && target.hasAttribute('open')) return true;
      var box = dialog || target;
      try {
        var rect = box.getBoundingClientRect();
        if (rect.width > 20 && rect.height > 20) return true;
      } catch (e) {}
      return false;
    }

    function zoomSelector(target) {
      if (!target) return '';
      var dialog = target.tagName === 'DIALOG' ? target : (target.querySelector ? target.querySelector('dialog') : null);
      if (dialog && (dialog.open || dialog.hasAttribute('open'))) {
        var cls = String(dialog.className || '').trim().split(/\s+/).filter(Boolean);
        if (cls.length) return 'dialog.' + cls.join('.');
      }
      var tag = String(target.tagName || '').toLowerCase();
      return tag || 'zoom-dialog';
    }

    function swapZoomDialog(target) {
      if (!target || !state.inlineApplied || !state.previewUrlByColor) return;
      var dialog = target.tagName === 'DIALOG' ? target : (target.querySelector ? target.querySelector('dialog') : null);
      var scope = dialog || target;
      var imgs = scope.querySelectorAll ? scope.querySelectorAll('img') : [];
      for (var i = 0; i < imgs.length; i++) applyOwnPreview(imgs[i]);
      swapLooseThumbnails(scope);
    }

    function syncZoom(reason) {
      var target = zoomObserveTarget();
      var open = !!(target && zoomDialogOpen(target));
      if (!open) {
        state.zoomOpenLogged = false;
        return;
      }
      if (!state.zoomOpenLogged) {
        state.zoomOpenLogged = true;
        console.log(TAG, 'zoom open', zoomSelector(target), reason || '');
      }
      swapZoomDialog(target);
    }

    // Ritual/Horizon zoom is <zoom-dialog> + dialog.dialog-zoomed-gallery__dialog.
    // The same element is what opens on a phone-width viewport.
    function installZoomSwap() {
      var target = zoomObserveTarget();
      if (!target) return;
      if (state.zoomObserver && state.zoomObserverTarget && document.contains(state.zoomObserverTarget)) return;
      if (state.zoomObserver) {
        try { state.zoomObserver.disconnect(); } catch (e) {}
        state.zoomObserver = null;
      }
      var observer = new MutationObserver(function () {
        if (!state.renderId || !state.inlineApplied || state.reverted) return;
        var live = zoomObserveTarget();
        var open = !!(live && zoomDialogOpen(live));
        if (open && !state.zoomWasOpen) {
          state.zoomWasOpen = true;
          state.zoomOpenColour = currentInlineColour();
          state.zoomOpenLogged = true;
          console.log(TAG, 'zoom open', zoomSelector(live), 'mutation');
          if (!state.mediaWriting) swapZoomDialog(live);
          return;
        }
        if (!open && state.zoomWasOpen) {
          state.zoomWasOpen = false;
          state.zoomOpenLogged = false;
          var nowColour = currentInlineColour();
          if (nowColour && state.zoomOpenColour && !namesMatch(nowColour, state.zoomOpenColour)) {
            scheduleGallerySync('zoom-close');
          }
          state.zoomOpenColour = null;
          state.zoomSlideColour = null;
          return;
        }
        if (!open || state.mediaWriting) return;
        swapZoomDialog(live);
      });
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'src', 'srcset'],
      });
      state.zoomObserver = observer;
      state.zoomObserverTarget = target;
      if (!state.zoomClickHook) {
        state.zoomClickHook = true;
        document.addEventListener('click', function (event) {
          if (logRelatedSwatch('zoom-hook', event)) return;
          if (!clickInMainProduct(event)) return;
          logCapture('zoom-hook', event);
        }, true);
      }
      if (zoomDialogOpen(target)) syncZoom('install');
    }

    function syncActiveGallery(reason) {
      if (state.reverted || !state.inlineApplied) return;
      if (designTransitionActive()) return;
      if (!state.previewUrlByColor || !Object.keys(state.previewUrlByColor).length) return;
      if (!state.renderId) return;
      if (state.gallerySyncing) return;
      state.gallerySyncing = true;
      try {
        if (!state.galleryGuardRoot || !document.contains(state.galleryGuardRoot)) installGalleryGuard();
        swapVariantSlides(state.previewUrlByColor);
        if (state.designCover) paintDesignCover();
        installZoomSwap();
        syncZoom(reason);
      } finally {
        state.gallerySyncing = false;
      }
    }

    function scheduleGallerySync(reason) {
      if (state.reverted) return;
      if (designTransitionActive()) return;
      state.gallerySyncReason = reason || state.gallerySyncReason || '';
      if (state.gallerySyncTimers) return;
      state.gallerySyncTimers = true;
      var generation = state.gallerySyncGeneration || 0;
      [0, 350, 900].forEach(function (ms) {
        setTimeout(function () {
          if (generation !== (state.gallerySyncGeneration || 0)) return;
          if (state.reverted || !state.inlineApplied) {
            if (ms === 900) state.gallerySyncTimers = false;
            return;
          }
          syncActiveGallery(state.gallerySyncReason);
          if (ms === 900) state.gallerySyncTimers = false;
        }, ms);
      });
    }

    function colourHosts() {
      var hosts = [];
      var gallery = mainMediaGallery();
      var zoom = mainZoomDialog();
      if (gallery) hosts.push(gallery);
      if (zoom && hosts.indexOf(zoom) === -1) hosts.push(zoom);
      return hosts;
    }

    function nodesForColour(colour) {
      var nodes = [];
      var mediaIdByColor = getMediaIdByColor(root);
      var key = canonicalPreviewColor(colour) || colour;
      var mediaId = (key && mediaIdByColor[key]) || mediaIdByColor[colour] || '';
      var hosts = colourHosts();
      var h;
      if (mediaId) {
        for (h = 0; h < hosts.length; h++) {
          var slides = [];
          try { slides = hosts[h].querySelectorAll('[data-media-id="' + mediaId + '"]'); } catch (e) {}
          for (var i = 0; i < slides.length; i++) nodes.push(slides[i]);
        }
      }
      for (h = 0; h < hosts.length; h++) {
        var buttons = [];
        try {
          buttons = hosts[h].querySelectorAll('button.slideshow-controls__thumbnail, button.dialog-thumbnails-list__thumbnail');
        } catch (e2) { continue; }
        for (var b = 0; b < buttons.length; b++) {
          if (namesMatch(colourForThumbButton(buttons[b]), colour)) nodes.push(buttons[b]);
        }
      }
      return nodes;
    }

    function clearColourPending(colour) {
      var nodes = nodesForColour(colour);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.classList) node.classList.remove('appai-my-pet-colour-pending');
        var veils = node.querySelectorAll ? node.querySelectorAll('.appai-my-pet-veil') : [];
        for (var v = 0; v < veils.length; v++) {
          if (veils[v].parentNode === node) veils[v].parentNode.removeChild(veils[v]);
        }
        var imgs = node.tagName === 'IMG' ? [node] : (node.querySelectorAll ? node.querySelectorAll('img') : []);
        for (var k = 0; k < imgs.length; k++) {
          if (imgs[k].getAttribute('data-appai-my-pet-pending') === '1') {
            imgs[k].style.visibility = '';
            imgs[k].removeAttribute('data-appai-my-pet-pending');
          }
        }
      }
    }

    function markColourPending(colour) {
      var nodes = nodesForColour(colour);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var host = node.tagName === 'IMG' ? (node.parentElement || node) : node;
        if (!host || host === document.body || host === document.documentElement) continue;
        if (host.classList) host.classList.add('appai-my-pet-colour-pending');
        var imgs = node.tagName === 'IMG' ? [node] : (node.querySelectorAll ? node.querySelectorAll('img') : []);
        for (var k = 0; k < imgs.length; k++) {
          if (!galleryImgAllowed(imgs[k])) continue;
          imgs[k].setAttribute('data-appai-my-pet-pending', '1');
          imgs[k].style.visibility = 'hidden';
        }
        var existingVeil = false;
        if (host.querySelectorAll) {
          var have = host.querySelectorAll('.appai-my-pet-veil');
          for (var hv = 0; hv < have.length; hv++) if (have[hv].parentNode === host) existingVeil = true;
        }
        if (!existingVeil) {
          try {
            if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
          } catch (e) {}
          var veil = document.createElement('span');
          veil.className = 'appai-my-pet-veil';
          veil.setAttribute('aria-hidden', 'true');
          host.appendChild(veil);
        }
      }
    }

    function holdMissingColours() {
      var colours = allColorOptions(root);
      for (var i = 0; i < colours.length; i++) {
        if (urlForColourMap(state.previewUrlByColor, colours[i])) clearColourPending(colours[i]);
        else markColourPending(colours[i]);
      }
    }

    function mergeColourMap(extra) {
      if (!extra || typeof extra !== 'object') return;
      state.previewUrlByColor = state.previewUrlByColor || {};
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        if (extra[keys[i]] && !state.previewUrlByColor[keys[i]]) state.previewUrlByColor[keys[i]] = extra[keys[i]];
      }
      preloadPreviewUrls(state.previewUrlByColor);
    }

    function fillMissingColours(renderId, gen) {
      if (!renderId || state.reverted) return;
      var colours = allColorOptions(root);
      var missing = [];
      for (var i = 0; i < colours.length; i++) {
        if (!urlForColourMap(state.previewUrlByColor, colours[i])) missing.push(colours[i]);
      }
      logColourMap('render=' + String(renderId).slice(0, 8) + ' missing=' + (missing.join(', ') || '(none)'));
      for (var m = 0; m < missing.length; m++) {
        (function (colour) {
          postJson('my-pet/recomposite', { renderId: renderId, colorName: colour }).then(function (res) {
            if (!generationCurrent(gen, renderId)) return;
            if (!res || !res.ok || !res.previewUrl) return;
            var name = res.colorName || colour;
            state.previewUrlByColor[name] = res.previewUrl;
            mergeColourMap(res.previewUrlsByColor);
            clearColourPending(name);
            var one = {};
            one[name] = res.previewUrl;
            swapVariantSlides(one);
            console.log(TAG, 'colour map arrived', name);
          }).catch(function () {});
        })(missing[m]);
      }
    }

    function inHiddenZoom(node) {
      if (!node || !node.closest) return false;
      var zoom = node.closest('zoom-dialog, dialog.dialog-zoomed-gallery__dialog');
      if (!zoom) return false;
      if (zoom.open || zoom.hasAttribute('open')) return false;
      return true;
    }

    function consumeSelectionSwap(map) {
      var gen = state.renderGeneration || 0;
      if (state.selectionOnce === gen) {
        if (state.selectionDidSwap === gen) return 0;
        state.selectionDidSwap = gen;
      }
      return swapVariantSlides(map) || 0;
    }

    function swapVariantSlides(urlsByColor) {
      if (!urlsByColor) return 0;
      if (state.reverted) return 0;
      if (designTransitionActive() && !(state.designTransition && state.designTransition.allowSwap)) return 0;
      pauseMediaObservers(state.inlineHero);
      var changed = 0;
      try {
      var mediaIdByColor = getMediaIdByColor(root);
      var scope = mainMediaGallery() || mainProductSection();
      if (!scope) return 0;
      var stash = state.inlineSlideStash || [];
      var seen = [];
      var singleSlot = !perColourSlides();
      var pinnedHero = customGalleryLocked()
        ? ((state.inlineHero && document.body.contains(state.inlineHero)) ? state.inlineHero : findVisibleHeroImg())
        : null;
      var visibleHero = pinnedHero || (singleSlot ? (findVisibleHeroImg() || state.inlineHero) : null);
      for (var color in urlsByColor) {
        if (!Object.prototype.hasOwnProperty.call(urlsByColor, color)) continue;
        var url = urlsByColor[color];
        if (!url) continue;
        var mediaId = mediaIdByColor[color];
        if (!mediaId) continue;
        var slides = [];
        try { slides = scope.querySelectorAll('[data-media-id="' + mediaId + '"]'); } catch (e) {}
        var matched = 0;
        for (var i = 0; i < slides.length; i++) {
          var slide = slides[i];
          if (inHiddenZoom(slide)) continue;
          var imgs = slide.tagName === 'IMG'
            ? [slide]
            : (slide.querySelectorAll ? slide.querySelectorAll('img') : []);
          for (var j = 0; j < imgs.length; j++) {
            var img = imgs[j];
            if (seen.indexOf(img) !== -1) continue;
            seen.push(img);
            if (img.closest && img.closest('.appai-my-pet')) continue;
            if (state.holdOldHero && img === state.holdOldHero) continue;
            if (isCoverImg(img)) continue;
            if (inHiddenZoom(img)) continue;
            if (visibleHero && img === visibleHero) continue;
            var ownColour = mediaColourForImg(img);
            if (ownColour && !namesMatch(ownColour, color)) continue;
            if (swapOneSlideImage(img, url, color, mediaId, stash)) matched++;
          }
        }
        changed += matched;
        if (matched) {
          console.log(TAG, 'slide swap:', color, '→ media', mediaId,
            '(' + matched + ' nodes swapped, incl. thumbnail)');
        }
      }
      state.inlineSlideStash = stash;
      changed += swapLooseThumbnails() || 0;
      holdMissingColours();
      if (changed) {
        console.log(TAG, 'slide swap: total nodes swapped =', changed, 'colours in map =', Object.keys(urlsByColor).length);
      }
      } finally {
        resumeMediaObservers(state.inlineHero);
      }
      return changed;
    }

    /**
     * STAGING-101 — one swapped slide. Separated so <picture><source srcset>
     * handling + rich per-node diagnostics live in one place.
     *
     * Ritual (and most Dawn-descended themes) render responsive images as:
     *   <picture>
     *     <source srcset="...@320w.webp 320w, ...@640w.webp 640w" type="image/webp">
     *     <source srcset="...@320w.jpg 320w, ...@640w.jpg 640w">
     *     <img src="...@fallback.jpg" srcset="...">
     *   </picture>
     * The browser renders whichever <source> its current media query matches;
     * <img src> is used only when no <source> wins. Setting img.src alone is
     * invisible — that's why STAGING-100 logged success but the carousel
     * showed the stock image.
     *
     * Fix: clear srcset on every <source> in the enclosing <picture> so the
     * browser falls back to our newly-set <img src>. Stash the originals on
     * the <source> nodes so revert can restore them.
     *
     * Diagnostics (every swap):
     *   - container class (first 3 classes) + visible? (offsetParent !== null)
     *   - number of <source> siblings cleared
     * +300ms delayed check:
     *   - img.currentSrc tail vs the URL we meant to set, with matches=true/false
     *   so a browser that ignored our write (cache, CSP, another observer
     *   restoring it, …) is immediately visible in the console.
     */
    function swapOneSlideImage(img, url, color, mediaId, stash) {
      if (!galleryImgAllowed(img)) return false;
      if (srcAlready(img, url) && !img.getAttribute('srcset') && !img.getAttribute('sizes') && !responsiveLeftovers(img)) return false;
      if (!img.hasAttribute('data-appai-my-pet-slide-original-src')) {
        img.setAttribute('data-appai-my-pet-slide-original-src', img.getAttribute('src') || '');
        var origSrcset = img.getAttribute('srcset');
        if (origSrcset) img.setAttribute('data-appai-my-pet-slide-original-srcset', origSrcset);
        stash.push(img);
      }
      if (img.getAttribute('sizes') && !img.hasAttribute('data-appai-my-pet-slide-original-sizes')) {
        img.setAttribute('data-appai-my-pet-slide-original-sizes', img.getAttribute('sizes'));
      }
      try { img.removeAttribute('srcset'); } catch (e) {}
      try { img.removeAttribute('sizes'); } catch (e) {}
      if (img.dataset) {
        try { delete img.dataset.src; } catch (e) {}
        try { delete img.dataset.srcset; } catch (e) {}
      }
      // STAGING-105 — detach <source> siblings. Clearing srcset left the
      // browser on the CDN candidate it had already selected.
      var picture = img.closest ? img.closest('picture') : null;
      var sourceCount = detachPictureSources(img);
      assignImgSrc(img, url);
      img.setAttribute('data-appai-my-pet-slide', mediaId);

      // Diagnostic — container context + delayed render check
      try {
        var container = (img.closest && (img.closest('[data-media-id]') || img.parentElement)) || img.parentElement;
        var cls = container && container.className
          ? String(container.className).split(/\s+/).slice(0, 3).join('.')
          : '(no class)';
        var visible = img.offsetParent !== null;
        var setTail = urlTail(url);
        console.log(TAG, 'slide swap img:', color,
          'media=' + mediaId,
          'container=' + cls,
          'visible=' + visible,
          'picture=' + !!picture,
          'sources=' + sourceCount,
          'setSrc tail=' + setTail);
        // Capture closure refs
        (function (capturedImg, capturedColor, capturedCls, capturedUrl, capturedTail, capturedGen, capturedRender) {
          setTimeout(function () {
            try {
              if (!generationCurrent(capturedGen, capturedRender)) return;
              var rc = urlTail(capturedImg.currentSrc || capturedImg.src || '');
              var ok = rc === capturedTail && !responsiveLeftovers(capturedImg);
              if (!ok && !state.reverted && state.inlineApplied) {
                console.warn(TAG, 'slide swap check (+300ms):', capturedColor,
                  'container=' + capturedCls,
                  '✗ MISMATCH currentSrc tail=' + rc,
                  'expected=' + capturedTail,
                  describeImg(capturedImg));
                applyPreviewSrc(capturedImg, capturedUrl);
              }
            } catch (e) {}
          }, 300);
        })(img, color, cls, url, setTail, state.renderGeneration || 0, state.renderId);
      } catch (e) {}
      return true;
    }

    /**
     * STAGING-100 — restore every per-slide swap (main carousel + thumbnails)
     * from the stash attributes. Mirror of swapVariantSlides for revert.
     * Safe to call multiple times (empties the stash on each run).
     */
    function revertVariantSlides() {
      var stash = state.inlineSlideStash || [];
      var restoredImgs = 0;
      var restoredSources = 0;
      for (var i = 0; i < stash.length; i++) {
        var node = stash[i];
        if (!node) continue;
        try {
          // <img> restore
          if (node.hasAttribute('data-appai-my-pet-slide-original-src')) {
            var origSrc = node.getAttribute('data-appai-my-pet-slide-original-src');
            if (origSrc != null && origSrc !== '') node.src = origSrc;
            node.removeAttribute('data-appai-my-pet-slide-original-src');
            restoredImgs++;
          }
          if (node.hasAttribute('data-appai-my-pet-slide-original-srcset')) {
            var origSrcset = node.getAttribute('data-appai-my-pet-slide-original-srcset');
            if (origSrcset) node.setAttribute('srcset', origSrcset);
            node.removeAttribute('data-appai-my-pet-slide-original-srcset');
          }
          if (node.hasAttribute('data-appai-my-pet-slide-original-sizes')) {
            var origSlideSizes = node.getAttribute('data-appai-my-pet-slide-original-sizes');
            if (origSlideSizes) node.setAttribute('sizes', origSlideSizes);
            node.removeAttribute('data-appai-my-pet-slide-original-sizes');
          }
          node.removeAttribute('data-appai-my-pet-slide');
          restoredSources += restoreDetachedSources(node);
          // STAGING-101 — <source> restore (<picture><source srcset>…)
          if (node.hasAttribute('data-appai-my-pet-source-original-srcset')) {
            var origSrcSrcset = node.getAttribute('data-appai-my-pet-source-original-srcset');
            if (origSrcSrcset) node.setAttribute('srcset', origSrcSrcset);
            else node.removeAttribute('srcset');
            node.removeAttribute('data-appai-my-pet-source-original-srcset');
            restoredSources++;
          }
          if (node.hasAttribute('data-appai-my-pet-source-original-data-srcset')) {
            var origDataSrcset = node.getAttribute('data-appai-my-pet-source-original-data-srcset');
            if (origDataSrcset) node.setAttribute('data-srcset', origDataSrcset);
            node.removeAttribute('data-appai-my-pet-source-original-data-srcset');
          }
        } catch (e) {}
      }
      state.inlineSlideStash = [];
      console.log(TAG, 'slide revert: restored', restoredImgs, 'img(s) +', restoredSources, 'source(s)');
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
      if (state.reverted || revertedFlagOn(shopifyProductId)) {
        console.log(TAG, 'inline activate skipped, reverted');
        return false;
      }
      var hero = findVisibleHeroImg() || findProductHeroImg();
      if (!hero) {
        console.log(TAG, 'inline activate: no hero found (gallery may not be rendered yet)');
        return false;
      }
      state.inlineHero = hero;
      // STAGING-98 — honour current colour selection even if caller passed
      // a "chosen colour" URL. On the restore path, previewUrl is whatever
      // was selected when the render was first saved; the shopper's current
      // selection may differ after a hard refresh (Shopify restored a
      // different variant). Without this, hero shows Black-composite under
      // a White-selected swatch until the first variant change.
      //
      // STAGING-99 — cross-check with readSwatchColor because the form
      // lookup might land on the wrong form (Ritual multi-form PDP). The
      // checked swatch input is the shopper's actual intent.
      var info = currentVariantInfo(root);
      var swatchColor = readSwatchColor(root);
      var forced = state.designSwitchColour ? (canonicalPreviewColor(state.designSwitchColour) || state.designSwitchColour) : null;
      var effectiveColor = forced || ((swatchColor && info.colorName && swatchColor !== info.colorName)
        ? swatchColor
        : (info.colorName || swatchColor || null));
      if (swatchColor && info.colorName && swatchColor !== info.colorName) {
        console.warn(TAG, 'inline activate: COLOUR MISMATCH form=' + info.colorName + ' swatch=' + swatchColor + ' — using swatch');
      }
      var effectiveUrl = (effectiveColor && state.previewUrlByColor[effectiveColor]) || previewUrl;
      preloadPreviewUrls(state.previewUrlByColor);
      lockProductGallery();
      if (effectiveColor) noteColourSelection(effectiveColor, false);
      if (effectiveUrl) decodeHeroUrl(effectiveUrl);
      var heroNow = findVisibleHeroImg() || hero;
      if (heroNow && effectiveUrl) {
        swapInlineHero(heroNow, effectiveUrl);
        state.inlineHero = heroNow;
      }
      if (state.selectionOnce === (state.renderGeneration || 0)) consumeSelectionSwap(state.previewUrlByColor);
      else swapVariantSlides(state.previewUrlByColor);
      var tail = String(effectiveUrl || '').split('?')[0].split('/').pop();
      console.log(TAG, 'inline activate: hero swapped colour=' + (effectiveColor || '(unknown)') +
        ' urlTail=' + tail +
        (effectiveUrl !== previewUrl ? ' (overrode passed url with effective-colour cache)' : ''));
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
      installThumbnailSync();
      installZoomSwap();
      // Issue 7 — inlineApplied gates every observer / listener / ATC
      // intercept so revertToOriginalDesign can turn them off without
      // tearing down the one-time installs below.
      state.inlineApplied = true;
      if (state.selectionOnce !== (state.renderGeneration || 0)) scheduleGallerySync('activate');
      installInlineFormPollFallback();
      // Relabel + show revert link every activation (idempotent).
      if (openBtn) {
        openBtn.textContent = 'Try another photo';
        openBtn.setAttribute('data-appai-my-pet-inline-active', '1');
        openBtn.removeAttribute('aria-disabled');
        noteRestoreLockOnOpenBtn();
      }
      showRevertLink();
      if (state.inlineAttached) {
        console.log(TAG, 'inline activate: observers re-installed (listeners already attached from earlier activation)');
        scheduleShadowWarm('activate');
        return true;
      }
      state.inlineAttached = true;
      installInlineVariantListeners();
      installInlineATCIntercept();
      installInlineFormPollFallback();
      installSwatchPreempt();
      console.log(TAG, 'inline activate: full install complete (hero+gallery observers, variant listeners, ATC intercept, form poll fallback)');
      scheduleShadowWarm('activate');
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
    function restoreSwappedImg(img) {
      if (!img || img.tagName !== 'IMG') return;
      var orig = img.getAttribute('data-appai-my-pet-slide-original-src');
      if (orig == null) orig = img.getAttribute('data-appai-my-pet-original-src');
      var srcset = img.getAttribute('data-appai-my-pet-slide-original-srcset');
      if (srcset == null) srcset = img.getAttribute('data-appai-my-pet-original-srcset');
      var sizes = img.getAttribute('data-appai-my-pet-slide-original-sizes');
      if (sizes == null) sizes = img.getAttribute('data-appai-my-pet-original-sizes');
      try {
        if (orig != null) img.src = orig;
        if (srcset) img.setAttribute('srcset', srcset);
        else img.removeAttribute('srcset');
        if (sizes) img.setAttribute('sizes', sizes);
        else img.removeAttribute('sizes');
      } catch (e) {}
      restoreDetachedSources(img);
      img.removeAttribute('data-appai-my-pet-preview');
      img.removeAttribute('data-appai-my-pet-slide');
    }

    function restoreLiveGallery() {
      var selector = 'img[data-appai-my-pet-slide-original-src], img[data-appai-my-pet-original-src]';
      var lists = [];
      var scope = productSectionScope();
      try { if (scope && scope.querySelectorAll) lists.push(scope.querySelectorAll(selector)); } catch (e) {}
      var zoom = zoomObserveTarget();
      try { if (zoom && zoom.querySelectorAll) lists.push(zoom.querySelectorAll(selector)); } catch (e2) {}
      var seen = [];
      for (var a = 0; a < lists.length; a++) {
        for (var i = 0; i < lists[a].length; i++) {
          if (seen.indexOf(lists[a][i]) !== -1) continue;
          seen.push(lists[a][i]);
          restoreSwappedImg(lists[a][i]);
        }
      }
    }

    function heroStockSrc(img) {
      if (!img || !img.getAttribute) return '';
      return img.getAttribute('data-appai-my-pet-original-src')
        || img.getAttribute('data-appai-my-pet-slide-original-src')
        || '';
    }

    function urlIsCustomPreview(url) {
      if (!url) return false;
      if (state.previewUrl && urlsMatch(url, state.previewUrl)) return true;
      var map = state.previewUrlByColor || {};
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        if (map[keys[i]] && urlsMatch(url, map[keys[i]])) return true;
      }
      return false;
    }

    function heroStillCustom(img) {
      if (!img) return false;
      var attr = img.getAttribute ? (img.getAttribute('src') || '') : '';
      if (img.getAttribute && img.getAttribute('data-appai-my-pet-preview') === 'true' && urlIsCustomPreview(attr)) return true;
      return urlIsCustomPreview(attr);
    }

    function forceHeroStock(img, stockSrc) {
      if (!img || !stockSrc) return;
      restoreSwappedImg(img);
      if (!heroStillCustom(img)) return;
      try { img.src = stockSrc; } catch (e) {}
      try { img.removeAttribute('srcset'); } catch (e2) {}
      try { img.removeAttribute('sizes'); } catch (e3) {}
      var picture = img.closest ? img.closest('picture') : null;
      if (picture && picture.querySelectorAll) {
        var sources = picture.querySelectorAll('source');
        for (var i = 0; i < sources.length; i++) sources[i].removeAttribute('srcset');
      }
      img.removeAttribute('data-appai-my-pet-preview');
    }

    function revertToOriginalDesign() {
      if (state.reverted && !state.inlineApplied) return;
      console.log(TAG, 'revert');
      if (state.shadowWarmTimer) console.log(TAG, 'warm debounce', 'reason=revert', 'cancelled=revert');
      clearTimeout(state.shadowWarmTimer);
      state.shadowWarmTimer = null;
      restoreStampedForm();
      clearHeroHold();
      state.reverted = true;
      state.inlineApplied = false;
      unlockProductGallery();
      state.thumbColour = null;
      state.designSwitchColour = null;
      state.designSwitchSize = null;
      state.holdColour = null;
      state.gallerySyncGeneration = (state.gallerySyncGeneration || 0) + 1;
      state.gallerySyncTimers = false;
      persistReverted(shopifyProductId, true);
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
      // STAGING-98 — stop the form poll so a post-revert variant change
      // doesn't re-swap the hero back to our preview.
      if (state.inlineFormPollTimer) {
        clearInterval(state.inlineFormPollTimer);
        state.inlineFormPollTimer = null;
      }
      // STAGING-100 — restore every per-slide composite we swapped onto
      // the gallery slides + thumbnails. Runs BEFORE the hero restore
      // below so a live slide holding our preview as hero still has
      // something to restore from (swapInlineHero's data-appai-my-pet-
      // original-src vs swapVariantSlides' data-appai-my-pet-slide-
      // original-src are different attrs — no collision).
      var liveBefore = findVisibleHeroImg() || findProductHeroImg() || staleHero;
      var stockSrc = heroStockSrc(liveBefore) || heroStockSrc(staleHero);
      if (!stockSrc) {
        var stockScope = productSectionScope();
        var stashed = [];
        try {
          stashed = stockScope.querySelectorAll('img[data-appai-my-pet-original-src], img[data-appai-my-pet-slide-original-src]');
        } catch (e) {}
        for (var si = 0; si < stashed.length; si++) {
          var candidate = heroStockSrc(stashed[si]);
          if (candidate && !urlIsCustomPreview(candidate)) { stockSrc = candidate; break; }
        }
      }
      restoreLiveGallery();
      revertVariantSlides();
      var live = findVisibleHeroImg() || findProductHeroImg();
      if (live && heroStillCustom(live)) {
        if (!stockSrc) stockSrc = heroStockSrc(live);
        if (stockSrc) forceHeroStock(live, stockSrc);
      }
      var stickyImg = document.querySelector('sticky-add-to-cart img.sticky-add-to-cart__image-img, .sticky-add-to-cart img');
      if (stickyImg && stickyImg.getAttribute('data-appai-my-pet-sticky-original-src')) {
        try { stickyImg.src = stickyImg.getAttribute('data-appai-my-pet-sticky-original-src'); } catch (e) {}
        stickyImg.removeAttribute('data-appai-my-pet-sticky-original-src');
      }
      live = findVisibleHeroImg() || findProductHeroImg() || live;
      if (!live || heroStillCustom(live)) {
        console.warn(TAG, 'revert: no live hero or no original-src stash to restore from');
      } else {
        console.log(TAG, 'revert: hero restored', srcTail(live.currentSrc || live.getAttribute('src') || ''));
      }
      // 3. Flip state flags — ATC intercept + variant listeners + observers
      //    all gate on inlineApplied/inlineHero.
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
      if (state.holdOldHero && state.holdOldHero !== hero && state.holdOldHero.__appaiMyPetObserver) {
        try { state.holdOldHero.__appaiMyPetObserver.disconnect(); } catch (e0) {}
        state.holdOldHero.__appaiMyPetObserver = null;
      }
      if (hero.__appaiMyPetObserver) {
        try { hero.__appaiMyPetObserver.disconnect(); } catch (e) {}
      }
      // Shared assert — called both synchronously on install (catches the
      // settled replacement-node case) and on every observed src/srcset
      // mutation (catches theme re-assertions). Gated on inlineApplied
      // (not inlineAttached) so revertToOriginalDesign can stop re-assert
      // without tearing down the whole intercept.
      var assert = function () {
        if (state.mediaWriting) return;
        if (designTransitionActive()) return;
        if (state.holdOldHero && hero === state.holdOldHero) return;
        if (!state.renderId || !state.inlineApplied || state.reverted) return;
        if (customGalleryLocked()) {
          var liveGuard = liveColourChoice();
          if (hero !== state.inlineHero && hero !== findVisibleHeroImg()) return;
          if (!liveGuard.url) return;
          if (srcAlready(hero, liveGuard.url) && !hero.getAttribute('srcset') && !hero.getAttribute('sizes')) return;
          reassertColourPreview('guard', liveGuard.colour, liveGuard.url);
          return;
        }
        var info = currentVariantInfo(root);
        // STAGING-99 — swatch cross-check. If the form is the wrong one
        // (Ritual multi-form PDP), info.colorName will be frozen on the
        // wrong variant; the checked swatch is the shopper's actual intent.
        var swColor = readSwatchColor(root);
        var ownColour = mediaColourForImg(hero);
        if (ownColour && perColourSlides() && !customGalleryLocked()) {
          var ownUrl = previewUrlForColour(ownColour);
          var liveSlide = liveColourChoice();
          if (ownUrl && !(srcAlready(hero, ownUrl) && !hero.getAttribute('srcset') && !hero.getAttribute('sizes'))) {
            reassertColourPreview('guard', ownColour, ownUrl);
          }
          var showingThis = hero === findVisibleHeroImg() || hero === state.inlineHero;
          if (showingThis && liveSlide.colour && !namesMatch(ownColour, liveSlide.colour)) {
            showColourSlide(liveSlide.colour);
          }
          return;
        }
        var forced = state.designSwitchColour ? (canonicalPreviewColor(state.designSwitchColour) || state.designSwitchColour) : null;
        var thumbPick = state.thumbColour ? (canonicalPreviewColor(state.thumbColour) || state.thumbColour) : null;
        var visibleHero = findVisibleHeroImg();
        var activeHero = hero === state.inlineHero || (!!visibleHero && hero === visibleHero);
        // A thumbnail click names the colour the main image must show.
        // A design switch names it only for that hero. Every other slide
        // keeps the colour its own media id maps to.
        var picked = (state.colourPaint && state.colourPaint.url && activeHero && state.colourPaint.colour)
          || (activeHero && thumbPick)
          || (activeHero && forced)
          || ownColour
          || state.holdColour
          || ((swColor && info.colorName && swColor !== info.colorName)
            ? swColor
            : (info.colorName || swColor || null));
        var livePick = liveColourChoice();
        var colorName = (activeHero && livePick.colour) ? livePick.colour : picked;
        if (activeHero && picked && livePick.colour && !namesMatch(picked, livePick.colour)) {
          logColourRace(hero.__appaiColourSeq || state.sectionFetchSeq || 0, livePick);
        }
        if (activeHero) hero.__appaiColourSeq = livePick.seq;
        var expected = (activeHero && livePick.url)
          ? livePick.url
          : ((state.colourPaint && state.colourPaint.url && activeHero)
            ? state.colourPaint.url
            : (colorName ? state.previewUrlByColor[colorName] : null));
        // Src already matches: no write, no log. srcset leftovers are
        // stripped inside applyPreviewSrc with the observers paused.
        if (expected && srcAlready(hero, expected) && !hero.getAttribute('srcset') && !hero.getAttribute('sizes')) return;
        if (expected) {
          reassertColourPreview('guard', colorName, expected);
          console.log(TAG, 'inline hero guard re-asserted', colorName);
        } else if (colorName && state.previewUrl) {
          // Colour not pre-composited — stop the stock flash immediately with
          // last-known preview, then kick off compose in the background.
          //
          // STAGING-104 — this fallback is the client-side race that lets the
          // Shopify variant image (= catalogue mockup composited from the
          // ORIGINAL artwork at approveCandidateChoice time) visually leak
          // through for ~1 frame before we overwrite it with the chosen-colour
          // preview. The server compose is correct (verified offline against
          // render 25a79e80); this warn is the single place to measure how
          // often the race loses in the field. If this fires often after the
          // STAGING-104 deploy, follow up with the data-url-placeholder + spinner
          // "Option A" or the catalogue-mockup swap "Option B" from the audit.
          reassertColourPreview('guard-fallback', colorName, state.previewUrl);
          console.warn('[appai-my-pet] hero-guard fallback: no cached preview for colour', colorName,
            '- showing chosen-colour preview while /recomposite runs. available:',
            Object.keys(state.previewUrlByColor || {}));
          swapInlineColor(colorName);
        }
      };
      // Immediate: handles the Ritual node-replacement case where the new
      // <img> is inserted with its src already set to the stock variant
      // image — no future mutation fires on it so the observer would never
      // trigger.
      assert();
      var observer = new MutationObserver(function (mutations) {
        if (state.mediaWriting) return;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.attributeName === 'src' || m.attributeName === 'srcset' || m.attributeName === 'sizes') {
            if (m.attributeName === 'src' && srcAlready(hero, hero.__appaiAssertUrl || '')) return;
            assert();
            return;
          }
        }
      });
      observer.observe(hero, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
      hero.__appaiMyPetObserver = observer;

      // Element-replacement backup: themes that re-render the gallery via
      // Section Rendering API replace the <img> node outright, which breaks
      // our observer silently. Re-find and re-install every 1.5s. If the
      // same node is still there, this is a cheap no-op. Last-resort —
      // installGalleryGuard (Issue 4) is faster when the gallery container
      // selector matches the theme.
      if (state.inlineGuardBackupTimer) clearInterval(state.inlineGuardBackupTimer);
      state.inlineGuardBackupTimer = setInterval(function () {
        if (!state.renderId || !state.inlineApplied || state.reverted) return;
        if (designTransitionActive()) return;
        if (customGalleryLocked()) {
          if (state.heroAssertStop) return;
          var livePollNow = liveColourChoice();
          var pinnedNow = state.inlineHero;
          if (pinnedNow && document.body.contains(pinnedNow) && pinnedNow.__appaiMyPetObserver) return;
          var freshLocked = findVisibleHeroImg();
          if (!freshLocked || freshLocked === pinnedNow) return;
          state.inlineHero = freshLocked;
          if (livePollNow.url) reassertColourPreview('node-replaced', livePollNow.colour, livePollNow.url);
          installHeroGuard(freshLocked);
          return;
        }
        var info = currentVariantInfo(root);
        var pollSw = readSwatchColor(root);
        var livePoll = liveColourChoice();
        var colorName = livePoll.colour
          || ((pollSw && info.colorName && pollSw !== info.colorName)
            ? pollSw
            : (info.colorName || pollSw || null));
        var fresh = resolveActiveHero(colorName);
        var currentHero = state.inlineHero;
        if (!fresh) return;
        if (fresh === currentHero && document.body.contains(fresh) && fresh.__appaiMyPetObserver) return;
        if (fresh !== currentHero) {
          state.inlineHero = fresh;
          var expected = (colorName && state.previewUrlByColor[colorName]) || state.previewUrl;
          state.inlineHero = fresh;
          if (expected) reassertColourPreview('node-replaced', colorName, expected);
          installHeroGuard(fresh);
          if (!(state.colourPaint && state.colourPaint.url)) scheduleGallerySync('node-replaced');
          console.log(TAG, 'inline hero node replaced (poll) — re-installed guard, colour=' + (colorName || '(unknown)'));
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
    function addedTouchesGallery(mutations) {
      var gallery = mainMediaGallery();
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        if (!added) continue;
        for (var a = 0; a < added.length; a++) {
          var node = added[a];
          if (!node || node.nodeType !== 1) continue;
          if (node.classList && (node.classList.contains('appai-my-pet-veil') || node.classList.contains('appai-my-pet-switch-cover') || node.classList.contains('appai-my-pet-opening'))) continue;
          if (gallery && (node === gallery || (gallery.contains && gallery.contains(node)))) return true;
          if (node.matches && node.matches('media-gallery, product-media-gallery, slideshow-slide')) return true;
          if (node.querySelector && node.querySelector('media-gallery, product-media-gallery, slideshow-slide, img.product-media__image')) return true;
        }
      }
      return false;
    }

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
      // Watch the main product media-gallery only. The shopify section is a
      // div, so the old walk landed on <main> and repainted recommendation cards.
      var galleryScope = mainMediaGallery();
      var searchRoot = mainProductSection() || document;
      var container = galleryScope;
      if (!container) {
        for (var i = 0; i < GALLERY_SELECTORS.length; i++) {
          try { container = searchRoot.querySelector(GALLERY_SELECTORS[i]); } catch (e) { continue; }
          if (container) break;
        }
      }
      if (!container) {
        console.log(TAG, 'gallery guard: no container matched, relying on hero observer + backup poll');
        return;
      }
      var watch = stableGalleryHost() || container;
      state.galleryGuardRoot = watch;
      if (!state.sectionLoadHook) {
        state.sectionLoadHook = true;
        document.addEventListener('shopify:section:load', function () {
          state.galleryGuardRoot = null;
          if (designTransitionActive()) {
            noteDesignGalleryMutation();
            installGalleryGuard();
            return;
          }
          if (!state.inlineApplied || !state.renderId) return;
          if (state.colourPaint && state.colourPaint.url) {
            repaintColourReplacement('section-load');
            return;
          }
          scheduleGallerySync('section-load');
        });
      }
      console.log(TAG, 'gallery guard: watching', watch.tagName.toLowerCase() + (watch.className ? '.' + String(watch.className).split(' ').join('.') : ''));
      var observer = new MutationObserver(function (mutations) {
        if (state.mediaWriting) return;
        if (designTransitionActive()) {
          ensureOpeningCover();
          var sawGallery = false;
          for (var dm = 0; dm < mutations.length; dm++) {
            var addedNow = mutations[dm].addedNodes;
            if (addedNow && addedNow.length) { sawGallery = true; break; }
          }
          if (sawGallery) noteDesignGalleryMutation();
          return;
        }
        if (!state.renderId || !state.inlineApplied || state.reverted) return;
        installZoomSwap();
        // STAGING-100 — primary defence for carousel-style galleries: if
        // any new element was inserted, re-run per-variant slide swap so
        // newly-rendered slides pick up our composites. Covers theme
        // section re-renders (Section Rendering API) and lazy-rendered
        // slides in <media-gallery> custom elements.
        var sawAdded = false;
        for (var m = 0; m < mutations.length; m++) {
          var addedNodes = mutations[m].addedNodes;
          if (!addedNodes || !addedNodes.length) continue;
          for (var a = 0; a < addedNodes.length; a++) {
            var addedNode = addedNodes[a];
            if (addedNode && addedNode.classList && (addedNode.classList.contains('appai-my-pet-veil') || addedNode.classList.contains('appai-my-pet-switch-cover'))) continue;
            sawAdded = true;
            break;
          }
          if (sawAdded) break;
        }
        if (sawAdded && state.previewUrlByColor && Object.keys(state.previewUrlByColor).length && addedTouchesGallery(mutations)) {
          var liveGallery = liveColourChoice();
          if (state.sectionFetchSeq && state.sectionFetchSeq !== liveGallery.seq) logColourRace(state.sectionFetchSeq, liveGallery);
          if (state.colourPaint && state.colourPaint.url) {
            repaintColourReplacement('mutation');
          } else {
            var swapped = 0;
            if (!state.gallerySyncing) swapped = swapVariantSlides(state.previewUrlByColor) || 0;
            if (swapped) scheduleGallerySync('gallery');
            clearTimeout(state.colourSettleTimer);
            state.colourSettleTimer = setTimeout(function () {
              if (designTransitionActive() || state.reverted || !state.inlineApplied) return;
              if (state.colourPaint && state.colourPaint.url) return;
              if (!state.previewUrlByColor) return;
              try { swapVariantSlides(state.previewUrlByColor); } catch (eSettle) {}
            }, 200);
          }
        }
        if (state.designCover) paintDesignCover();
        // Legacy single-hero fallback: themes without per-variant slides
        // (Dawn simple products) still need the opacity-hide + hero-src
        // trick for added <img> nodes. Scoped to hero-sized candidates
        // to stay out of thumbnails / nav arrows / badges.
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
              if (!galleryImgAllowed(img)) continue;
              if (img.closest && img.closest('dialog, zoom-dialog')) continue;
              if (img.classList && img.classList.contains('appai-my-pet-cover')) continue;
              if (looksLikeThumb(img)) continue;
              if (!isHeroCandidate(img)) continue;
              // Keep the outgoing hero visible. Point the guard at the new
              // node only — never opacity 0, never remove the old img.
              if (state.holdOldHero && img === state.holdOldHero) continue;
              state.inlineHero = img;
              installHeroGuard(img);
            }
          }
        }
      });
      observer.observe(watch, { childList: true, subtree: true });
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
      var handler = function (event) {
        var evtType = event && event.type ? event.type : '(unknown)';
        // STAGING-98 — log every entry + every bail reason so silent fails
        // are visible in the console. Noise budget: only fires on variant
        // change events, not every microtask.
        if (!state.inlineApplied) { console.log(TAG, 'inline variant evt:', evtType, '→ bail inlineApplied=false'); return; }
        if (!state.inlineHero) { console.log(TAG, 'inline variant evt:', evtType, '→ bail inlineHero=null'); return; }
        if (!state.renderId) { console.log(TAG, 'inline variant evt:', evtType, '→ bail renderId=null'); return; }
        if (designTransitionActive()) {
          console.log(TAG, 'inline variant evt:', evtType, '→ design transition owns this change');
          return;
        }
        var info = currentVariantInfo(root);
        // STAGING-99 cross-check — if the form-derived colour disagrees
        // with the swatch-input-derived colour, prefer the swatch (that's
        // what the shopper actually clicked). Logs the mismatch loudly so
        // a wrong-form pick in findMainProductForm is visible.
        var swColor = readSwatchColor(root);
        if (swColor && info.colorName && swColor !== info.colorName) {
          console.warn(TAG, 'inline variant evt:', evtType, '→ COLOUR MISMATCH form=' + info.colorName + ' swatch=' + swColor + ' — using swatch');
          info.colorName = swColor;
        } else if (swColor && !info.colorName) {
          console.log(TAG, 'inline variant evt:', evtType, '→ form had no colorName, using swatch', swColor);
          info.colorName = swColor;
        }
        var liveEvt = liveColourChoice();
        if (!info.colorName && !liveEvt.colour) { console.log(TAG, 'inline variant evt:', evtType, '→ bail no colorName on variant or swatch'); return; }
        var chosen = liveEvt.colour || info.colorName;
        var expected = liveEvt.url || state.previewUrlByColor[chosen];
        if (expected) {
          console.log(TAG, 'inline variant evt:', evtType, '→ CLIENT CACHE HIT', chosen);
          state.previewUrl = expected;
          reassertColourPreview('variant-evt', chosen, expected);
        } else {
          console.log(TAG, 'inline variant evt:', evtType, '→ no cached URL for', chosen, 'available:', Object.keys(state.previewUrlByColor || {}), '— recomposite');
          swapInlineColor(chosen);
        }
        if (!(state.colourPaint && namesMatch(state.colourPaint.colour, chosen))) {
          scheduleGallerySync('colour');
        }
      };
      for (var i = 0; i < EVENT_NAMES.length; i++) {
        document.addEventListener(EVENT_NAMES[i], handler, true);
        window.addEventListener(EVENT_NAMES[i], handler, true);
      }
    }

    /**
     * STAGING-98 — fallback for themes that don't fire any of the variant
     * events installInlineVariantListeners listens for (Ritual ships with
     * a <product-form> that may not dispatch the Horizon event names we
     * know about). Polls the PDP form's input[name=id] value every 500ms
     * and fires the same swap logic on change. Mirrors the modal-mode
     * watchVariantChange poll. ~2 lookups/s while inlineApplied — no-op
     * overhead when the shopper isn't interacting.
     */
    function installInlineFormPollFallback() {
      if (state.inlineFormPollTimer) return;
      // STAGING-99 — log which form we picked so a wrong-form pick (e.g.
      // the quick-add form of a related product instead of the main PDP
      // form) is obvious. Includes form id/section/product-id attrs +
      // initial variant id + swatch-derived colour cross-check.
      var pickedForm = findMainProductForm(root);
      var formIdInput = pickedForm ? pickedForm.querySelector('input[name="id"], select[name="id"]') : null;
      var initialVid = formIdInput ? formIdInput.value : '(no id input)';
      var formDescriptor = pickedForm
        ? 'id=' + (pickedForm.id || '(none)') +
          ' product-id=' + (pickedForm.getAttribute('product-id') || pickedForm.getAttribute('data-product-id') || '(none)') +
          ' section=' + (function () {
            var sec = pickedForm.closest ? pickedForm.closest('[data-section-id]') : null;
            return sec ? (sec.getAttribute('data-section-id') || '(no section-id)') : '(no section)';
          })() +
          ' formCount=' + document.querySelectorAll('form[action*="/cart/add"]').length
        : '(no form found)';
      console.log(TAG, 'inline form poll install: watching', formDescriptor, 'initialVariantId=' + initialVid,
        'swatchColor=' + (readSwatchColor(root) || '(none)'),
        'variantColor=' + (currentVariantInfo(root).colorName || '(none)'));
      var last = currentVariantInfo(root);
      var trackedSize = '';
      var trackedColour = '';
      state.inlineFormPollTimer = setInterval(function () {
        if (state.reverted || !state.inlineApplied || !state.inlineHero || !state.renderId) return;
        var now = currentVariantInfo(root);
        var swColor = readSwatchColor(root);
        // STAGING-99 cross-check — colour change can come from the swatch
        // BEFORE the form input catches up (theme's swatch handler runs
        // sync; form id update may be in a microtask). Trigger on EITHER
        // channel changing.
        var effectiveColor = (swColor && now.colorName && swColor !== now.colorName)
          ? swColor  // swatch is the shopper's actual intent
          : (now.colorName || swColor);
        var sizeNow = checkedProductOption('size') || trackedSize || now.sizeId || '';
        if (sizeNow && sizeNow !== trackedSize) {
          var firstSize = !trackedSize;
          trackedSize = sizeNow;
          if (!firstSize) {
            if (designTransitionActive()) {
              last = now; return;
            }
            scheduleGallerySync('size');
            scheduleShadowWarm('size');
          }
        }
        if (!trackedColour) {
          trackedColour = effectiveColor || '';
          last = now;
          return;
        }
        if (!effectiveColor || effectiveColor === trackedColour) {
          last = now;
          return;
        }
        var previousColour = trackedColour;
        if (state.selectedColour && effectiveColor && !namesMatch(effectiveColor, state.selectedColour)) {
          var livePoll = liveColourChoice();
          logColourRace(state.sectionFetchSeq || 0, livePoll);
          var keepUrl = livePoll.url || state.previewUrlByColor[state.selectedColour];
          if (keepUrl && !designTransitionActive()) reassertColourPreview('form-poll', livePoll.colour, keepUrl);
          last = now;
          return;
        }
        trackedColour = effectiveColor;
        if (designTransitionActive()) {
          last = now; return;
        }
        console.log(TAG, 'inline form poll: colour changed', previousColour, '→', effectiveColor,
          '(formId=' + now.variantId + ' formColor=' + (now.colorName || '(none)') +
          ' swatch=' + (swColor || '(none)') + ')');
        last = now;
        var liveForm = liveColourChoice();
        var paintColour = liveForm.colour || effectiveColor;
        var expected = liveForm.url || state.previewUrlByColor[paintColour];
        if (expected) {
          console.log(TAG, 'inline form poll: CLIENT CACHE HIT', paintColour);
          state.previewUrl = expected;
          reassertColourPreview('form-poll', paintColour, expected);
        } else {
          console.log(TAG, 'inline form poll: no cached URL for', paintColour, 'available:', Object.keys(state.previewUrlByColor || {}), '— recomposite');
          swapInlineColor(paintColour);
        }
        if (!(state.colourPaint && namesMatch(state.colourPaint.colour, paintColour))) {
          scheduleGallerySync('colour');
        }
        scheduleShadowWarm('colour');
      }, 500);
    }

    function swapInlineColor(colorName) {
      // Issue 7 (post-staging-93) — inlineApplied gate prevents a background
      // /recomposite from completing AFTER the shopper reverted and
      // overwriting the restored stock hero.
      if (!state.inlineHero || !state.renderId || !colorName || !state.inlineApplied) return;
      var cached = state.previewUrlByColor[colorName];
      if (cached) {
        state.previewUrl = cached;
        reassertColourPreview('swap-inline', colorName, cached);
        if (!(state.colourPaint && namesMatch(state.colourPaint.colour, colorName))) {
          scheduleGallerySync('colour');
        }
        console.log(TAG, 'inline colour swap CLIENT CACHE HIT', colorName);
        return;
      }
      var composeGen = state.renderGeneration || 0;
      var composeRender = state.renderId;
      postJson('my-pet/recomposite', { renderId: state.renderId, colorName: colorName })
        .then(function (res) {
          // Issue 7 — re-check inlineApplied after the awaited round-trip
          // so a revert that happened during /recomposite doesn't get
          // undone by this late success writing back to the hero.
          if (!generationCurrent(composeGen, composeRender)) return;
          if (res && res.ok && res.previewUrl && state.inlineApplied) {
            state.previewUrl = res.previewUrl;
            state.previewUrlByColor[colorName] = res.previewUrl;
            mergeColourMap(res.previewUrlsByColor);
            clearColourPending(res.colorName || colorName);
            reassertColourPreview('recomposite', colorName, res.previewUrl);
            // STAGING-100 — also apply to the per-variant slide for this
            // colour so the carousel shows OUR image next time the theme
            // scrolls to it (or now, if it's already the active slide).
            var singletonMap = {}; singletonMap[colorName] = res.previewUrl;
            swapVariantSlides(singletonMap);
            scheduleGallerySync('recomposite');
            writeStoredRender(shopifyProductId, state.renderId, state.jobId);
          }
        })
        .catch(function () { /* leave hero as-is */ });
    }

    function inlineOn() {
      return !!(state.renderId && state.inlineHero && state.inlineApplied);
    }

    // A saved design can be on the hero before activateInlinePreview runs
    // (the opening-cover path returns early). Cart intercept uses this.
    function designReadyForCart() {
      if (!state.renderId || state.reverted) return false;
      if (revertedFlagOn(shopifyProductId)) return false;
      return !!(state.inlineApplied || state.previewUrl || designTransitionActive());
    }

    function mockupForColour(colour) {
      var url = urlForColourMap(state.previewUrlByColor, colour);
      if (url) return Promise.resolve(url);
      if (!colour || !state.renderId) return Promise.resolve('');
      return postJson('my-pet/recomposite', { renderId: state.renderId, colorName: colour })
        .then(function (res) {
          if (res && res.ok && res.previewUrl) {
            state.previewUrlByColor[colour] = res.previewUrl;
            mergeColourMap(res.previewUrlsByColor);
            return urlForColourMap(state.previewUrlByColor, colour) || res.previewUrl;
          }
          return '';
        })
        .catch(function () { return ''; });
    }

    function mainAddToCartComponent() {
      var section = mainProductSection();
      var atc = section && section.querySelector ? section.querySelector('add-to-cart-component') : null;
      if (atc && atc.closest && atc.closest('product-recommendations, product-card, quick-add-modal')) return null;
      return atc;
    }

    function storeMarkUrl() {
      if (state.storeMark) return state.storeMark;
      var icon = null;
      try {
        icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      } catch (e) {}
      var href = icon && icon.getAttribute('href');
      if (href) {
        try { href = new URL(href, window.location.href).href; } catch (e2) {}
        state.storeMark = href;
        return href;
      }
      state.storeMark = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111"/><text x="32" y="46" text-anchor="middle" font-family="Georgia,serif" font-size="42" fill="#fff">P</text></svg>'
      );
      return state.storeMark;
    }

    function silenceThemeFly(btn) {
      var buttons = [];
      if (btn) buttons.push(btn);
      var atc = mainAddToCartComponent();
      var mainBtn = atc && atc.querySelector ? atc.querySelector('button[name="add"], button[type="submit"]') : null;
      if (mainBtn && buttons.indexOf(mainBtn) === -1) buttons.push(mainBtn);
      for (var i = 0; i < buttons.length; i++) buttons[i].dataset.puppet = 'true';
      setTimeout(function () {
        for (var j = 0; j < buttons.length; j++) {
          if (buttons[j].dataset.puppet === 'true') delete buttons[j].dataset.puppet;
        }
        var stickyFlies = [];
        try { stickyFlies = document.querySelectorAll('fly-to-cart.fly-to-cart--sticky'); } catch (e) {}
        for (var k = 0; k < stickyFlies.length; k++) {
          if (stickyFlies[k].parentNode) stickyFlies[k].parentNode.removeChild(stickyFlies[k]);
        }
      }, 0);
    }

    function flyStoreMark(btn) {
      var now = Date.now();
      if (state.flyAt && now - state.flyAt < 500) return;
      var hero = findVisibleHeroImg() || (state.inlineHero && document.body.contains(state.inlineHero) ? state.inlineHero : null) || findProductHeroImg();
      var rect = null;
      try { rect = hero && hero.getBoundingClientRect(); } catch (e) {}
      var dest = document.querySelector('.header-actions__cart-icon') || document.querySelector('a[href*="/cart"]');
      var destRect = null;
      try { destRect = dest && dest.getBoundingClientRect(); } catch (e2) {}
      if (!hero || !rect || rect.width < 2 || rect.height < 2 || !dest || !destRect || destRect.width < 2) {
        console.log(TAG, 'fly mark skipped', 'hero=' + !!hero, 'dest=' + !!dest);
        return;
      }
      state.flyAt = now;
      silenceThemeFly(btn);
      var mark = storeMarkUrl();
      var size = 40;
      var flyer = document.createElement('div');
      flyer.className = 'appai-my-pet-fly';
      flyer.setAttribute('aria-hidden', 'true');
      flyer.style.position = 'fixed';
      flyer.style.left = '0';
      flyer.style.top = '0';
      flyer.style.width = size + 'px';
      flyer.style.height = size + 'px';
      flyer.style.margin = '0';
      flyer.style.padding = '0';
      flyer.style.pointerEvents = 'none';
      flyer.style.zIndex = '2147483000';
      flyer.style.backgroundColor = 'transparent';
      flyer.style.backgroundImage = 'url("' + String(mark).replace(/"/g, '') + '")';
      flyer.style.backgroundRepeat = 'no-repeat';
      flyer.style.backgroundPosition = 'center';
      flyer.style.backgroundSize = 'contain';
      flyer.style.opacity = '1';
      flyer.style.transition = 'none';
      var startX = rect.left + rect.width / 2 - size / 2;
      var startY = rect.top + rect.height / 2 - size / 2;
      var endX = destRect.left + destRect.width / 2 - size / 2;
      var endY = destRect.top + destRect.height / 2 - size / 2;
      flyer.style.transform = 'translate(' + Math.round(startX) + 'px, ' + Math.round(startY) + 'px) scale(1)';
      document.body.appendChild(flyer);
      flyer.offsetWidth;
      flyer.style.transition = 'transform 500ms ease-in, opacity 500ms ease-in';
      flyer.style.transform = 'translate(' + Math.round(endX) + 'px, ' + Math.round(endY) + 'px) scale(0.35)';
      flyer.style.opacity = '0';
      var removed = false;
      function removeFlyer() {
        if (removed) return;
        removed = true;
        if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
      }
      flyer.addEventListener('transitionend', removeFlyer);
      setTimeout(removeFlyer, 1200);
      console.log(TAG, 'fly mark', 'fromHero', Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2), 'w=' + Math.round(rect.width));
    }

    function setFormProperty(form, name, value) {
      var input = form.querySelector('input[data-appai-prop="' + name + '"]');
      if (!value) {
        if (input) input.remove();
        return;
      }
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'properties[' + name + ']';
        input.setAttribute('data-appai-prop', name);
        form.appendChild(input);
      }
      input.value = value;
    }

    function isOurCartForm(form) {
      if (!form || !form.matches || !form.matches('form[action*="/cart/add"]')) return false;
      if (form.closest && form.closest('product-recommendations, .product-recommendations, product-card, quick-add-modal, .quick-add-modal')) return false;
      var section = mainProductSection();
      if (section && section.contains(form)) return true;
      if (form.closest && form.closest('sticky-add-to-cart, .sticky-add-to-cart')) return true;
      return form === findMainProductForm(root);
    }

    function cartLineProperties(res, colorName, sizeName) {
      var properties = {
        '_design_id': res.designLabel || 'My Pet',
        '_appai_my_pet_render_id': res.renderId || state.renderId || '',
      };
      if (res.jobId) properties['_appai_job_id'] = res.jobId;
      var mockup = colourMockupUrl(colorName, res && res.previewUrl);
      if (mockup) properties['_mockup_url'] = mockup;
      if (colorName) properties['_color'] = colorName;
      if (sizeName) properties['_size'] = sizeName;
      return properties;
    }

    // The composed image for this render and colour. Never the catalog photo.
    function colourMockupUrl(colour, fallback) {
      var mapped = '';
      try { mapped = urlForColourMap(state.previewUrlByColor, colour) || ''; } catch (e) {}
      var shown = '';
      try { shown = shownCustomPreviewUrl(); } catch (e2) {}
      var candidates = [mapped, fallback, shown, state.previewUrl];
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i] ? String(candidates[i]) : '';
        if (candidate.indexOf('https://') === 0 && !isCatalogCdn(candidate)) return candidate;
      }
      return '';
    }

    function isCatalogCdn(url) {
      var u = String(url || '');
      return u.indexOf('cdn.shopify') !== -1 || u.indexOf('/cdn/shop/') !== -1;
    }

    // The colour file the shopper is looking at. Session reuse often has no
    // stored mockup, and a catalog CDN url must not become the line property.
    function shownCustomPreviewUrl() {
      var hero = null;
      try { hero = resolveActiveHero(); } catch (e) { return ''; }
      if (!hero) return '';
      var src = String(hero.currentSrc || (hero.getAttribute && hero.getAttribute('src')) || '');
      if (src.indexOf('https://') !== 0 || isCatalogCdn(src)) return '';
      return src;
    }

    function withMockupProperty(entry, colour, sizeName) {
      if (!entry) return '';
      var url = colourMockupUrl(colour, entry.mockupUrl || (entry.properties && entry.properties._mockup_url));
      var props = {};
      var existing = entry.properties || {};
      var keys = Object.keys(existing);
      for (var i = 0; i < keys.length; i++) props[keys[i]] = existing[keys[i]];
      if (!props._design_id) props._design_id = 'My Pet';
      if (!props._appai_my_pet_render_id) props._appai_my_pet_render_id = state.renderId || '';
      if (colour) props._color = colour;
      if (sizeName) props._size = sizeName;
      if (url) props._mockup_url = url;
      else if (props._mockup_url && String(props._mockup_url).indexOf('https://') === 0 && !isCatalogCdn(props._mockup_url)) {
        url = String(props._mockup_url);
      } else delete props._mockup_url;
      entry.properties = props;
      if (url) entry.mockupUrl = url;
      return url;
    }

    function atcSelection() {
      var size = currentSizeName();
      var checked = checkedProductOption('colour');
      var colour = (state.inlineApplied && !state.reverted && state.selectedColour)
        ? state.selectedColour
        : (currentColourName() || '');
      var variant = findExactVariant(root, colour || null, size || null);
      if (variant && colour && checked && !namesMatch(checked, colour)) variant = null;
      if (!variant || variant.id == null) {
        return { catalogId: '', colour: colour || '', sizeName: size || '' };
      }
      return {
        catalogId: String(variant.id),
        colour: colour,
        sizeName: size,
      };
    }

    function normComboPart(value) {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function shadowCacheKey(sel) {
      return shadowRadioKey(sel);
    }

    function shadowRadioKey(sel) {
      return [
        state.renderId || '',
        normComboPart(sel && (sel.colour || sel.colorName)),
        normComboPart(sel && (sel.sizeName || sel.size)),
      ].join('|');
    }

    function shadowStoreId() {
      return 'appai_my_pet_shadow_v1:' + shopifyProductId;
    }

    function readShadowBag() {
      var bag = {};
      function absorb(raw) {
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        var keys = Object.keys(parsed);
        for (var i = 0; i < keys.length; i++) bag[keys[i]] = parsed[keys[i]];
      }
      try { absorb(window.localStorage.getItem(shadowStoreId())); } catch (e) {}
      try { absorb(window.sessionStorage.getItem(shadowStoreId())); } catch (e2) {}
      return bag;
    }

    var SHADOW_CACHE_MAX_MS = 30 * 60 * 1000;

    function shadowEntryFresh(row) {
      var at = Number(row && row.savedAt) || 0;
      if (!at) return false;
      return Date.now() - at < SHADOW_CACHE_MAX_MS;
    }

    function shadowRowMatches(row, sel, key) {
      if (!row || !row.shadowId) return false;
      if (key && row.colour != null) {
        var rowKey = shadowRadioKey({
          colour: row.colour,
          sizeName: row.sizeName,
        });
        if (rowKey === key) return true;
      }
      if (sel && sel.catalogId && row.catalogId && String(row.catalogId) === String(sel.catalogId)) {
        if (normComboPart(row.colour) === normComboPart(sel.colour) || !normComboPart(row.colour)) return true;
      }
      return false;
    }

    function readShadowStore(sel) {
      try {
        var bag = readShadowBag();
        var key = shadowRadioKey(sel);
        var row = bag[key];
        if (!row || !row.shadowId) {
          var keys = Object.keys(bag);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf((state.renderId || '') + '|') !== 0) continue;
            if (shadowRowMatches(bag[keys[i]], sel, key)) {
              row = bag[keys[i]];
              break;
            }
          }
        }
        if (!row || !row.shadowId || !shadowEntryFresh(row)) return null;
        row.reused = true;
        return row;
      } catch (e) {
        return null;
      }
    }

    function writeShadowStore(sel, entry) {
      var row = {
        shadowId: entry.shadowId,
        catalogId: entry.catalogId,
        properties: entry.properties || {},
        mockupUrl: entry.mockupUrl || '',
        colour: entry.colour || sel.colour || '',
        sizeName: entry.sizeName || sel.sizeName || '',
        savedAt: Date.now(),
      };
      var key = shadowRadioKey(sel);
      function write(storage) {
        var bag = {};
        try { bag = JSON.parse(storage.getItem(shadowStoreId()) || '{}') || {}; } catch (e) { bag = {}; }
        bag[key] = row;
        storage.setItem(shadowStoreId(), JSON.stringify(bag));
      }
      try { write(window.sessionStorage); } catch (e) {}
      try { write(window.localStorage); } catch (e2) {}
    }

    function radioCombo(override) {
      var colour = (override && override.colour) || checkedProductOption('colour') || readSwatchColor(root) || '';
      var size = (override && override.size) || checkedProductOption('size') || '';
      return { colour: String(colour || '').trim(), size: String(size || '').trim() };
    }

    function selectionFromRadios(combo) {
      var colour = combo.colour || checkedProductOption('colour') || '';
      var size = combo.size || checkedProductOption('size') || '';
      var variant = findExactVariant(root, colour || null, size || null);
      if (!variant || variant.id == null) {
        return { catalogId: '', colour: colour || '', sizeName: size || '' };
      }
      return {
        catalogId: String(variant.id),
        colour: colour,
        sizeName: size,
      };
    }

    function logShadowCreate(renderId, sel, reused) {
      console.log(
        TAG,
        'shadow create-on-atc',
        'render=' + renderId,
        'colour=' + (sel.colour || ''),
        'size=' + (sel.sizeName || ''),
        'reused=' + (reused ? 'true' : 'false'),
      );
    }

    function dropShadowVariant(variantId) {
      var id = String(variantId || '').replace(/\D/g, '');
      if (!id) return;
      var bag = state.shadowByKey || {};
      var keys = Object.keys(bag);
      for (var i = 0; i < keys.length; i++) {
        if (bag[keys[i]] && String(bag[keys[i]].shadowId || '').replace(/\D/g, '') === id) delete bag[keys[i]];
      }
      function scrub(storage) {
        var raw = storage.getItem(shadowStoreId());
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        var storeKeys = Object.keys(parsed);
        for (var k = 0; k < storeKeys.length; k++) {
          var row = parsed[storeKeys[k]];
          if (row && String(row.shadowId || '').replace(/\D/g, '') === id) delete parsed[storeKeys[k]];
        }
        storage.setItem(shadowStoreId(), JSON.stringify(parsed));
      }
      try { scrub(window.sessionStorage); } catch (e) {}
      try { scrub(window.localStorage); } catch (e2) {}
    }

    function prepareShadowFor(sel, reason, opts) {
      if (reason !== 'click' && reason !== 'warm') return Promise.resolve(null);
      if (!designReadyForCart() || !sel || !sel.catalogId) return Promise.resolve(null);
      var epoch = state.shadowEpoch || 0;
      var renderId = state.renderId;
      var warmToken = reason === 'prefetch' ? state.warmToken : null;
      function current() {
        if (epoch !== (state.shadowEpoch || 0)) return false;
        if (renderId !== state.renderId) return false;
        if (warmToken && warmToken !== state.warmToken) return false;
        if (state.reverted) return false;
        return true;
      }
      if (!current()) return Promise.resolve(null);
      var started = Date.now();
      function logCreate(reused) {
        var ms = Date.now() - started;
        state.lastCreateLog = { ms: ms, reused: !!reused, colour: sel.colour || '', size: sel.sizeName || '' };
        console.log(
          TAG,
          'create ms=' + ms,
          'reused=' + (reused ? 'true' : 'false'),
          'colour=' + (sel.colour || ''),
          'size=' + (sel.sizeName || ''),
        );
      }
      var key = shadowCacheKey(sel);
      var skipCache = !!(opts && opts.skipCache);
      var remembered = null;
      if (!skipCache) {
        var mem = state.shadowByKey && state.shadowByKey[key];
        remembered = mem && shadowEntryFresh(mem) ? mem : readShadowStore(sel);
      }
      if (remembered && remembered.shadowId && shadowEntryFresh(remembered)) {
        remembered.reused = true;
        withMockupProperty(remembered, sel.colour, sel.sizeName);
        state.shadowByKey = state.shadowByKey || {};
        state.shadowByKey[key] = remembered;
        writeShadowStore(sel, remembered);
        console.log(TAG, 'reuse source=session');
        logCreate(true);
        return Promise.resolve(remembered);
      }
      state.shadowFlight = state.shadowFlight || {};
      if (state.shadowFlight[key]) return state.shadowFlight[key];
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctrl) {
        state.shadowAborts = state.shadowAborts || [];
        state.shadowAborts.push(ctrl);
        if (reason === 'prefetch') state.prefetchCtrl = ctrl;
      }
      var promise = mockupForColour(sel.colour).then(function (localUrl) {
        if (!current()) return null;
        return attemptResolveVariant(sel.catalogId, 0, {
          colorName: sel.colour,
          sizeName: sel.sizeName,
          mockupUrl: localUrl,
          signal: ctrl ? ctrl.signal : undefined,
          guard: current,
        }).then(function (res) {
          if (!res || !res.variantId || !current()) return null;
          var entry = {
            key: key,
            catalogId: sel.catalogId,
            shadowId: String(res.variantId),
            properties: cartLineProperties(res, sel.colour, sel.sizeName),
            mockupUrl: (res.previewUrl && String(res.previewUrl).indexOf('https://') === 0) ? res.previewUrl : localUrl,
            colour: sel.colour,
            sizeName: sel.sizeName,
            savedAt: Date.now(),
          };
          entry.reused = res.reused === true;
          withMockupProperty(entry, sel.colour, sel.sizeName);
          state.shadowByKey = state.shadowByKey || {};
          state.shadowByKey[key] = entry;
          writeShadowStore(sel, entry);
          if (entry.reused) console.log(TAG, 'reuse source=server');
          if (res.steps) console.log(TAG, 'resolve steps', res.steps);
          logCreate(entry.reused);
          return entry;
        });
      }).catch(function (err) {
        if (!current() || (err && err.name === 'AbortError')) return null;
        throw err;
      });
      state.shadowFlight[key] = promise;
      var clear = function () {
        if (state.shadowFlight && state.shadowFlight[key] === promise) delete state.shadowFlight[key];
        if (ctrl && state.shadowAborts) {
          var at = state.shadowAborts.indexOf(ctrl);
          if (at !== -1) state.shadowAborts.splice(at, 1);
        }
      };
      promise.then(clear, clear);
      return promise;
    }

    function prepareShadow(reason) {
      if (reason !== 'click') return Promise.resolve(null);
      return prepareShadowFor(atcSelection(), 'click');
    }

    function prepareShadowSoon() {}

    function scheduleSiblingWarm() {}

    // One combo only: the colour and size still selected 2s later.
    // Passing through a colour resets the timer and creates nothing.
    function logWarmDebounce(reason, outcome, sel) {
      console.log(
        TAG,
        'warm debounce',
        'reason=' + (reason || ''),
        outcome,
        'colour=' + ((sel && sel.colour) || ''),
        'size=' + ((sel && sel.sizeName) || ''),
      );
    }

    function scheduleShadowWarm(reason, override) {
      var combo = radioCombo(override);
      if (state.inlineApplied && !state.reverted && state.selectedColour) {
        if (combo.colour && !namesMatch(combo.colour, state.selectedColour)) {
          logWarmDebounce(reason, 'cancelled=colour-mismatch', { colour: state.selectedColour, sizeName: combo.size });
          return;
        }
        combo = { colour: state.selectedColour, size: combo.size };
      }
      var logged = { colour: combo.colour, sizeName: combo.size };
      if (!designReadyForCart()) {
        logWarmDebounce(reason, 'cancelled=design-not-ready', logged);
        return;
      }
      if (designTransitionActive()) {
        logWarmDebounce(reason, 'cancelled=design-transition', logged);
        return;
      }
      if (!combo.colour && !combo.size) {
        logWarmDebounce(reason, 'cancelled=no-variant', logged);
        return;
      }
      var key = shadowRadioKey(combo);
      if (state.shadowWarmTimer && state.shadowWarmKey === key) {
        logWarmDebounce(reason, 'kept=same-combo', logged);
        return;
      }
      if (state.shadowWarmTimer) logWarmDebounce(reason, 'cancelled=rescheduled', logged);
      clearTimeout(state.shadowWarmTimer);
      state.shadowWarmKey = key;
      logWarmDebounce(reason, 'timer-set=2000', logged);
      state.shadowWarmTimer = setTimeout(function () {
        state.shadowWarmTimer = null;
        if (!designReadyForCart()) {
          logWarmDebounce(reason, 'fired-cancelled=design-not-ready', logged);
          return;
        }
        if (designTransitionActive()) {
          logWarmDebounce(reason, 'fired-cancelled=design-transition', logged);
          return;
        }
        var live = radioCombo();
        if (shadowRadioKey(live) !== key) {
          logWarmDebounce(reason, 'fired-cancelled=selection-changed', { colour: live.colour, sizeName: live.size });
          return;
        }
        var now = selectionFromRadios(live);
        if (!now.catalogId) {
          logWarmDebounce(reason, 'fired-cancelled=no-variant', { colour: live.colour, sizeName: live.size });
          return;
        }
        var started = Date.now();
        console.log(TAG, 'warm start', 'colour=' + (now.colour || ''), 'size=' + (now.sizeName || ''), 'reason=' + (reason || ''));
        prepareShadowFor(now, 'warm').then(function (entry) {
          var ms = Date.now() - started;
          state.lastWarmLog = {
            ms: ms,
            colour: now.colour || '',
            size: now.sizeName || '',
            reused: !!(entry && entry.reused),
          };
          console.log(
            TAG,
            'warm end',
            'ms=' + ms,
            'colour=' + (now.colour || ''),
            'size=' + (now.sizeName || ''),
            'reused=' + (entry && entry.reused ? 'true' : 'false'),
          );
        }).catch(function () {
          console.log(TAG, 'warm end', 'ms=' + (Date.now() - started), 'colour=' + (now.colour || ''), 'size=' + (now.sizeName || ''), 'reused=false');
        });
      }, 2000);
    }

    function stampForm(form, entry) {
      if (!form || !entry) return;
      var idInput = form.querySelector('input[name="id"], select[name="id"]');
      if (idInput && !form.getAttribute('data-appai-catalog-id')) {
        form.setAttribute('data-appai-catalog-id', idInput.value);
      }
      if (idInput) idInput.value = String(entry.shadowId);
      var props = entry.properties || {};
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) setFormProperty(form, keys[i], props[keys[i]]);
      form.setAttribute('data-appai-theme-pass', '1');
    }

    function restoreForm(form, catalogId) {
      if (!form) return;
      var idInput = form.querySelector('input[name="id"], select[name="id"]');
      var restoreId = catalogId || form.getAttribute('data-appai-catalog-id') || '';
      if (idInput && restoreId) idInput.value = String(restoreId);
      form.removeAttribute('data-appai-catalog-id');
      form.removeAttribute('data-appai-theme-pass');
      var inputs = form.querySelectorAll('input[data-appai-prop]');
      for (var i = 0; i < inputs.length; i++) inputs[i].remove();
    }

    function restoreStampedForm() {
      var form = findMainProductForm(root);
      if (form) restoreForm(form, form.getAttribute('data-appai-catalog-id'));
      setPreparing(false);
    }

    function buttonLabelNode(btn) {
      if (!btn) return null;
      var content = btn.querySelector('.add-to-cart-text__content');
      if (content) {
        for (var i = 0; i < content.children.length; i++) {
          var child = content.children[i];
          if (child.hasAttribute && child.hasAttribute('ref')) continue;
          if (child.querySelector && child.querySelector('[ref]')) continue;
          return child;
        }
      }
      var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !String(node.nodeValue).trim()) continue;
        var parent = node.parentElement;
        if (parent && parent.closest && parent.closest('[ref]') && parent.closest('[ref]') !== btn) continue;
        if (parent && parent.classList && parent.classList.contains('add-to-cart__added')) continue;
        return node;
      }
      return null;
    }

    function addButtonLabel(btn, text) {
      if (!btn) return;
      var node = buttonLabelNode(btn);
      if (!node) return;
      if (text == null) return node;
      var current = node.nodeType === 3 ? node.nodeValue : node.textContent;
      if (!btn.getAttribute('data-appai-label')) btn.setAttribute('data-appai-label', String(current || '').trim());
      if (node.nodeType === 3) node.nodeValue = text;
      else if (!node.querySelector || !node.querySelector('[ref]')) node.textContent = text;
      return node;
    }

    function setPreparing(on) {
      var nodes = document.querySelectorAll('button[name="add"], button.product-form__submit, sticky-add-to-cart button, .sticky-add-to-cart button');
      for (var i = 0; i < nodes.length; i++) {
        var btn = nodes[i];
        if (btn.closest && btn.closest('product-recommendations, .product-recommendations, product-card, quick-add-modal, .quick-add-modal')) continue;
        var section = mainProductSection();
        var inSection = section && section.contains(btn);
        var inSticky = btn.closest && btn.closest('sticky-add-to-cart, .sticky-add-to-cart');
        if (!inSection && !inSticky) continue;
        if (on) {
          addButtonLabel(btn, 'Preparing your design…');
          if (!btn.disabled) {
            btn.setAttribute('data-appai-preparing', '1');
            btn.disabled = true;
          }
        } else {
          if (btn.getAttribute('data-appai-preparing') === '1') {
            btn.disabled = false;
            btn.removeAttribute('data-appai-preparing');
          }
          if (btn.getAttribute('data-appai-label')) {
            addButtonLabel(btn, btn.getAttribute('data-appai-label'));
            btn.removeAttribute('data-appai-label');
          }
        }
      }
    }

    function cartForms() {
      var forms = [];
      function add(form) {
        if (form && forms.indexOf(form) === -1) forms.push(form);
      }
      var section = mainProductSection();
      var scoped = [];
      try {
        scoped = section ? section.querySelectorAll('form[action*="/cart/add"]') : [];
      } catch (e) {}
      for (var i = 0; i < scoped.length; i++) {
        if (isOurCartForm(scoped[i])) add(scoped[i]);
      }
      var sticky = [];
      try { sticky = document.querySelectorAll('sticky-add-to-cart form[action*="/cart/add"]'); } catch (e2) {}
      for (var s = 0; s < sticky.length; s++) add(sticky[s]);
      add(findMainProductForm(root));
      return forms;
    }

    function primaryCartForm() {
      var section = mainProductSection();
      var component = section && section.querySelector ? section.querySelector('product-form-component') : null;
      var form = component && component.querySelector ? component.querySelector('form[action*="/cart/add"]') : null;
      if (form && isOurCartForm(form)) return form;
      return findMainProductForm(root);
    }

    function stampAllForms(entry) {
      var forms = cartForms();
      for (var i = 0; i < forms.length; i++) stampForm(forms[i], entry);
      var section = mainProductSection();
      var components = [];
      try { components = section ? section.querySelectorAll('product-form-component') : []; } catch (e) {}
      for (var c = 0; c < components.length; c++) {
        var ref = components[c].refs && components[c].refs.variantId;
        if (ref && entry && entry.shadowId) ref.value = String(entry.shadowId);
      }
    }

    function restoreAllForms(catalogId) {
      var forms = cartForms();
      for (var i = 0; i < forms.length; i++) restoreForm(forms[i], catalogId);
    }

    function rememberSubmittedMockup(variantId, url) {
      var id = String(variantId || '').replace(/\D/g, '');
      var mock = String(url || '');
      if (!id || mock.indexOf('https://') !== 0) return;
      window.AppAI = window.AppAI || {};
      window.AppAI.myPetMockupByVariant = window.AppAI.myPetMockupByVariant || {};
      window.AppAI.myPetMockupByVariant[id] = mock;
      try {
        var raw = sessionStorage.getItem('appai:mockupByVariant');
        var bag = raw ? JSON.parse(raw) : {};
        if (!bag || typeof bag !== 'object') bag = {};
        bag[id] = mock;
        sessionStorage.setItem('appai:mockupByVariant', JSON.stringify(bag));
      } catch (e) {}
    }

    function installCartAddInject() {
      if (state.cartAddInjected) return;
      state.cartAddInjected = true;
      function pendingMockup() {
        var click = state.atcClick;
        return click && click.mockupUrl && String(click.mockupUrl).indexOf('https://') === 0 ? String(click.mockupUrl) : '';
      }
      function injectBody(body) {
        var mock = pendingMockup();
        if (!mock || body == null) return body;
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          if (!body.get('properties[_mockup_url]')) body.append('properties[_mockup_url]', mock);
          console.log(TAG, 'atc formdata properties[_mockup_url]=' + (body.get('properties[_mockup_url]') ? 'yes' : 'no'));
          return body;
        }
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
          if (!body.get('properties[_mockup_url]')) body.append('properties[_mockup_url]', mock);
          console.log(TAG, 'atc formdata properties[_mockup_url]=yes');
          return body;
        }
        if (typeof body === 'string') {
          try {
            var parsed = JSON.parse(body);
            if (!parsed || typeof parsed !== 'object') return body;
            var rows = Array.isArray(parsed.items) ? parsed.items : [parsed];
            for (var i = 0; i < rows.length; i++) {
              if (!rows[i] || typeof rows[i] !== 'object') continue;
              rows[i].properties = rows[i].properties || {};
              if (!rows[i].properties._mockup_url) rows[i].properties._mockup_url = mock;
            }
            console.log(TAG, 'atc formdata properties[_mockup_url]=yes');
            return JSON.stringify(parsed);
          } catch (e) {}
        }
        return body;
      }
      function isCartAdd(input) {
        var reqUrl = '';
        try { reqUrl = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        return reqUrl.indexOf('/cart/add') !== -1;
      }
      function retryHeader(init) {
        if (!init || !init.headers) return false;
        var headers = init.headers;
        try {
          if (typeof headers.get === 'function') return headers.get('X-Appai-Shadow-Retry') === '1';
        } catch (e) {}
        return headers['X-Appai-Shadow-Retry'] === '1';
      }
      function snapshotAdd(body) {
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          var entries = [];
          var id = '';
          body.forEach(function (value, key) {
            entries.push([key, value]);
            if (key === 'id') id = String(value || '');
          });
          return { kind: 'form', id: id, entries: entries };
        }
        if (typeof body === 'string') {
          try {
            var parsed = JSON.parse(body);
            var item = Array.isArray(parsed.items) ? parsed.items[0] : parsed;
            return { kind: 'json', id: String((item && item.id) || ''), json: parsed };
          } catch (e) { return null; }
        }
        return null;
      }
      function staleVariantMessage(json) {
        var text = String((json && (json.description || json.message)) || '').toLowerCase();
        return text.indexOf('cannot find variant') !== -1 || text.indexOf('sold out') !== -1;
      }
      function recoverStaleAdd(snap) {
        var oldId = String(snap.id || '').replace(/\D/g, '');
        dropShadowVariant(oldId);
        var sel = atcSelection();
        var click = state.atcClick;
        if (click) {
          if (click.catalogId) sel.catalogId = String(click.catalogId);
          if (click.colour) sel.colour = click.colour;
          if (click.sizeName) sel.sizeName = click.sizeName;
        }
        return prepareShadowFor(sel, 'click', { skipCache: true }).then(function (entry) {
          if (!entry || !entry.shadowId) return null;
          var nextId = String(entry.shadowId);
          if (nextId === oldId) return null;
          console.log(TAG, 'reuse stale variant=' + oldId + ' → re-resolved=' + nextId);
          rememberSubmittedMockup(nextId, (entry.properties && entry.properties._mockup_url) || entry.mockupUrl || '');
          if (snap.kind === 'json') {
            var body = JSON.parse(JSON.stringify(snap.json));
            var numeric = Number(nextId) || nextId;
            if (Array.isArray(body.items) && body.items[0]) body.items[0].id = numeric;
            else body.id = numeric;
            return origFetch('/cart/add.js', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', 'X-Appai-Shadow-Retry': '1' },
              body: JSON.stringify(body),
            });
          }
          var fd = new FormData();
          var sawMockup = false;
          for (var i = 0; i < snap.entries.length; i++) {
            var key = snap.entries[i][0];
            var val = snap.entries[i][1];
            if (key === 'id') val = nextId;
            if (key === 'properties[_mockup_url]') {
              sawMockup = true;
              var fresh = (entry.properties && entry.properties._mockup_url) || '';
              if (fresh) val = fresh;
            }
            fd.append(key, val);
          }
          if (!sawMockup && entry.properties && entry.properties._mockup_url) {
            fd.append('properties[_mockup_url]', entry.properties._mockup_url);
          }
          return origFetch('/cart/add.js', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Appai-Shadow-Retry': '1' },
            body: fd,
          });
        });
      }
      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          var snap = null;
          var already = false;
          try { already = retryHeader(init); } catch (e0) {}
          try {
            if (!already && isCartAdd(input) && init && init.body) {
              init.body = injectBody(init.body);
              snap = snapshotAdd(init.body);
            }
          } catch (e) {}
          var pending = origFetch.apply(this, arguments);
          if (already || !snap || !snap.id) return pending;
          return pending.then(function (res) {
            if (!res || res.status !== 422 || state.shadowAddRetry) return res;
            return res.clone().json().then(function (json) {
              if (!staleVariantMessage(json)) return res;
              state.shadowAddRetry = true;
              return recoverStaleAdd(snap).then(function (retryRes) {
                state.shadowAddRetry = false;
                return retryRes || res;
              }, function () {
                state.shadowAddRetry = false;
                return res;
              });
            }, function () { return res; });
          });
        };
      }
      var origOpen = XMLHttpRequest.prototype.open;
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { this.__appaiUrl = String(url || ''); } catch (e) {}
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try {
          if (this.__appaiUrl && this.__appaiUrl.indexOf('/cart/add') !== -1) body = injectBody(body);
        } catch (e) {}
        return origSend.call(this, body);
      };
    }

    function noteAtcClick(entry, sel) {
      state.atcClickSeq = (state.atcClickSeq || 0) + 1;
      state.atcClick = {
        id: state.atcClickSeq,
        submits: 0,
        catalogId: String(entry.catalogId),
        shadowId: String(entry.shadowId),
        colour: (sel && sel.colour) || entry.colour || '',
        sizeName: (sel && sel.sizeName) || entry.sizeName || '',
        mockup: !!((entry.properties && entry.properties._mockup_url) || entry.mockupUrl),
        mockupUrl: (entry.properties && entry.properties._mockup_url) || entry.mockupUrl || '',
        renderId: state.renderId || '',
        reused: entry.reused === true,
        createMs: state.lastCreateLog ? state.lastCreateLog.ms : null,
        createReused: state.lastCreateLog ? state.lastCreateLog.reused : entry.reused === true,
      };
      var warm = state.lastWarmLog;
      var warmColour = (sel && sel.colour) || entry.colour || '';
      var warmSize = (sel && sel.sizeName) || entry.sizeName || '';
      if (warm && warm.colour === warmColour && warm.size === warmSize) {
        state.atcClick.warmMs = warm.ms;
        state.atcClick.warmColour = warm.colour;
        state.atcClick.warmSize = warm.size;
        state.atcClick.warmReused = warm.reused;
      }
      console.log(
        TAG,
        'atc once',
        'click=' + state.atcClick.id,
        'catalog=' + entry.catalogId,
        'shadow=' + entry.shadowId,
      );
    }

    // /cart/add.js answers with Clear-Site-Data, which wipes the console.
    // Repeat the trail after that response so it stays visible, including
    // cart-thumb lines that the drawer pass logged before the wipe.
    // The cart thumb script listens for this. It runs its own pass 500ms and
    // 1500ms later, so a custom add does not depend on a Horizon cart event.
    function noteCustomAddReturned() {
      try { window.dispatchEvent(new Event('appai:my-pet-added')); } catch (e) {}
    }
    function replayAtcLogs(click) {
      function reprint() {
        if (!click) return;
        // Clear-Site-Data wiped the live lines. This is a reprint, not a second add.
        console.log(TAG, 'atc path=replay', 'click=' + click.id, 'mockup=' + (click.mockup ? 'yes' : 'no'));
        console.log(TAG, 'atc _mockup_url=' + (click.mockupUrl || ''));
        console.log(TAG, 'atc hold', 'catalog=' + click.catalogId, 'colour=' + (click.colour || ''), 'size=' + (click.sizeName || ''));
        console.log(
          TAG,
          'shadow create-on-atc',
          'render=' + (click.renderId || ''),
          'colour=' + (click.colour || ''),
          'size=' + (click.sizeName || ''),
          'reused=' + (click.reused ? 'true' : 'false'),
        );
        console.log(TAG, 'atc submit', 'shadow=yes', 'count=' + (click.submits || 1));
        if (click.warmMs != null) {
          console.log(TAG, 'warm start', 'colour=' + (click.warmColour || ''), 'size=' + (click.warmSize || ''));
          console.log(TAG, 'warm end', 'ms=' + click.warmMs, 'colour=' + (click.warmColour || ''), 'size=' + (click.warmSize || ''), 'reused=' + (click.warmReused ? 'true' : 'false'));
        }
        if (click.createMs != null) {
          console.log(TAG, 'create ms=' + click.createMs, 'reused=' + (click.createReused ? 'true' : 'false'), 'colour=' + (click.colour || ''), 'size=' + (click.sizeName || ''));
        }
        if (click.elapsedMs != null) console.log(TAG, 'atc click→submit ms=' + click.elapsedMs);
      }
      noteCustomAddReturned();
      setTimeout(reprint, 1500);
    }

    function submitThemeOnce(form, entry, sel) {
      var target = primaryCartForm() || form;
      if (!target || !entry) throw new Error('Could not add this design to cart.');
      withMockupProperty(entry, (sel && sel.colour) || entry.colour, (sel && sel.sizeName) || entry.sizeName);
      stampAllForms(entry);
      stampForm(target, entry);
      var idInput = target.querySelector('input[name="id"], select[name="id"]');
      if (!idInput || String(idInput.value) !== String(entry.shadowId) || String(entry.shadowId) === String(entry.catalogId)) {
        console.log(TAG, 'atc submit blocked', 'reason=stamp-missed');
        throw new Error('Could not add this design to cart.');
      }
      noteAtcClick(entry, sel);
      state.atcRelease = true;
      var mockInput = target.querySelector('input[name="properties[_mockup_url]"]');
      console.log(
        TAG,
        'atc form properties[_mockup_url]=' + (mockInput && String(mockInput.value || '').indexOf('https://') === 0 ? 'yes' : 'no'),
      );
      var btn = target.querySelector('button[name="add"], button.product-form__submit');
      try {
        if (typeof target.requestSubmit === 'function') {
          if (btn && btn.form === target) target.requestSubmit(btn);
          else target.requestSubmit();
        } else if (btn && !btn.disabled) {
          btn.click();
        } else {
          throw new Error('Could not add this design to cart.');
        }
      } catch (err) {
        if (btn && !btn.disabled) btn.click();
        else throw err;
      } finally {
        state.atcRelease = false;
      }
    }

    function fallbackCartAdd(res, properties) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: res.variantId, quantity: 1, properties: properties }] }),
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, json: j }; });
      }).then(function (added) {
        if (!added.ok) throw new Error((added.json && (added.json.description || added.json.message)) || 'Could not add to cart');
        refreshAndOpenCartDrawer();
      });
    }

    // The only custom-add submit. Page clicks use the theme form (one
    // requestSubmit). The modal uses one fetch. Both stamp _mockup_url first.
    function submitCustomLine(path, entry, sel, form) {
      if (!entry || !entry.shadowId) throw new Error('Could not add this design to cart.');
      var colour = (sel && sel.colour) || entry.colour || '';
      var sizeName = (sel && sel.sizeName) || entry.sizeName || '';
      var mockup = withMockupProperty(entry, colour, sizeName);
      var sentMockup = (entry.properties && entry.properties._mockup_url) || '';
      rememberSubmittedMockup(entry.shadowId, sentMockup);
      console.log(TAG, 'atc path=' + path, 'mockup=' + (mockup ? 'yes' : 'no'), 'tail=' + srcTail(mockup));
      console.log(TAG, 'atc _mockup_url=' + sentMockup);
      if (path === 'fetch') {
        return fallbackCartAdd({ variantId: entry.shadowId }, entry.properties).then(function () {
          return { ok: true, themed: false };
        });
      }
      submitThemeOnce(form, entry, sel);
      return Promise.resolve({ ok: true, themed: true });
    }

    function showComboToast() {
      var existing = document.getElementById('appai-combo-toast');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var el = document.createElement('div');
      el.id = 'appai-combo-toast';
      el.setAttribute('role', 'status');
      el.textContent = "That colour isn't available in this size. Please pick another colour or size.";
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;max-width:420px;width:calc(100% - 32px);padding:12px 16px;background:#1a1a1a;color:#fff;border-radius:8px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);';
      document.body.appendChild(el);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 4500);
    }

    function mainVariantPicker() {
      var pickers;
      try { pickers = document.querySelectorAll('variant-picker'); } catch (e) { return null; }
      for (var p = 0; p < pickers.length; p++) {
        if (pickers[p].getAttribute('data-template-product-match') !== 'true') continue;
        if (pickers[p].closest && (pickers[p].closest('product-card') || pickers[p].closest('quick-add-dialog'))) continue;
        return pickers[p];
      }
      return null;
    }

    function colourRadioFromEvent(event) {
      var t = event && event.target;
      if (!t || !t.closest) return null;
      var picker = t.closest('variant-picker');
      if (!picker || picker !== mainVariantPicker()) return null;
      var radio = t.tagName === 'INPUT' && t.type === 'radio' ? t : null;
      if (!radio) {
        var label = t.closest('label');
        radio = label ? label.querySelector('input[type="radio"]') : null;
      }
      if (!radio || radio.type !== 'radio') return null;
      var ctx = String(radio.getAttribute('data-option-name') || radio.name || '').toLowerCase();
      if (ctx.indexOf('color') === -1 && ctx.indexOf('colour') === -1) return null;
      return radio;
    }

    function setComboBlocked(on) {
      var nodes = document.querySelectorAll('button[name="add"], button.product-form__submit, sticky-add-to-cart button, .sticky-add-to-cart button');
      for (var i = 0; i < nodes.length; i++) {
        var btn = nodes[i];
        if (btn.closest && btn.closest('product-recommendations, .product-recommendations, product-card, quick-add-modal, .quick-add-modal')) continue;
        var section = mainProductSection();
        var inSection = section && section.contains(btn);
        var inSticky = btn.closest && btn.closest('sticky-add-to-cart, .sticky-add-to-cart');
        if (!inSection && !inSticky) continue;
        if (on) {
          if (btn.getAttribute('data-appai-preparing') === '1') continue;
          btn.disabled = true;
          btn.setAttribute('data-appai-combo-blocked', '1');
        } else if (btn.getAttribute('data-appai-combo-blocked') === '1') {
          btn.removeAttribute('data-appai-combo-blocked');
          if (btn.getAttribute('data-appai-preparing') !== '1') btn.disabled = false;
        }
      }
    }

    function syncColourAvailability() {
      if (state.comboSyncing) return;
      state.comboSyncing = true;
      try {
        var picker = mainVariantPicker();
        var size = checkedProductOption('size') || (currentVariantInfo(root).sizeId || '');
        if (picker) {
          var radios = picker.querySelectorAll('input[type="radio"]');
          for (var i = 0; i < radios.length; i++) {
            var radio = radios[i];
            var ctx = String(radio.getAttribute('data-option-name') || radio.name || '').toLowerCase();
            if (ctx.indexOf('color') === -1 && ctx.indexOf('colour') === -1) continue;
            var ok = !!(size && findExactVariant(root, radio.value, size));
            if (!size) ok = !!findExactVariant(root, radio.value, null);
            if (ok) {
              radio.removeAttribute('aria-disabled');
              radio.setAttribute('data-option-available', 'true');
            } else {
              radio.setAttribute('aria-disabled', 'true');
              radio.setAttribute('data-option-available', 'false');
            }
          }
        }
        var purchase = atcSelection();
        var custom = !!(state.renderId && state.inlineApplied && !state.reverted);
        if (custom) setComboBlocked(!purchase.catalogId);
        else {
          var checkedColour = checkedProductOption('colour');
          var stockOk = !checkedColour || !!findExactVariant(root, checkedColour, size || null);
          setComboBlocked(!stockOk);
        }
      } finally {
        state.comboSyncing = false;
      }
    }

    function installComboGuard() {
      if (state.comboGuard) return;
      state.comboGuard = true;
      function blockUnavailable(event) {
        var radio = colourRadioFromEvent(event);
        if (!radio) return;
        var size = checkedProductOption('size') || (currentVariantInfo(root).sizeId || '');
        if (!size || findExactVariant(root, radio.value, size)) return;
        event.preventDefault();
        event.stopPropagation();
        try { event.stopImmediatePropagation(); } catch (e) {}
      }
      document.addEventListener('pointerdown', blockUnavailable, true);
      document.addEventListener('click', blockUnavailable, true);
      var picker = mainVariantPicker();
      if (picker && window.MutationObserver) {
        var queued = 0;
        var observer = new MutationObserver(function () {
          if (state.comboSyncing) return;
          if (queued) return;
          queued = 1;
          setTimeout(function () {
            queued = 0;
            syncColourAvailability();
          }, 0);
        });
        observer.observe(picker, { subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'data-option-available', 'checked'], childList: true });
        state.comboObserver = observer;
      }
      document.addEventListener('change', function (event) {
        var t = event.target;
        if (!t || !t.closest || !t.closest('variant-picker')) return;
        syncColourAvailability();
        setTimeout(syncColourAvailability, 400);
        setTimeout(syncColourAvailability, 1200);
      }, true);
      syncColourAvailability();
    }

    function installInlineATCIntercept() {
      if (state.atcBound) return;
      state.atcBound = true;
      installCartAddInject();
      // One theme submit per click. The shadow id and line properties are
      // written onto the form before that submit. We never call
      // handleSubmit ourselves — that second call was adding the catalogue
      // variant as well as the shadow.
      document.addEventListener('click', function (e) {
        // The released submit uses requestSubmit. A fallback click must be
        // allowed through. The P flies on this click, before the shadow.
        if (state.atcRelease) return;
        if (!designReadyForCart()) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.shopify-payment-button')) return;
        var btn = t.closest('button[name="add"], button.product-form__submit, sticky-add-to-cart button, .sticky-add-to-cart button');
        if (!btn) return;
        if (btn.closest('product-recommendations, .product-recommendations, product-card, quick-add-modal, .quick-add-modal')) return;
        var section = mainProductSection();
        var inSection = !!(section && section.contains(btn));
        var inSticky = !!btn.closest('sticky-add-to-cart, .sticky-add-to-cart');
        if (!inSection && !inSticky) return;
        var early = atcSelection();
        if (!early.catalogId) {
          e.preventDefault();
          e.stopPropagation();
          try { e.stopImmediatePropagation(); } catch (_) {}
          console.log(TAG, 'atc blocked unavailable colour=' + (early.colour || '') + ' size=' + (early.sizeName || ''));
          showComboToast();
          syncColourAvailability();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation(); } catch (_) {}
        state.atcClickAt = Date.now();
        flyStoreMark(btn);
        if (state.atcBusy) return;
        var form = primaryCartForm() || ((btn.form && isOurCartForm(btn.form)) ? btn.form : findMainProductForm(root));
        holdAndSubmit(form);
      }, true);
      document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!designReadyForCart() || !isOurCartForm(form)) return;
        var click = state.atcClick;
        if (state.atcRelease && click && form.getAttribute('data-appai-theme-pass') === '1') {
          var idInput = form.querySelector('input[name="id"], select[name="id"]');
          if (idInput) idInput.value = String(click.shadowId);
          var submitted = idInput ? String(idInput.value || '') : '';
          if (!submitted || submitted === String(click.catalogId) || submitted !== String(click.shadowId)) {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}
            console.log(TAG, 'atc submit blocked', 'reason=catalog-variant');
            return;
          }
          if (click.mockupUrl) setFormProperty(form, '_mockup_url', click.mockupUrl);
          click.submits += 1;
          click.elapsedMs = state.atcClickAt ? (Date.now() - state.atcClickAt) : 0;
          console.log(
            TAG,
            'atc submit',
            'click=' + click.id,
            'count=' + click.submits,
            'variant=' + submitted,
            'shadow=yes',
          );
          console.log(TAG, 'atc click→submit ms=' + click.elapsedMs);
          if (click.submits === 1) replayAtcLogs(click);
          var catalogId = click.catalogId;
          // Horizon reads the form in its own submit listener. Leave the
          // properties[_mockup_url] input in place until that read has run.
          setTimeout(function () { restoreAllForms(catalogId); }, 50);
          markDismissed(state.renderId);
          markInCart(state.renderId);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation(); } catch (_) {}
        console.log(TAG, 'atc submit blocked', 'reason=shadow-not-stamped');
        if (!state.atcBusy) holdAndSubmit(form);
      }, true);
    }

    function holdAndSubmit(form) {
      if (state.atcBusy) return;
      var sel = atcSelection();
      if (!sel.catalogId) {
        state.atcBusy = false;
        setPreparing(false);
        console.log(TAG, 'atc blocked unavailable colour=' + (sel.colour || '') + ' size=' + (sel.sizeName || ''));
        showComboToast();
        syncColourAvailability();
        return;
      }
      state.atcBusy = true;
      setPreparing(true);
      console.log(TAG, 'atc hold', 'catalog=' + sel.catalogId, 'colour=' + sel.colour, 'size=' + sel.sizeName);
      setTimeout(function () {
        prepareShadow('click')
          .then(function (entry) {
            if (!entry || !designReadyForCart()) throw new Error('Could not add this design to cart.');
            if (String(entry.shadowId) === String(entry.catalogId)) throw new Error('Could not add this design to cart.');
            logShadowCreate(state.renderId, sel, entry.reused === true);
            setPreparing(false);
            submitCustomLine('theme', entry, sel, form || primaryCartForm());
          })
          .catch(function (err) {
            console.warn(TAG, 'inline ATC failed:', err && err.message);
            var retry = 'Couldn’t prepare your design. Try again.';
            if (caption) caption.textContent = retry;
            setTimeout(function () {
              if (caption && caption.textContent === retry) caption.textContent = '';
            }, 4000);
          })
          .then(function () {
            state.atcBusy = false;
            setPreparing(false);
          });
      }, 0);
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
        setModalLocked(picker.overlay, true);
        var generationSettled = false;
        var slowTimer = setTimeout(function () {
          if (generationSettled || !document.body.contains(picker.overlay)) return;
          var slowCopy = picker.body.querySelector('.appai-progress-copy');
          if (slowCopy) slowCopy.textContent = 'This is taking longer than usual';
          picker.body.setAttribute('data-appai-slow', '1');
          setModalLocked(picker.overlay, false);
          if (!picker.body.querySelector('[data-action="close-slow"]')) {
            var slowBtn = document.createElement('button');
            slowBtn.type = 'button';
            slowBtn.className = 'appai-secondary';
            slowBtn.setAttribute('data-action', 'close-slow');
            slowBtn.textContent = 'Close';
            slowBtn.addEventListener('click', function () { picker.overlay.remove(); });
            picker.body.appendChild(slowBtn);
          }
        }, 90000);
        function settleGeneration() {
          generationSettled = true;
          clearTimeout(slowTimer);
        }
        function showGenerationError(message) {
          if (!document.body.contains(picker.overlay)) return;
          setModalLocked(picker.overlay, false);
          picker.body.innerHTML =
            '<p class="appai-my-pet-msg">' + message + '</p>' +
            '<button type="button" class="appai-secondary" data-action="close-error">Close</button>';
          var closeErr = picker.body.querySelector('[data-action="close-error"]');
          if (closeErr) closeErr.addEventListener('click', function () { picker.overlay.remove(); });
        }
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
            settleGeneration();
            if (!genRes || !genRes.ok) {
              showGenerationError((genRes && genRes.message) || (genRes && genRes.error) || 'We could not create this design. Please try again.');
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
            probeCartForRender(genRes.renderId);
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
            settleGeneration();
            showGenerationError(err && err.message ? err.message : 'Something went wrong. Please try again.');
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
        '<p class="appai-my-pet-msg appai-progress-copy">Creating your design… about 30 seconds</p>' +
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
        if (body.hasAttribute('data-appai-slow')) return;
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
      var form = findMainProductForm(root);
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
        assignImgSrc(img, cached);
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
            preload.crossOrigin = 'anonymous';
            preload.onload = function () {
              assignImgSrc(img, res.previewUrl);
              clearLoadingState();
              if (status) status.textContent = '';
              console.log(TAG, 'colour swap total', Date.now() - swapStarted, 'ms');
            };
            preload.onerror = function () {
              assignImgSrc(img, res.previewUrl);
              clearLoadingState();
              if (status) status.textContent = '';
            };
            preload.crossOrigin = 'anonymous';
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
    function attemptResolveVariant(variantId, attempt, extra) {
      if (extra && typeof extra.guard === 'function' && !extra.guard()) return Promise.resolve(null);
      var body = { renderId: state.renderId, variantId: variantId };
      if (extra) {
        if (extra.colorName) body.colorName = extra.colorName;
        if (extra.sizeName) body.sizeName = extra.sizeName;
        if (extra.mockupUrl) body.mockupUrl = extra.mockupUrl;
      }
      return postJson('my-pet/resolve-variant', body, extra && extra.signal)
        .then(function (res) {
          if (extra && typeof extra.guard === 'function' && !extra.guard()) return null;
          if (res && res.success && res.variantId) return res;
          var code = res && res.code;
          if (code === 'still_preparing') {
            // Retry up to 4 times with 1.5s / 3s / 5s / 8s backoff — ~17s total,
            // well under the 30s storefront fetch limit for subsequent tries.
            var backoffs = [1500, 3000, 5000, 8000];
            if (attempt < backoffs.length) {
              return new Promise(function (resolve, reject) {
                setTimeout(function () {
                  if (extra && typeof extra.guard === 'function' && !extra.guard()) { resolve(null); return; }
                  attemptResolveVariant(variantId, attempt + 1, extra).then(resolve, reject);
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
        console.log(TAG, 'atc blocked unavailable colour=' + (state.swatchColor || '') + ' size=' + (state.swatchSize || ''));
        showComboToast();
        checkComboAvailable(body);
        return;
      }
      var exactVariantId = String(exact.id);

      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Setting up your cart line…';
      var modalColour = state.swatchColor || '';
      var modalSize = state.swatchSize || '';
      mockupForColour(modalColour)
        .then(function (localUrl) {
          console.log(TAG, 'atc colour=' + modalColour, 'size=' + modalSize, 'mockupTail=' + srcTail(localUrl));
          return attemptResolveVariant(exactVariantId, 0, {
            colorName: modalColour,
            sizeName: modalSize,
            mockupUrl: localUrl,
          });
        })
        .then(function (res) {
          if (status) status.textContent = 'Adding to cart…';
          console.log(TAG, 'atc sentTail=' + srcTail(res.previewUrl), 'shadowImageTail=' + srcTail(res.shadowImage || res.previewUrl));
          // Issue 10: line-item properties that (a) let appai-cart-images.js
          // recognise this as an AppAI line and swap the thumbnail to the
          // composite mockup, (b) tie the line back to generationJobs for the
          // existing fulfillment path, (c) tie it back to my_pet_renders for the
          // audit metafield written on orders/paid.
          //
          // Underscore-prefixed keys are hidden from buyer-facing cart UI (per
          // Shopify convention + our cart-guard script) — merchant / support
          // sees them on the Shopify order page.
          // Bugs B/C — write the shopper's ACTUAL selected colour/size, not
          // whatever happened to be on the PDP form when ATC was clicked.
          var entry = {
            shadowId: String(res.variantId),
            catalogId: exactVariantId,
            properties: cartLineProperties(res, modalColour, modalSize),
            mockupUrl: res.previewUrl || '',
            colour: modalColour,
            sizeName: modalSize,
            reused: res.reused === true,
          };
          return submitCustomLine('fetch', entry, { colour: modalColour, sizeName: modalSize });
        })
        .then(function (added) {
          if (!added || !added.ok) throw new Error('Could not add to cart');
          markInCart(state.renderId);
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
          if (!added.themed) refreshAndOpenCartDrawer();
          noteCustomAddReturned();
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
    function selectedDesignPreview() {
      var colour = currentInlineColour();
      var key = colour ? canonicalPreviewColor(colour) : '';
      var map = state.previewUrlByColor || {};
      var url = (key && map[key]) || (colour && map[colour]) || state.previewUrl || '';
      return { colour: key || colour || '', url: url };
    }

    function maybePromptEmailSave(opts) {
      opts = opts || {};
      var force = !!opts.force;
      var trigger = opts.trigger || 'exit-intent';
      if (!state.renderId || state.emailModalOpen) return;
      if (!force && isDismissed(state.renderId)) return;
      state.emailModalOpen = true;
      var renderIdAtOpen = state.renderId;
      var selectedPreview = selectedDesignPreview();
      var modal = buildModal({
        onClose: function () {
          state.emailModalOpen = false;
          markDismissed(renderIdAtOpen); // closed without sending — don't re-ask for this design
        },
      });
      var thumbHtml = selectedPreview.url
        ? '<img src="' + selectedPreview.url + '" class="appai-thumb" alt="Your design (tap to enlarge)" />'
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
      var leaveHref = trigger === 'leave-guard' ? String(opts.leaveHref || '') : '';
      if (leaveHref) {
        headline = 'Keep your design?';
        bodyCopy = "We'll email it to you so you don't lose it.";
        primaryLabel = 'Email me this design';
      }
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
        (leaveHref ? '<button type="button" class="appai-secondary" data-action="leave-anyway">Leave anyway</button>' : '') +
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
        postJson('my-pet/email-save', { renderId: state.renderId, email: email, marketingConsent: withConsent, pageUrl: pageUrl, colorName: selectedPreview.colour })
          .then(function (res) {
            if (res && res.ok) {
              markEmailed(renderIdAtOpen);
              if (leaveHref) {
                writeStoredEmail(email);
                markDismissed(renderIdAtOpen);
                console.log(TAG, 'leave-guard saved');
                window.location.assign(leaveHref);
                return;
              }
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
      var leaveBtn = modal.body.querySelector('[data-action="leave-anyway"]');
      if (leaveBtn && leaveHref) {
        leaveBtn.addEventListener('click', function () {
          console.log(TAG, 'leave-guard left');
          state.emailModalOpen = false;
          modal.overlay.remove();
          window.location.assign(leaveHref);
        });
      }
    }

    // Desktop exit-intent (mouse leaving toward the browser chrome). Mobile has
    // no reliable equivalent — visibilitychange only fires once the page is
    // already hidden, too late to show new UI, so this is a best-effort nudge.
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY <= 0) maybePromptEmailSave();
    });

    function onLeaveGuardClick(event) {
      if (logRelatedSwatch('leave-guard', event)) return;
      var surface = logCapture('leave-guard', event);
      if (surface === 'main-image' || surface === 'zoom-chrome' || surface === 'zoom-thumb') return;
      var renderId = state.renderId;
      if (!renderId || renderWasEmailed(renderId) || renderInCart(renderId) || leaveGuardAlreadyShown(renderId)) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var node = event.target;
      if (!node || !node.closest) return;
      var link = node.closest('a[href]');
      if (!link) return;
      var href = leaveGuardDestination(link);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      markLeaveGuardShown(renderId);
      console.log(TAG, 'leave-guard shown');
      maybePromptEmailSave({ force: true, trigger: 'leave-guard', leaveHref: href });
    }
    if (window.__appaiMyPetLeaveGuardClick) {
      document.removeEventListener('click', window.__appaiMyPetLeaveGuardClick, true);
    }
    window.__appaiMyPetLeaveGuardClick = onLeaveGuardClick;
    document.addEventListener('click', onLeaveGuardClick, true);

    // Email-saved link resume: ?my_pet_token=... loads that render directly,
    // cross-device, no re-upload (valid 30 days).
    try {
      var tokenParam = new URL(window.location.href).searchParams.get('my_pet_token');
      if (tokenParam) {
        getJson('my-pet/resolve-token', { token: tokenParam }).then(function (res) {
          if (res && res.ok) {
            state.renderId = res.renderId;
            state.previewUrl = res.previewUrl;
            markEmailed(res.renderId);
            probeCartForRender(res.renderId);
            // STAGING-96 — email-token restore now receives the same
            // previewUrlsByColor map as fresh generate, so colour swaps
            // after following the save-link are instant CLIENT CACHE HITs.
            state.previewUrlByColor = (res.previewUrlsByColor && typeof res.previewUrlsByColor === 'object')
              ? Object.assign({}, res.previewUrlsByColor)
              : {};
            console.log(TAG, 'email-token restore previewUrlByColor populated', Object.keys(state.previewUrlByColor));
            logPreviewUrlTails('email-token restore', state.previewUrlByColor);
            preloadPreviewUrls(state.previewUrlByColor);
            // UX 7 — honour inline mode on email-token resume as well.
            // STAGING-98 — same current-colour + retry treatment as
            // restoreStoredRender.
            if (previewMode === 'inline') {
              var tokInfo = currentVariantInfo(root);
              var tokSw = readSwatchColor(root);
              var tokColor = (tokSw && tokInfo.colorName && tokSw !== tokInfo.colorName)
                ? tokSw
                : (tokInfo.colorName || tokSw || null);
              var tokColorUrl = tokColor ? state.previewUrlByColor[tokColor] : null;
              var tokUrl = tokColorUrl || res.previewUrl;
              console.log(TAG, 'email-token restore activate: effectiveColor=' + (tokColor || '(unknown)') +
                ' formColor=' + (tokInfo.colorName || '(none)') +
                ' swatchColor=' + (tokSw || '(none)') +
                ' usingCached=' + !!tokColorUrl);
              activateInlinePreviewWithRetry(tokUrl);
              return;
            }
            openPreviewStep(res.previewUrl);
          }
        });
      }
    } catch (e) {}

    openBtn.addEventListener('click', function () {
      // A reverted design must come back before "Try another photo". The
      // button still says Add My Pet, and inlineApplied can be stuck true
      // if a late activate relabelled without a visible swap.
      if (previewMode === 'inline' && state.renderId && (state.reverted || revertedFlagOn(shopifyProductId))) {
        reapplyActiveDesign();
        return;
      }
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
          // STAGING-98 — prefer the current colour's cached URL, same as
          // the restore paths, so a revert+re-activate after a colour
          // change lands on the right composite. Retry wrapper is cheap
          // if the hero is already in the DOM (succeeds first attempt).
          var reInfo = currentVariantInfo(root);
          var reColorUrl = reInfo.colorName ? state.previewUrlByColor[reInfo.colorName] : null;
          activateInlinePreviewWithRetry(reColorUrl || state.previewUrl);
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
    installComboGuard();
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
