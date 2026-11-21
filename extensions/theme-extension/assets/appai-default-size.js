/**
 * Size M is the default, and it stays in place: XS, S, M, L, XL, 2XL, 3XL.
 * On a product page with no ?variant=, check M for the colour already
 * selected and let the theme's variant picker update the variant input,
 * the price, and the URL. The flag keeps My Pet from treating that as a
 * colour swap.
 * Collection and product links gain ?variant=<M of the default colour>
 * so the next page is right before this script runs.
 *
 * Petposterous app listings are the exception. A fresh open leaves the
 * colour selected and no size selected. The hidden variant input stays
 * so the price still renders, and add-to-cart is refused until the
 * shopper picks a size. A URL variant, a saved My Pet size, or Find my
 * size's Use size button still arrives already selected. Other shops
 * keep the M default.
 */
(function () {
  if (typeof window.__appaiVariantOnLoad === 'undefined') {
    window.__appaiVariantOnLoad = /(?:^|[?&])variant=/.test(window.location.search);
  }
  if (window.__appaiDefaultSizeM) return;
  window.__appaiDefaultSizeM = true;

  var CACHE_KEY = 'appai_m_variant_v1';
  var PET_RENDER_PREFIX = 'appai_my_pet_render_v1:';
  var PET_RENDER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function variantInUrl() {
    return /(?:^|[?&])variant=/.test(window.location.search);
  }

  function isSizeRadio(radio) {
    var name = String(radio.name || '').toLowerCase();
    if (name.indexOf('size') !== -1 && name.indexOf('color') === -1 && name.indexOf('colour') === -1) return true;
    var box = radio.closest ? radio.closest('fieldset, [data-option-name]') : null;
    if (!box) return false;
    var ctx = String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
    var legend = box.querySelector ? box.querySelector('legend') : null;
    if (legend) ctx += ' ' + String(legend.textContent || '').toLowerCase();
    if (ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1) return false;
    return ctx.indexOf('size') !== -1;
  }

  function sameOption(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function isColourRadio(radio) {
    var name = String(radio.name || '').toLowerCase();
    if (name.indexOf('color') !== -1 || name.indexOf('colour') !== -1) return true;
    var box = radio.closest ? radio.closest('fieldset, [data-option-name]') : null;
    if (!box) return false;
    var ctx = String(box.getAttribute('data-option-name') || box.getAttribute('data-option') || '').toLowerCase();
    var legend = box.querySelector ? box.querySelector('legend') : null;
    if (legend) ctx += ' ' + String(legend.textContent || '').toLowerCase();
    if (ctx.indexOf('size') !== -1 && ctx.indexOf('color') === -1 && ctx.indexOf('colour') === -1) return false;
    return ctx.indexOf('color') !== -1 || ctx.indexOf('colour') !== -1;
  }

  function pageProductId(picker) {
    var pet = document.querySelector('.appai-my-pet[data-product-id]');
    if (pet && pet.getAttribute('data-product-id')) return pet.getAttribute('data-product-id');
    return picker && picker.getAttribute('data-product-id') ? picker.getAttribute('data-product-id') : '';
  }

  function readStoredPet(productId) {
    if (!productId) return null;
    var prefix = PET_RENDER_PREFIX + productId + ':';
    var best = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(prefix) !== 0) continue;
        var parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!parsed || !parsed.renderId || !parsed.savedAt) continue;
        if (Date.now() - parsed.savedAt > PET_RENDER_MAX_AGE_MS) continue;
        if (!best || parsed.savedAt > best.savedAt) best = parsed;
      }
    } catch (e) { return null; }
    return best;
  }

  function variantIdFor(colorName, sizeName) {
    var root = document.querySelector('.appai-my-pet[data-variants]');
    if (!root) return '';
    var variants = [];
    var names = [];
    try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch (e) { return ''; }
    try { names = (root.getAttribute('data-option-names') || '').split('::'); } catch (e) { return ''; }
    function optionValue(variant, wanted) {
      for (var i = 0; i < names.length; i++) {
        var n = String(names[i] || '').toLowerCase();
        var hit = false;
        for (var w = 0; w < wanted.length; w++) if (n.indexOf(wanted[w]) !== -1) hit = true;
        if (!hit) continue;
        return variant['option' + (i + 1)];
      }
      return '';
    }
    for (var v = 0; v < variants.length; v++) {
      if (!sameOption(optionValue(variants[v], ['color', 'colour']), colorName)) continue;
      if (!sameOption(optionValue(variants[v], ['size']), sizeName)) continue;
      if (variants[v].available === false) continue;
      return String(variants[v].id);
    }
    return '';
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

  function radioAvailable(radio) {
    if (!radio || radio.disabled) return false;
    if (radio.getAttribute('aria-disabled') === 'true') return false;
    if (radio.getAttribute('data-option-available') === 'false') return false;
    return true;
  }

  function findOptionRadio(picker, kind, value, force) {
    var radios = picker.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < radios.length; i++) {
      var radio = radios[i];
      if (kind === 'size' ? !isSizeRadio(radio) : !isColourRadio(radio)) continue;
      if (!sameOption(radio.value, value)) continue;
      if (radio.disabled) continue;
      // A colour can look sold out only because the size on the page has no
      // variant (Sage has no XS). When the saved combo exists, select it.
      if (!force && !radioAvailable(radio)) continue;
      return radio;
    }
    return null;
  }

  function selectSavedPet(picker, stored) {
    var variantId = variantIdFor(stored.colorName, stored.sizeName);
    var sizeRadio = findOptionRadio(picker, 'size', stored.sizeName, !!variantId);
    var colourRadio = findOptionRadio(picker, 'colour', stored.colorName, !!variantId);
    if (!sizeRadio || !colourRadio) return false;
    var section = picker.closest ? picker.closest('.shopify-section') : null;
    var scope = section || document;
    var idInput = scope.querySelector('form input[name="id"]');
    if (sizeRadio.checked && colourRadio.checked && (!variantId || !idInput || idInput.value === variantId)) return true;
    window.__appaiSelectingDefaultSize = true;
    try {
      markRadio(sizeRadio, variantId);
      markRadio(colourRadio, variantId);
      if (variantId && idInput) idInput.value = variantId;
      colourRadio.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      window.__appaiSelectingDefaultSize = false;
    }
    return true;
  }

  function selectMedium() {
    if (variantInUrl()) return;
    var pickers = document.querySelectorAll('variant-picker');
    for (var p = 0; p < pickers.length; p++) {
      var picker = pickers[p];
      if (picker.getAttribute('data-template-product-match') !== 'true') continue;
      if (picker.closest && (picker.closest('product-card') || picker.closest('quick-add-dialog'))) continue;
      var storedPet = readStoredPet(pageProductId(picker));
      if (storedPet && storedPet.colorName && storedPet.sizeName) {
        selectSavedPet(picker, storedPet);
        return;
      }
      if (storedPet) return;
      var radios = picker.querySelectorAll('input[type="radio"]');
      var target = null;
      for (var i = 0; i < radios.length; i++) {
        var radio = radios[i];
        if (!isSizeRadio(radio)) continue;
        if (String(radio.value || '').trim().toUpperCase() !== 'M') continue;
        if (radio.disabled || radio.getAttribute('aria-disabled') === 'true') continue;
        if (radio.getAttribute('data-option-available') === 'false') continue;
        target = radio;
        break;
      }
      if (!target) continue;
      var wanted = target.getAttribute('data-variant-id') || '';
      var section = picker.closest ? picker.closest('.shopify-section') : null;
      var scope = section || document;
      var idInput = scope.querySelector('form input[name="id"]');
      if (target.checked && (!wanted || !idInput || idInput.value === wanted)) continue;
      window.__appaiSelectingDefaultSize = true;
      try {
        target.checked = true;
        target.setAttribute('data-current-checked', 'true');
        if (wanted && idInput) idInput.value = wanted;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } finally {
        window.__appaiSelectingDefaultSize = false;
      }
    }
  }

  function readCache() {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function writeCache(map) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function mediumVariantId(product) {
    var variants = product && product.variants ? product.variants : [];
    if (!variants.length) return '';
    var colour = String(variants[0].option2 || '').trim().toLowerCase();
    for (var i = 0; i < variants.length; i++) {
      var variant = variants[i];
      if (String(variant.option1 || '').trim().toUpperCase() !== 'M') continue;
      if (colour && String(variant.option2 || '').trim().toLowerCase() !== colour) continue;
      if (variant.available === false) continue;
      return String(variant.id);
    }
    return '';
  }

  function productLink(anchor) {
    var raw = anchor.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return null;
    var url;
    try { url = new URL(raw, window.location.origin); } catch (e) { return null; }
    if (url.origin !== window.location.origin) return null;
    if (url.searchParams.has('variant')) return null;
    var match = url.pathname.match(/^\/products\/([^/]+)$/);
    if (!match) return null;
    return { url: url, handle: decodeURIComponent(match[1]) };
  }

  function rewriteLinks(map) {
    var anchors = document.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < anchors.length; i++) {
      var parsed = productLink(anchors[i]);
      if (!parsed || !map[parsed.handle]) continue;
      parsed.url.searchParams.set('variant', map[parsed.handle]);
      anchors[i].setAttribute('href', parsed.url.pathname + parsed.url.search + parsed.url.hash);
    }
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  function pointLinksAtMedium() {
    var map = readCache();
    var missing = [];
    var anchors = document.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < anchors.length; i++) {
      var parsed = productLink(anchors[i]);
      if (!parsed || map[parsed.handle] || missing.indexOf(parsed.handle) !== -1) continue;
      missing.push(parsed.handle);
    }
    rewriteLinks(map);
    if (!missing.length) return;
    var collection = window.location.pathname.match(/^\/collections\/([^/]+)/);
    var pending = collection
      ? fetchJson('/collections/' + collection[1] + '/products.json?limit=250').then(function (data) {
          var products = data && data.products ? data.products : [];
          for (var n = 0; n < products.length; n++) {
            var id = mediumVariantId(products[n]);
            if (id && products[n].handle) map[products[n].handle] = id;
          }
        })
      : Promise.resolve();
    pending.then(function () {
      var still = missing.filter(function (handle) { return !map[handle]; });
      return Promise.all(still.map(function (handle) {
        return fetchJson('/products/' + encodeURIComponent(handle) + '.js').then(function (product) {
          var id = mediumVariantId(product);
          if (id) map[handle] = id;
        });
      }));
    }).then(function () {
      writeCache(map);
      rewriteLinks(map);
    });
  }

  var PETPOSTEROUS_SHOP = 'h7epay-gh.myshopify.com';

  function shopDomain() {
    var root = document.getElementById('appai-root');
    var fromRoot = root && root.getAttribute('data-shop');
    if (fromRoot) return String(fromRoot).trim().toLowerCase();
    var host = document.querySelector('[data-appai-find-my-size][data-shop]');
    var fromHost = host && host.getAttribute('data-shop');
    if (fromHost) return String(fromHost).trim().toLowerCase();
    var pet = document.querySelector('.appai-my-pet[data-shop-domain]');
    var fromPet = pet && pet.getAttribute('data-shop-domain');
    if (fromPet) return String(fromPet).trim().toLowerCase();
    var shopify = window.Shopify && window.Shopify.shop;
    return shopify ? String(shopify).trim().toLowerCase() : '';
  }

  function isPetposterous() {
    var shop = shopDomain();
    return shop === PETPOSTEROUS_SHOP || shop === 'h7epay-gh';
  }

  function isAppListing() {
    return !!document.querySelector('[data-appai-listing="1"]');
  }

  function listingPicker() {
    var pickers = document.querySelectorAll('variant-picker');
    for (var p = 0; p < pickers.length; p++) {
      var picker = pickers[p];
      if (picker.getAttribute('data-template-product-match') !== 'true') continue;
      if (picker.closest && (picker.closest('product-card') || picker.closest('quick-add-dialog') || picker.closest('quick-add-modal'))) continue;
      return picker;
    }
    return null;
  }

  function sizeRadios(picker) {
    var radios = picker ? picker.querySelectorAll('input[type="radio"]') : [];
    var out = [];
    for (var i = 0; i < radios.length; i++) if (isSizeRadio(radios[i])) out.push(radios[i]);
    return out;
  }

  function sizeFieldOf(picker) {
    if (!picker) return null;
    var fields = picker.querySelectorAll('fieldset, [data-option-name]');
    for (var i = 0; i < fields.length; i++) {
      var box = fields[i];
      if (box.querySelector && box.querySelector('.appai-fms__launcher')) return box;
    }
    for (var j = 0; j < fields.length; j++) {
      var field = fields[j];
      var text = String(field.textContent || '').toLowerCase();
      if (text.indexOf('size') !== -1 && text.indexOf('color') === -1 && text.indexOf('colour') === -1) return field;
    }
    return null;
  }

  function ensureSizeStyles() {
    if (document.getElementById('appai-size-needed-style')) return;
    var style = document.createElement('style');
    style.id = 'appai-size-needed-style';
    style.textContent = ''
      + '@keyframes appai-size-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}'
      + '.appai-size-needed.appai-size-shake{animation:appai-size-shake .45s ease}'
      + '.appai-size-needed label{box-shadow:inset 0 0 0 2px #b42318}'
      + '.appai-size-needed__message{display:inline;color:#b42318;margin:8px 12px 0 0;font:inherit;font-size:.95rem}'
      + '.appai-size-needed .appai-fms__launcher{display:inline !important;visibility:visible !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function clearSizePrompt() {
    window.__appaiSizePrompt = false;
    var nodes = document.querySelectorAll('.appai-size-needed, [data-appai-size-prompt]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute && nodes[i].getAttribute('data-appai-size-prompt') === '1') {
        if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        continue;
      }
      nodes[i].classList.remove('appai-size-needed');
      nodes[i].classList.remove('appai-size-shake');
    }
  }

  window.__appaiNoteSizeChosen = function () {
    window.__appaiSizeChosen = true;
    clearSizePrompt();
  };

  function showSizePrompt(opts) {
    opts = opts || {};
    window.__appaiSizePrompt = true;
    ensureSizeStyles();
    var field = sizeFieldOf(listingPicker());
    if (!field) return;
    field.classList.add('appai-size-needed');
    var msg = field.querySelector('[data-appai-size-prompt]');
    if (!msg) {
      msg = document.createElement('p');
      msg.setAttribute('data-appai-size-prompt', '1');
      msg.setAttribute('role', 'alert');
      msg.className = 'appai-size-needed__message';
      msg.textContent = 'Please choose a size';
      var launcher = field.querySelector('.appai-fms__launcher');
      if (launcher && launcher.parentNode === field) field.insertBefore(msg, launcher);
      else field.appendChild(msg);
    }
    var button = field.querySelector('.appai-fms__launcher');
    if (button) {
      button.hidden = false;
      button.style.display = 'inline';
      button.style.marginLeft = '12px';
    }
    if (opts.shake) {
      field.classList.remove('appai-size-shake');
      void field.offsetWidth;
      field.classList.add('appai-size-shake');
    }
    if (opts.scroll) {
      var rect = field.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > window.innerHeight - 40) {
        try { field.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
    }
  }

  function clearSizeRadios(radios) {
    if (window.__appaiSizeChosen) return;
    window.__appaiClearingSize = true;
    try {
      for (var i = 0; i < radios.length; i++) {
        radios[i].checked = false;
        radios[i].removeAttribute('data-current-checked');
        radios[i].removeAttribute('data-appai-size-selected');
      }
    } finally {
      window.__appaiClearingSize = false;
    }
  }

  function releaseUnpickedSize() {
    if (!window.__appaiRequireSize || window.__appaiSizeChosen) return;
    var picker = listingPicker();
    if (!picker) return;
    var radios = sizeRadios(picker);
    if (radios.length < 2) return;
    clearSizeRadios(radios);
    if (window.__appaiSizePrompt) showSizePrompt({ shake: false, scroll: false });
  }

  function sizeRadioFromEvent(event) {
    var t = event && event.target;
    if (!t || !t.closest) return null;
    if (t.closest('product-card, quick-add-dialog, quick-add-modal, .appai-my-pet-modal__overlay')) return null;
    var picker = t.closest('variant-picker');
    if (!picker || picker !== listingPicker()) return null;
    var radio = t.tagName === 'INPUT' && t.type === 'radio' ? t : null;
    if (!radio) {
      var label = t.closest('label');
      radio = label ? label.querySelector('input[type="radio"]') : null;
    }
    if (!radio || !isSizeRadio(radio)) return null;
    return radio;
  }

  function mainProductForm() {
    var picker = listingPicker();
    var section = picker && picker.closest ? picker.closest('.shopify-section, section') : null;
    var scope = section || document;
    var form = scope.querySelector('form[action*="/cart/add"]');
    if (form && !(form.closest && form.closest('product-card, product-recommendations, .product-recommendations, quick-add-dialog, quick-add-modal'))) return form;
    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].closest && forms[i].closest('product-card, product-recommendations, .product-recommendations, quick-add-dialog, quick-add-modal')) continue;
      return forms[i];
    }
    return null;
  }

  function formVariantId(form) {
    if (!form) return '';
    var input = form.querySelector('input[name="id"], select[name="id"]');
    return input ? String(input.value || '') : '';
  }

  function sizeStillRequired() {
    return !!(window.__appaiRequireSize && !window.__appaiSizeChosen);
  }

  function blockUnpickedAdd(event) {
    if (!sizeStillRequired()) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      try { event.stopImmediatePropagation(); } catch (e) {}
    }
    showSizePrompt({ shake: true, scroll: true });
    return true;
  }

  function isPageAddControl(node) {
    if (!node || !node.closest) return false;
    if (node.closest('product-card, product-recommendations, .product-recommendations, quick-add-dialog, quick-add-modal, .appai-my-pet-modal__overlay, .appai-fms')) return false;
    var btn = node.closest('button, input[type="submit"], .shopify-payment-button, shopify-accelerated-checkout, shopify-buy-it-now-button');
    if (!btn) return false;
    if (btn.closest('sticky-add-to-cart, .sticky-add-to-cart, .shopify-payment-button, shopify-accelerated-checkout')) return true;
    if (btn.matches && btn.matches('button[name="add"], button.product-form__submit, .shopify-payment-button__button')) return true;
    var form = btn.form || btn.closest('form[action*="/cart/add"]');
    if (!form || (form.closest && form.closest('product-card, product-recommendations, .product-recommendations, quick-add-dialog, quick-add-modal'))) return false;
    var type = btn.getAttribute ? btn.getAttribute('type') : '';
    return type === 'submit' || btn.type === 'submit';
  }

  function cartAddIds(body) {
    var ids = [];
    function take(value) {
      if (value == null || value === '') return;
      ids.push(String(value));
    }
    if (!body) return ids;
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      take(body.get('id'));
      return ids;
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      take(body.get('id'));
      return ids;
    }
    if (typeof body === 'string') {
      try {
        var obj = JSON.parse(body);
        if (obj && obj.id != null) take(obj.id);
        if (obj && obj.items) {
          for (var i = 0; i < obj.items.length; i++) take(obj.items[i] && obj.items[i].id);
        }
        if (ids.length) return ids;
      } catch (e) {}
      try { take(new URLSearchParams(body).get('id')); } catch (e2) {}
    }
    return ids;
  }

  function blocksCurrentVariant(ids) {
    if (!sizeStillRequired() || !ids || !ids.length) return false;
    var current = formVariantId(mainProductForm());
    if (!current) return false;
    for (var i = 0; i < ids.length; i++) if (ids[i] === current) return true;
    return false;
  }

  function isCartAddUrl(url) {
    try {
      var parsed = new URL(url, window.location.origin);
      return parsed.pathname === '/cart/add.js' || parsed.pathname === '/cart/add';
    } catch (e) {
      return String(url || '').indexOf('/cart/add') !== -1;
    }
  }

  function installUnpickedCartGuard() {
    if (window.__appaiUnpickedSizeGuard) return;
    window.__appaiUnpickedSizeGuard = true;
    document.addEventListener('click', function (event) {
      if (sizeRadioFromEvent(event)) {
        window.__appaiNoteSizeChosen();
        return;
      }
      if (!sizeStillRequired()) return;
      if (isPageAddControl(event.target)) blockUnpickedAdd(event);
    }, true);
    document.addEventListener('change', function (event) {
      if (!sizeStillRequired() || window.__appaiClearingSize) return;
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('product-card, quick-add-dialog, quick-add-modal, .appai-my-pet-modal__overlay')) return;
      setTimeout(releaseUnpickedSize, 0);
    }, true);
    document.addEventListener('submit', function (event) {
      if (!sizeStillRequired()) return;
      var form = event.target;
      if (!form || !form.action || !/\/cart\/add/.test(form.action)) return;
      if (form.closest && form.closest('product-card, product-recommendations, .product-recommendations, quick-add-dialog, quick-add-modal, .appai-my-pet-modal__overlay')) return;
      blockUnpickedAdd(event);
    }, true);
    var previousFetch = window.fetch;
    if (typeof previousFetch === 'function' && !window.__appaiUnpickedFetch) {
      window.__appaiUnpickedFetch = true;
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url ? input.url : ''); } catch (e) {}
        if (isCartAddUrl(url) && blocksCurrentVariant(cartAddIds(init && init.body))) {
          showSizePrompt({ shake: true, scroll: true });
          return Promise.resolve(new Response(JSON.stringify({ status: 422, description: 'Please choose a size', message: 'Please choose a size' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return previousFetch.apply(this, arguments);
      };
    }
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !window.__appaiUnpickedXhr) {
      window.__appaiUnpickedXhr = true;
      var previousOpen = XHR.prototype.open;
      var previousSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__appaiUnpickedCartAdd = isCartAddUrl(url); } catch (e) { this.__appaiUnpickedCartAdd = false; }
        return previousOpen.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        try {
          if ((this.__appaiUnpickedCartAdd || this.__appai_isCartAdd) && blocksCurrentVariant(cartAddIds(body))) {
            showSizePrompt({ shake: true, scroll: true });
            return;
          }
        } catch (e) {}
        return previousSend.apply(this, arguments);
      };
    }
  }

  function watchUnpickedSize() {
    releaseUnpickedSize();
    setTimeout(releaseUnpickedSize, 400);
    setTimeout(releaseUnpickedSize, 1200);
    setTimeout(function () {
      if (window.__appaiSizeChosen) return;
      var radios = sizeRadios(listingPicker());
      if (radios.length < 2) window.__appaiSizeChosen = true;
    }, 1500);
    if (window.__appaiUnpickedSizeWatch) return;
    window.__appaiUnpickedSizeWatch = true;
    var queued = false;
    function schedule() {
      if (queued || window.__appaiSizeChosen || window.__appaiClearingSize) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        releaseUnpickedSize();
      }, 0);
    }
    var picker = listingPicker();
    var rootNode = (picker && picker.parentNode) || document.documentElement;
    if (rootNode && window.MutationObserver) {
      new MutationObserver(schedule).observe(rootNode, { childList: true, subtree: true, attributes: true, attributeFilter: ['checked', 'data-current-checked'] });
    }
    installUnpickedCartGuard();
  }

  function freshListingSkipsDefaultSize() {
    return isPetposterous() && isAppListing() && !variantInUrl();
  }

  function start() {
    if (isPetposterous() && isAppListing() && variantInUrl()) {
      window.__appaiSizeChosen = true;
    } else if (freshListingSkipsDefaultSize()) {
      function applyFreshListing() {
        if (window.__appaiSizeChosen) return;
        var picker = listingPicker();
        var storedPet = picker && readStoredPet(pageProductId(picker));
        if (storedPet && storedPet.colorName && storedPet.sizeName) {
          window.__appaiSizeChosen = true;
          window.__appaiRequireSize = false;
          selectSavedPet(picker, storedPet);
          return;
        }
        window.__appaiRequireSize = true;
        window.__appaiSizeChosen = false;
        releaseUnpickedSize();
      }
      applyFreshListing();
      setTimeout(applyFreshListing, 400);
      watchUnpickedSize();
    } else {
      selectMedium();
      setTimeout(selectMedium, 400);
    }
    if (!isPetposterous()) pointLinksAtMedium();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
