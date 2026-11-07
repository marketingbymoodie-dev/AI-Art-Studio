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
   * Bug 1b — strict lookup: returns a variant only when BOTH colour and size
   * match exactly AND Shopify reports it as purchasable (unlike
   * variantForColor/variantForSize, which fall back to "any variant with this
   * one option" for UI display purposes, and don't check availability at
   * all). Used right before ATC so an invalid/sold-out combination never
   * reaches the server — no "Shop not authorized"-style error for what's
   * actually just "not offered in that colour".
   */
  function findExactVariant(root, colorName, sizeId) {
    var variants = [];
    var optionNames = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) {}
    try { optionNames = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) {}
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var c = findOptionValue(v, optionNames, ['color', 'colour']);
      var s = findOptionValue(v, optionNames, ['size']);
      if (String(c) === String(colorName) && String(s) === String(sizeId) && v.available !== false) return v;
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

  function init(root) {
    injectModalStyles();
    applyThemeVars(root);

    var candidateId = root.getAttribute('data-candidate-id');
    var shopifyProductId = root.getAttribute('data-product-id');
    var pageUrl = root.getAttribute('data-page-url') || window.location.href;
    var openBtn = root.querySelector('[data-appai-my-pet-open]');
    var caption = root.querySelector('.appai-my-pet__caption');
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
        return capStatus.emailBonusAvailable
          ? 'Enter your email for 2 more tries.'
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
          } else {
            clearStoredRender(shopifyProductId);
          }
        })
        .catch(function () { /* leave stored entry; try again next load */ });
    })();

    function openUploadStep() {
      var picker = buildModal();
      picker.body.innerHTML =
        '<h3>Add your pet</h3>' +
        '<p class="appai-my-pet-msg">Choose a clear photo of your pet.</p>' +
        '<input type="file" accept="image/*" class="appai-my-pet-file" />';
      var input = picker.body.querySelector('.appai-my-pet-file');
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
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
        '<p class="appai-my-pet-msg appai-progress-copy">Usually takes 20–25 seconds.</p>' +
        '<div class="appai-progress"><span></span></div>';
      var bar = body.querySelector('.appai-progress > span');
      var copy = body.querySelector('.appai-progress-copy');
      var elapsed = 0;
      // Fill 90% over 22s (the measured median); hold the last 10% so we never
      // claim "done" before the server responds.
      var fillTimer = setInterval(function () {
        if (!document.body.contains(body)) { clearInterval(fillTimer); return; }
        elapsed += 500;
        var pct = Math.min(90, (elapsed / 22000) * 90);
        if (bar) bar.style.width = pct + '%';
        if (copy && elapsed >= 21000 && elapsed < 45000) copy.textContent = 'Almost there…';
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
      var info = currentVariantInfo(root);
      var currentColor = info.colorName;
      var currentSize = info.sizeId;
      var colorSwatchesHtml = '';
      if (colors.length > 1) {
        colorSwatchesHtml += '<div class="appai-my-pet-swatches" data-group="color">';
        for (var i = 0; i < colors.length; i++) {
          var isCurrentC = String(colors[i]) === String(currentColor);
          colorSwatchesHtml += '<button type="button" data-action="swatch-color" data-color="' + colors[i].replace(/"/g, '&quot;') + '"' +
            (isCurrentC ? ' aria-current="true"' : '') + '>' + colors[i] + '</button>';
        }
        colorSwatchesHtml += '</div>';
      }
      // Issue 12 — size swatches alongside colour. Size change updates the base
      // variant only; no recomposite call is needed (print area is the same for
      // S/M/L on apparel). The ATC variantId will pick up the new size via
      // currentVariantInfo at add-to-cart time.
      var sizeSwatchesHtml = '';
      if (sizes.length > 1) {
        sizeSwatchesHtml += '<div class="appai-my-pet-swatches" data-group="size">';
        for (var j = 0; j < sizes.length; j++) {
          var isCurrentS = String(sizes[j]) === String(currentSize);
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
        // Pre-check cap so the shopper sees the message before uploading a
        // new photo rather than wasting ~25s on a generation the server will
        // refuse. "Try another photo" on a blocked product is the direct
        // trigger for the user-facing failure Bug #1 was really about.
        refreshCapStatus().then(function (status) {
          if (status && status.allowed === false) {
            var statusEl = body.querySelector('#appai-my-pet-status');
            if (statusEl) statusEl.textContent = status.message || 'No more tries on this design.';
            return;
          }
          body.closest('.appai-my-pet-modal__overlay').remove();
          openUploadStep();
        });
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
     * Bug 1b — shared combo-availability gate, used before ATC and after
     * every colour/size swatch click. Greys out "Add to cart" and shows the
     * exact message in the plan ("[Size] isn't available in [Colour] — pick
     * another combination.") instead of letting an invalid combo reach the
     * server at all.
     */
    function checkComboAvailable(body) {
      var info = currentVariantInfo(root);
      var atcBtn = body.querySelector('[data-action="add-to-cart"]');
      var status = body.querySelector('#appai-my-pet-status');
      if (info.colorName && info.sizeId && !findExactVariant(root, info.colorName, info.sizeId)) {
        if (atcBtn) atcBtn.disabled = true;
        if (status) status.textContent = info.sizeId + " isn't available in " + info.colorName + " — pick another combination.";
        return false;
      }
      if (atcBtn) atcBtn.disabled = false;
      if (status && status.textContent && status.textContent.indexOf("isn't available in") !== -1) status.textContent = '';
      return true;
    }

    /** Size swatch click (Issue 12): switch base variant to the same colour + chosen size. No model call. */
    function selectSize(body, sizeId) {
      if (!sizeId) return;
      var info = currentVariantInfo(root);
      var v = variantForSize(root, sizeId, info.colorName);
      if (v && v.id) {
        var form = document.querySelector('form[action*="/cart/add"]');
        var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
        if (idInput) {
          idInput.value = String(v.id);
          try { idInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
      }
      // Reflect active state on the size chips.
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

    /** Swatch click in the preview modal: switch base variant, recomposite. No new generation. */
    function selectColor(body, colorName, clickedBtn) {
      if (!colorName || !state.renderId) return;
      var info = currentVariantInfo(root);
      var v = variantForColor(root, colorName, info.sizeId);
      if (v && v.id) {
        // Update the live product form so Add to cart (and the main PDP state)
        // reflect the chosen colour.
        var form = document.querySelector('form[action*="/cart/add"]');
        var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
        if (idInput) {
          idInput.value = String(v.id);
          try { idInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
      }
      // Reflect active state on the swatches without a full re-render.
      // Bug fix: this previously queried '[data-action="swatch"]', but the
      // actual buttons are rendered with data-action="swatch-color" (see
      // colorSwatchesHtml above) — the selector never matched anything, so
      // the active-state highlight silently never updated on any click.
      var allBtns = body.querySelectorAll('[data-action="swatch-color"]');
      for (var i = 0; i < allBtns.length; i++) {
        if (String(allBtns[i].getAttribute('data-color')) === String(colorName)) {
          allBtns[i].setAttribute('aria-current', 'true');
        } else {
          allBtns[i].removeAttribute('aria-current');
        }
      }
      checkComboAvailable(body);
      var img = body.querySelector('img.appai-preview-img');
      var status = body.querySelector('#appai-my-pet-status');
      // UX 5 — immediate feedback: dim the current preview the instant the
      // swatch is tapped, rather than only showing "Updating colour…" text
      // that's easy to miss below the fold. The slow part was real network +
      // compose time, not the lack of a loading cue, but the cue removes the
      // "did my tap even register?" feeling while that work happens.
      if (img) img.classList.add('appai-swatch-loading');
      if (clickedBtn) clickedBtn.setAttribute('aria-busy', 'true');
      if (status) status.textContent = 'Updating colour…';
      var swapStarted = Date.now();
      function clearLoadingState() {
        if (img) img.classList.remove('appai-swatch-loading');
        if (clickedBtn) clickedBtn.removeAttribute('aria-busy');
      }
      postJson('my-pet/recomposite', { renderId: state.renderId, colorName: colorName })
        .then(function (res) {
          if (res && res.ok && img) {
            // UX 5 — preload off-DOM so the <img> swap is a single paint
            // (no visible blank/flash frame while the browser fetches it).
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

    /** Watch the base PDP form for colour changes made outside the modal — mirror into the modal preview. */
    function watchVariantChange(body) {
      var last = currentVariantInfo(root);
      var timer = setInterval(function () {
        if (!document.body.contains(body)) { clearInterval(timer); return; }
        var now = currentVariantInfo(root);
        if (now.colorName && now.colorName !== last.colorName && state.renderId) {
          last = now;
          selectColor(body, now.colorName);
        } else {
          last = now;
        }
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
      // Re-read the base PDP form at click time so a colour or size swatch
      // chosen in the preview modal flows through to the cart line.
      var info = currentVariantInfo(root);
      // Bug 1b — the modal's colour/size swatches can land on a combination
      // the theme itself doesn't sell (e.g. XS doesn't exist in Red). Without
      // this check that invalid combo reached the server, which correctly
      // refused it, but surfaced as the same scary "Shop not authorized"-style
      // error as a real auth failure. Catch it client-side with the exact
      // availability data the theme already embedded, before any network call.
      if (!checkComboAvailable(body)) return;
      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Setting up your cart line…';
      attemptResolveVariant(info.variantId, info.price, 0)
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
          if (info.colorName) properties['_color'] = info.colorName;
          if (info.sizeId) properties['_size'] = info.sizeId;
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
          }
          // Suppress the on-close email-save prompt once the shopper already
          // acted — they do not need to save a design they just added.
          markDismissed(state.renderId);
          document.dispatchEvent(new CustomEvent('cart:refresh'));
        })
        .catch(function (err) {
          if (btn) btn.disabled = false;
          if (status) status.textContent = err && err.message ? err.message : 'Could not add to cart. Please try again.';
        });
    }

    /**
     * Bug 10 — per-render dismissal (not a one-shot boolean) so a shopper who
     * dismisses the save prompt for one design still gets asked again for a
     * NEW design they generate afterward. emailModalOpen guards against
     * mouseleave firing more than once before the shopper reacts (would
     * otherwise stack a second modal over the first).
     */
    function maybePromptEmailSave() {
      if (!state.renderId || state.emailModalOpen || isDismissed(state.renderId)) return;
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
      modal.body.innerHTML =
        '<h3>Save your design?</h3>' +
        thumbHtml +
        '<p class="appai-my-pet-msg">We\'ll email you a link back to it — works for 30 days, on any device.</p>' +
        '<input type="email" placeholder="you@example.com" class="appai-my-pet-email" value="' + readStoredEmail().replace(/"/g, '&quot;') + '" />' +
        '<label><input type="checkbox" class="appai-my-pet-consent" checked /> Keep me posted about new designs</label>' +
        '<button type="button" class="appai-primary" data-action="send">Email me this design</button>' +
        '<p id="appai-my-pet-email-status" class="appai-my-pet-msg"></p>';
      var thumb = modal.body.querySelector('img.appai-thumb');
      if (thumb) thumb.addEventListener('click', function (e) { showZoom(e.currentTarget.src); });
      modal.body.querySelector('[data-action="send"]').addEventListener('click', function () {
        var email = modal.body.querySelector('.appai-my-pet-email').value;
        var consent = modal.body.querySelector('.appai-my-pet-consent').checked;
        var status = modal.body.querySelector('#appai-my-pet-email-status');
        status.textContent = 'Sending…';
        postJson('my-pet/email-save', { renderId: state.renderId, email: email, marketingConsent: consent, pageUrl: pageUrl })
          .then(function (res) {
            status.textContent = res && res.ok ? 'Sent! Check your inbox.' : (res && res.error) || 'Could not send email.';
            if (res && res.ok) {
              writeStoredEmail(email);
              markDismissed(renderIdAtOpen); // sent successfully — stay suppressed for this design
              // Refresh caption — email-save grants +emailBonus more attempts on
              // this listing, so the "X free remaining" number changes.
              refreshCapStatus();
            }
          })
          .catch(function () { status.textContent = 'Could not send email.'; });
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
            openPreviewStep(res.previewUrl);
          }
        });
      }
    } catch (e) {}

    openBtn.addEventListener('click', function () {
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
