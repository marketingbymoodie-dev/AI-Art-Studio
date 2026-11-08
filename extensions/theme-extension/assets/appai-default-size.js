/**
 * Size M is the default, and it stays in place: XS, S, M, L, XL, 2XL, 3XL.
 * On a product page with no ?variant=, check M for the colour already
 * selected and let the theme's variant picker update the variant input,
 * the price, and the URL. The flag keeps My Pet from treating that as a
 * colour swap.
 * Collection and product links gain ?variant=<M of the default colour>
 * so the next page is right before this script runs.
 */
(function () {
  if (window.__appaiDefaultSizeM) return;
  window.__appaiDefaultSizeM = true;

  var CACHE_KEY = 'appai_m_variant_v1';

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

  function selectMedium() {
    if (variantInUrl()) return;
    var pickers = document.querySelectorAll('variant-picker');
    for (var p = 0; p < pickers.length; p++) {
      var picker = pickers[p];
      if (picker.getAttribute('data-template-product-match') !== 'true') continue;
      if (picker.closest && (picker.closest('product-card') || picker.closest('quick-add-dialog'))) continue;
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

  function start() {
    selectMedium();
    setTimeout(selectMedium, 400);
    pointLinksAtMedium();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
