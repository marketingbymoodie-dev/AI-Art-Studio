;(function () {
  'use strict';
  // Bump VER on every ship so a stale cached copy cannot block the new installer.
  var CART_IMG_VERSION = '2.9';
  if (window.__APPAI_CART_IMG_REPLACER_VER__ === CART_IMG_VERSION) return;
  window.__APPAI_CART_IMG_REPLACER_VER__ = CART_IMG_VERSION;
  window.__APPAI_CART_IMG_REPLACER_V2__ = true;
  window.__APPAI_CART_IMG_REPLACER__ = true;

  var hushMutations = false;

  /**
   * Rule: cart line IMAGE links are never navigable.
   * Titles / other product links are left alone.
   * CSS covers Horizon (media-container) + common Dawn/OS2 patterns.
   * pointer-events must include descendants — it is not inherited.
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
      /* Cart thumbnail anchors only (not titles). */ +
      'a.cart-items__media-container,' +
      'a.cart-items__media-container *,' +
      '.cart-items__media > a,' +
      '.cart-items__media > a *,' +
      '.cart-item__media > a,' +
      '.cart-item__media > a *,' +
      '.cart-item__image-container > a,' +
      '.cart-item__image-container > a *,' +
      'td.cart-items__media a,' +
      'td.cart-items__media a *{' +
      'cursor:default!important;pointer-events:none!important;text-decoration:none!important;' +
      '}';
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

  function isCartMediaAnchor(a) {
    if (!a || a.tagName !== 'A') return false;
    var cls = typeof a.className === 'string' ? a.className : '';
    if (cls.indexOf('cart-items__media-container') !== -1) return true;
    if (cls.indexOf('cart-item__image') !== -1) return true;
    var parent = a.parentElement;
    if (!parent) return false;
    var pcls =
      typeof parent.className === 'string'
        ? parent.className
        : String(parent.className && parent.className.baseVal ? parent.className.baseVal : '');
    if (pcls.indexOf('cart-items__media') !== -1) return true;
    if (pcls.indexOf('cart-item__media') !== -1) return true;
    if (pcls.indexOf('cart-item__image') !== -1) return true;
    // Anchor whose only meaningful child is a product thumb.
    if (a.querySelector('img.cart-items__media-image, img.cart-item__image, img')) {
      var path = a;
      while (path) {
        var tag = path.tagName ? String(path.tagName).toLowerCase() : '';
        var id = String(path.id || '').toLowerCase();
        var c =
          typeof path.className === 'string'
            ? path.className.toLowerCase()
            : '';
        if (
          tag.indexOf('cart') !== -1 ||
          id.indexOf('cart') !== -1 ||
          c.indexOf('cart-item') !== -1 ||
          c.indexOf('cart-drawer') !== -1 ||
          c.indexOf('cart-items') !== -1
        ) {
          // Prefer media cells over title links.
          if (c.indexOf('title') !== -1 || cls.indexOf('title') !== -1) return false;
          if (
            c.indexOf('media') !== -1 ||
            c.indexOf('image') !== -1 ||
            cls.indexOf('media') !== -1 ||
            a.querySelector('img')
          ) {
            return c.indexOf('details') === -1 && cls.indexOf('cart-items__title') === -1;
          }
        }
        path = path.parentElement;
      }
    }
    return false;
  }

  function stripCartMediaHrefs() {
    if (hushMutations) return;
    hushMutations = true;
    try {
      var links = deepQueryAll(
        document.documentElement,
        'a.cart-items__media-container, .cart-items__media > a, .cart-item__media > a, td.cart-items__media a',
      );
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (!a || a.getAttribute('data-appai-media-nolink') === '1') continue;
        var href = a.getAttribute('href');
        if (href) a.setAttribute('data-appai-original-href', href);
        a.removeAttribute('href');
        a.setAttribute('data-appai-media-nolink', '1');
        a.setAttribute('role', 'presentation');
        a.setAttribute('tabindex', '-1');
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

  function onMediaNavIntercept(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path || !path.length) {
      var t = e.target;
      path = [];
      while (t) {
        path.push(t);
        t = t.parentNode;
      }
    }
    for (var i = 0; i < path.length; i++) {
      if (isCartMediaAnchor(path[i])) {
        blockNavEvent(e);
        return;
      }
    }
  }

  ['click', 'auxclick', 'pointerdown'].forEach(function (type) {
    document.addEventListener(type, onMediaNavIntercept, true);
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

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var url = mockupUrlFromLineProperties(it && it.properties);
          if (!url) continue;
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
  console.log('[AppAI Cart Image] installed ' + CART_IMG_VERSION + ' (media links disabled)');
})();
