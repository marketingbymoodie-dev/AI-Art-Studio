;(function () {
  'use strict';
  // Bump VER on every ship so a stale cached copy cannot block the new installer.
  var CART_IMG_VERSION = '3.1';
  if (window.__APPAI_CART_IMG_REPLACER_VER__ === CART_IMG_VERSION) return;
  window.__APPAI_CART_IMG_REPLACER_VER__ = CART_IMG_VERSION;
  window.__APPAI_CART_IMG_REPLACER_V2__ = true;
  window.__APPAI_CART_IMG_REPLACER__ = true;

  var hushMutations = false;

  /** Customizer/AppAI cart lines — image + title must not open native/shadow PDPs. */
  var customizerState = {
    keys: new Set(),
    handles: new Set(),
    urlPaths: new Set(),
    variants: new Set(),
  };

  // cursor only — do NOT use pointer-events:none (clicks fall through and bypass our interceptor).
  var MEDIA_KILL_CSS =
    'a.cart-items__media-container,a.cart-items__media-container *,' +
    '.cart-items__media a,.cart-items__media a *,' +
    '.cart-item__media a,.cart-item__media a *,' +
    'td.cart-items__media a,td.cart-items__media a *,' +
    'img.cart-items__media-image,img.cart-item__image,' +
    'a[data-appai-media-nolink],a[data-appai-media-nolink] *,' +
    '.appai-cart-line-locked a,.appai-cart-line-locked a *{' +
    'cursor:default!important;text-decoration:none!important;}';

  /**
   * Rules:
   * 1) All cart line IMAGE links are inert (every line).
   * 2) Customizer line TITLE (+ other product) links are inert (AppAI lines only).
   * Inline styles + shadow-root CSS — document stylesheets do not pierce Horizon shadows.
   */
  function ensureStyles() {
    var s = document.getElementById('appai-cart-noflash-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'appai-cart-noflash-style';
      document.head.appendChild(s);
    }
    s.setAttribute('data-appai-ver', CART_IMG_VERSION);
    s.textContent =
      '.appai-cart-loading .cart-item img:not([data-appai-mockup]),' +
      '.appai-cart-loading [id*="CartItem"] img:not([data-appai-mockup]),' +
      '.appai-cart-loading cart-items img:not([data-appai-mockup]),' +
      '.appai-cart-loading form[action^="/cart"] img:not([data-appai-mockup]) { opacity:0 !important; }' +
      '.cart-item img,[id*="CartItem"] img,cart-items img,form[action^="/cart"] img{transition:opacity 120ms ease;}' +
      MEDIA_KILL_CSS;

    // Horizon cart components may use open shadow roots — inject the same rules there.
    var trees = [];
    collectElementTrees(document.documentElement, trees);
    for (var i = 0; i < trees.length; i++) {
      var root = trees[i];
      if (!root || !root.shadowRoot) continue;
      var sr = root.shadowRoot;
      var existing = sr.getElementById('appai-cart-media-style');
      if (!existing) {
        existing = document.createElement('style');
        existing.id = 'appai-cart-media-style';
        sr.appendChild(existing);
      }
      existing.textContent = MEDIA_KILL_CSS;
    }
  }

  function ensureNoFlash() {
    ensureStyles();
    if (window.location.pathname.indexOf('/cart') === -1) return;
    document.documentElement.classList.add('appai-cart-loading');
    setTimeout(function () {
      document.documentElement.classList.remove('appai-cart-loading');
    }, 1200);
  }
  ensureNoFlash();

  function getCart() {
    return fetch('/cart.js', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('cart.js ' + r.status);
      return r.json();
    });
  }

  function mockupUrlFromLineProperties(props) {
    if (!props) return null;
    if (Array.isArray(props)) {
      for (var i = 0; i < props.length; i++) {
        var e = props[i];
        if (!e) continue;
        var n = String(e.name || e.key || '');
        if (n === '_mockup_url' || n === 'mockup_url') {
          var v = e.value;
          if (v && String(v).indexOf('https://') === 0) return String(v);
        }
      }
      return null;
    }
    var u = props._mockup_url || props.mockup_url;
    if (u && String(u).indexOf('https://') === 0) return String(u);
    return null;
  }

  function propEntries(props) {
    if (!props) return [];
    if (Array.isArray(props)) return props;
    return Object.keys(props).map(function (k) {
      return { name: k, value: props[k] };
    });
  }

  function lineIsCustomizer(it) {
    if (!it) return false;
    if (mockupUrlFromLineProperties(it.properties)) return true;
    var entries = propEntries(it.properties);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e) continue;
      var n = String(e.name || e.key || '');
      var val = e.value;
      if (val == null || String(val).trim() === '') continue;
      if (
        n === '_mockup_url' ||
        n === 'mockup_url' ||
        n === '_design_id' ||
        n === '_appai_job_id' ||
        n === '_artwork_url' ||
        n === 'Artwork' ||
        n === 'artwork'
      ) {
        return true;
      }
    }
    return false;
  }

  function productPathFromHref(href) {
    if (!href) return '';
    try {
      var u = new URL(href, window.location.origin);
      var p = u.pathname || '';
      var idx = p.indexOf('/products/');
      if (idx === -1) return '';
      return p.slice(idx).replace(/\/$/, '');
    } catch (_) {
      var m = String(href).match(/\/products\/[^?#/]+/);
      return m ? m[0] : '';
    }
  }

  function handleFromPath(path) {
    if (!path) return '';
    var m = String(path).match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function rememberCustomizerItem(it) {
    if (!it) return;
    if (it.key) customizerState.keys.add(String(it.key));
    if (it.variant_id != null) customizerState.variants.add(String(it.variant_id));
    if (it.handle) customizerState.handles.add(String(it.handle));
    var path = productPathFromHref(it.url || '');
    if (path) {
      customizerState.urlPaths.add(path);
      var h = handleFromPath(path);
      if (h) customizerState.handles.add(h);
    }
  }

  function hrefIsCustomizerProduct(href) {
    if (!href || customizerState.handles.size === 0) return false;
    var path = productPathFromHref(href);
    if (path && customizerState.urlPaths.has(path)) return true;
    var handle = handleFromPath(path || href);
    return !!(handle && customizerState.handles.has(handle));
  }

  function isLikelyProductImg(img) {
    var src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!src) return false;
    var w = Number(img.getAttribute('width') || img.naturalWidth || 0);
    var h = Number(img.getAttribute('height') || img.naturalHeight || 0);
    if ((w && w <= 40) || (h && h <= 40)) return false;
    if (img.hasAttribute('data-appai-mockup')) return false;
    return true;
  }

  function setImg(img, url) {
    img.src = url;
    img.removeAttribute('srcset');
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    img.removeAttribute('data-lazy-src');
    img.setAttribute('data-appai-mockup', 'true');
  }

  function lineIdxFromEl(el) {
    var m = /CartItem-(\d+)/i.exec(el.id || '');
    if (m) return parseInt(m[1], 10);
    var a =
      el.getAttribute('data-line') ||
      el.getAttribute('data-line-index') ||
      el.getAttribute('data-index');
    if (a) {
      var n = parseInt(a, 10);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  function collectElementTrees(root, out) {
    if (!root || out.indexOf(root) >= 0) return;
    out.push(root);
    if (root.shadowRoot) collectElementTrees(root.shadowRoot, out);
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) collectElementTrees(kids[i], out);
  }

  function deepQueryAll(start, selector) {
    var trees = [],
      matches = [],
      seen = new Set();
    collectElementTrees(start || document.documentElement, trees);
    for (var t = 0; t < trees.length; t++) {
      var root = trees[t];
      if (!root || typeof root.querySelectorAll !== 'function') continue;
      var nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch (_) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        if (seen.has(nodes[i])) continue;
        seen.add(nodes[i]);
        matches.push(nodes[i]);
      }
    }
    return matches;
  }

  function elInCartUi(el) {
    var path = el;
    while (path) {
      if (!path.tagName) {
        path = path.parentNode;
        continue;
      }
      var tag = String(path.tagName).toLowerCase();
      var id = String(path.id || '').toLowerCase();
      var c =
        typeof path.className === 'string'
          ? path.className.toLowerCase()
          : String(path.className && path.className.baseVal ? path.className.baseVal : '').toLowerCase();
      if (
        tag.indexOf('cart') !== -1 ||
        id.indexOf('cart') !== -1 ||
        c.indexOf('cart-item') !== -1 ||
        c.indexOf('cart-drawer') !== -1 ||
        c.indexOf('cart-items') !== -1 ||
        c.indexOf('cart-page') !== -1
      ) {
        return true;
      }
      if (path.getAttribute && (path.getAttribute('action') || '').indexOf('/cart') !== -1) return true;
      path = path.parentNode;
    }
    return window.location.pathname.indexOf('/cart') !== -1;
  }

  function isCartMediaAnchor(a) {
    if (!a || a.tagName !== 'A') return false;
    if (a.getAttribute('data-appai-media-nolink') === '1') return true;
    var cls = typeof a.className === 'string' ? a.className : '';
    if (cls.indexOf('cart-items__title') !== -1) return false;
    if (cls.indexOf('cart-items__media-container') !== -1) return true;
    if (!a.querySelector('img')) return false;
    if (!elInCartUi(a)) return false;
    // Any cart <a> that wraps a product thumb is a media link (not a text title).
    var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 80) return false;
    return true;
  }

  function forceInert(el) {
    if (!el || !el.style) return;
    el.style.setProperty('cursor', 'default', 'important');
    el.style.setProperty('text-decoration', 'none', 'important');
  }

  function neutralizeAnchor(a) {
    if (!a) return;
    var href = a.getAttribute('href');
    if (href) a.setAttribute('data-appai-original-href', href);
    a.removeAttribute('href');
    a.setAttribute('data-appai-media-nolink', '1');
    a.setAttribute('role', 'presentation');
    a.setAttribute('tabindex', '-1');
    a.setAttribute('aria-disabled', 'true');
    forceInert(a);
    var kids = a.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) forceInert(kids[i]);
  }

  /** Primary kill path: find cart thumbnails, then kill their wrapping <a>. */
  function stripCartMediaHrefs() {
    if (hushMutations) return;
    hushMutations = true;
    try {
      ensureStyles();
      var imgs = deepQueryAll(
        document.documentElement,
        'img.cart-items__media-image, img.cart-item__image, .cart-items__media img, .cart-item__media img, td.cart-items__media img, a.cart-items__media-container img',
      );
      var seen = new Set();
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!elInCartUi(img)) continue;
        forceInert(img);
        var a = img.closest ? img.closest('a') : null;
        if (a && !seen.has(a)) {
          seen.add(a);
          neutralizeAnchor(a);
        }
      }
      // Class-based fallback
      var links = deepQueryAll(
        document.documentElement,
        'a.cart-items__media-container, .cart-items__media a, .cart-item__media a, td.cart-items__media a',
      );
      for (var L = 0; L < links.length; L++) {
        if (seen.has(links[L])) continue;
        neutralizeAnchor(links[L]);
      }
    } finally {
      hushMutations = false;
    }
  }

  function lockCustomizerRows() {
    if (!customizerState.keys.size && !customizerState.handles.size) return;
    if (hushMutations) return;
    hushMutations = true;
    try {
      customizerState.keys.forEach(function (key) {
        var nodes = [];
        try {
          if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            nodes = deepQueryAll(document.documentElement, '#CartItem-' + CSS.escape(String(key)));
          }
        } catch (_) {}
        if (!nodes.length) {
          try {
            nodes = deepQueryAll(
              document.documentElement,
              '[data-key="' + String(key).replace(/"/g, '\\"') + '"]',
            );
          } catch (_) {}
        }
        for (var i = 0; i < nodes.length; i++) {
          var row = nodes[i];
          if (row.classList) row.classList.add('appai-cart-line-locked');
          var rowLinks = deepQueryAll(
            row,
            'a[href*="/products/"], a.cart-items__title, a.cart-items__media-container, a[data-appai-original-href]',
          );
          for (var r = 0; r < rowLinks.length; r++) neutralizeAnchor(rowLinks[r]);
        }
      });

      // Also neutralize any cart title/media whose href matches a customizer handle.
      var cartLinks = deepQueryAll(
        document.documentElement,
        'a.cart-items__title[href*="/products/"], a.cart-items__media-container[href*="/products/"], .cart-items a[href*="/products/"], form[action*="/cart"] a[href*="/products/"]',
      );
      for (var c = 0; c < cartLinks.length; c++) {
        var a = cartLinks[c];
        var href = a.getAttribute('href') || a.getAttribute('data-appai-original-href') || '';
        if (hrefIsCustomizerProduct(href) || isCartMediaAnchor(a)) {
          var row =
            (a.closest &&
              (a.closest('.cart-items__table-row') ||
                a.closest('[data-key]') ||
                a.closest('[id*="CartItem"]') ||
                a.closest('.cart-item') ||
                a.closest('[class*="cart-item"]'))) ||
            null;
          if (row && row.classList && hrefIsCustomizerProduct(href)) {
            row.classList.add('appai-cart-line-locked');
          }
          if (hrefIsCustomizerProduct(href) || isCartMediaAnchor(a)) neutralizeAnchor(a);
        }
      }
    } finally {
      hushMutations = false;
    }
  }

  function blockNavEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    return false;
  }

  function pathHasLockedRow(path) {
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (el && el.classList && el.classList.contains('appai-cart-line-locked')) return true;
    }
    return false;
  }

  function onCartProductNavIntercept(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path || !path.length) {
      var t = e.target;
      path = [];
      while (t) {
        path.push(t);
        t = t.parentNode;
      }
    }
    // Block clicks on cart thumbnail images even when theme CSS sets cursor:pointer on the img.
    for (var p = 0; p < path.length; p++) {
      var node = path[p];
      if (!node || node.tagName !== 'IMG') continue;
      if (!elInCartUi(node)) continue;
      var wrap = node.closest ? node.closest('a') : null;
      if (wrap || (node.className && String(node.className).indexOf('media-image') !== -1)) {
        blockNavEvent(e);
        if (wrap) neutralizeAnchor(wrap);
        forceInert(node);
        return;
      }
    }
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || el.tagName !== 'A') continue;
      if (isCartMediaAnchor(el)) {
        blockNavEvent(e);
        neutralizeAnchor(el);
        return;
      }
      var href = el.getAttribute('href') || el.getAttribute('data-appai-original-href') || '';
      if (pathHasLockedRow(path) && String(href).indexOf('/products/') !== -1) {
        blockNavEvent(e);
        neutralizeAnchor(el);
        return;
      }
      if (hrefIsCustomizerProduct(href)) {
        blockNavEvent(e);
        neutralizeAnchor(el);
        return;
      }
    }
  }

  ['click', 'auxclick', 'pointerdown', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, onCartProductNavIntercept, true);
    document.addEventListener(type, onCartProductNavIntercept, true);
  });

  function cartUiRoots() {
    var roots = [];
    var sels = [
      'cart-drawer-component',
      'cart-items-component',
      'cart-drawer',
      'cart-notification',
      'cart-items',
      'cart-drawer-items',
      '.cart-drawer',
      'form[action*="/cart"]',
      '[id*="CartDrawer"]',
      '[id*="cart-drawer"]',
    ];
    for (var i = 0; i < sels.length; i++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(sels[i]);
      } catch (_) {
        continue;
      }
      for (var n = 0; n < nodes.length; n++) {
        if (roots.indexOf(nodes[n]) === -1) roots.push(nodes[n]);
      }
    }
    return roots;
  }

  function applyMockups() {
    if (hushMutations) return;
    ensureStyles();
    stripCartMediaHrefs();
    getCart()
      .then(function (cart) {
        var items = cart.items || [];
        var keyMap = new Map(),
          varMap = new Map(),
          indexed = [];

        customizerState.keys = new Set();
        customizerState.handles = new Set();
        customizerState.urlPaths = new Set();
        customizerState.variants = new Set();

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (lineIsCustomizer(it)) rememberCustomizerItem(it);
          var url = mockupUrlFromLineProperties(it && it.properties);
          if (!url) continue;
          rememberCustomizerItem(it);
          keyMap.set(it.key, url);
          varMap.set(String(it.variant_id), url);
          indexed.push({
            index: i + 1,
            variantId: String(it.variant_id),
            mockupUrl: url,
            key: it.key,
          });
        }

        var replaced = 0;
        hushMutations = true;
        try {
          if (keyMap.size > 0) {
            var inps = deepQueryAll(document.documentElement, "input[name^='updates[']");
            for (var ii = 0; ii < inps.length; ii++) {
              var m = /^updates\[(.+)\]$/.exec(inps[ii].getAttribute('name') || '');
              if (!m) continue;
              var u = keyMap.get(m[1]);
              if (!u) continue;
              var c =
                inps[ii].closest('[data-cart-item]') ||
                inps[ii].closest("[id*='CartItem']") ||
                inps[ii].closest('tr') ||
                inps[ii].closest('li') ||
                inps[ii].closest('.cart-item') ||
                inps[ii].closest("[class*='cart']") ||
                inps[ii].closest('form') ||
                document;
              var imgs = [].slice.call(deepQueryAll(c, 'img')).filter(isLikelyProductImg);
              if (imgs.length) {
                setImg(imgs[0], u);
                replaced++;
              }
            }

            if (replaced === 0 && indexed.length > 0) {
              var sels = [
                '.cart-items__table-row',
                '.cart-item',
                "[class*='cart-item']",
                "[id*='CartItem']",
                'cart-items > *',
                'cart-drawer-items > *',
                'cart-items-component tr',
                "form[action*='/cart'] li",
                "form[action*='/cart'] tr",
              ];
              for (var s = 0; s < sels.length; s++) {
                var nodes = deepQueryAll(document.documentElement, sels[s]);
                if (!nodes.length) continue;
                for (var n = 0; n < nodes.length; n++) {
                  var node = nodes[n];
                  var img = [].slice.call(deepQueryAll(node, 'img')).find(isLikelyProductImg);
                  if (!img) continue;
                  var mu = null;
                  var li = lineIdxFromEl(node);
                  if (li !== null)
                    for (var k = 0; k < indexed.length; k++) {
                      if (indexed[k].index === li) {
                        mu = indexed[k].mockupUrl;
                        break;
                      }
                    }
                  if (!mu) {
                    var va =
                      node.getAttribute('data-variant-id') || node.getAttribute('data-variant');
                    if (!va) {
                      var vel = node.querySelector('[data-variant-id]');
                      if (vel) va = vel.getAttribute('data-variant-id');
                    }
                    if (va) mu = varMap.get(String(va)) || null;
                  }
                  if (!mu && indexed.length === 1) mu = indexed[0].mockupUrl;
                  if (mu) {
                    setImg(img, mu);
                    replaced++;
                  }
                }
              }
            }

            if (replaced === 0 && indexed.length === 1) {
              var cs = cartUiRoots();
              for (var ci = 0; ci < cs.length; ci++) {
                if (!cs[ci]) continue;
                var fi = [].slice.call(deepQueryAll(cs[ci], 'img')).find(isLikelyProductImg);
                if (fi) {
                  setImg(fi, indexed[0].mockupUrl);
                  replaced++;
                  break;
                }
              }
            }
          }
        } finally {
          hushMutations = false;
          document.documentElement.classList.remove('appai-cart-loading');
        }

        if (window.AppAI && typeof window.AppAI.hideInternalCartProperties === 'function') {
          window.AppAI.hideInternalCartProperties();
        }
        stripCartMediaHrefs();
        lockCustomizerRows();
      })
      .catch(function () {
        hushMutations = false;
        document.documentElement.classList.remove('appai-cart-loading');
      });
  }

  var t = null;
  function schedule() {
    if (hushMutations) return;
    clearTimeout(t);
    t = setTimeout(applyMockups, 250);
  }
  window.aiArtFastReplace = applyMockups;
  window.__applyCartMockups = applyMockups;

  applyMockups();
  schedule();
  try {
    var ob = new MutationObserver(function () {
      if (hushMutations) return;
      schedule();
    });
    ob.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  window.addEventListener('appai:cart-updated', schedule);
  document.addEventListener('cart:updated', schedule);
  document.addEventListener('cart:refresh', schedule);
  document.addEventListener('cart:update', schedule);
  document.addEventListener('shopify:section:load', schedule);
  window.addEventListener('pageshow', schedule);
  console.log(
    '[AppAI Cart Image] installed ' +
      CART_IMG_VERSION +
      ' (kill cart imgs + customizer titles)',
  );
})();
