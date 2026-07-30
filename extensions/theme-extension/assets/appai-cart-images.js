;(function () {
  'use strict';
  // Bump VER on every ship so a stale cached copy cannot block the new installer.
  var CART_IMG_VERSION = '2.5';
  if (window.__APPAI_CART_IMG_REPLACER_VER__ === CART_IMG_VERSION) return;
  window.__APPAI_CART_IMG_REPLACER_VER__ = CART_IMG_VERSION;
  window.__APPAI_CART_IMG_REPLACER_V2__ = true;
  window.__APPAI_CART_IMG_REPLACER__ = true;

  /** Live AppAI cart lines — used by sync click interceptor (no await). */
  var appAiState = {
    variants: new Set(),
    handles: new Set(),
    urlPaths: new Set(),
    keys: new Set(),
    indexes: new Set(),
  };

  function ensureNoFlash() {
    if (window.location.pathname.indexOf('/cart') === -1) return;
    document.documentElement.classList.add('appai-cart-loading');
    if (!document.getElementById('appai-cart-noflash-style')) {
      var s = document.createElement('style');
      s.id = 'appai-cart-noflash-style';
      s.textContent =
        '.appai-cart-loading .cart-item img:not([data-appai-mockup]),' +
        '.appai-cart-loading [id*="CartItem"] img:not([data-appai-mockup]),' +
        '.appai-cart-loading cart-items img:not([data-appai-mockup]),' +
        '.appai-cart-loading form[action^="/cart"] img:not([data-appai-mockup]) { opacity:0 !important; }' +
        '.cart-item img,[id*="CartItem"] img,cart-items img,form[action^="/cart"] img{transition:opacity 120ms ease;}' +
        /* Defensive: AppAI-disabled product links look inert */
        'a[data-appai-link-disabled="1"]{cursor:default!important;pointer-events:auto;}';
      document.head.appendChild(s);
    }
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

  function lineIsAppAI(it) {
    if (!it || !it.properties) return false;
    var props = it.properties;
    if (Array.isArray(props)) {
      for (var i = 0; i < props.length; i++) {
        var e = props[i];
        if (!e) continue;
        var n = String(e.name || e.key || '');
        if (
          n === '_mockup_url' ||
          n === 'mockup_url' ||
          n === '_design_id' ||
          n === '_appai_job_id' ||
          n === '_artwork_url'
        ) {
          var val = e.value;
          if (val != null && String(val).trim() !== '') return true;
        }
      }
      return false;
    }
    return !!(
      props._mockup_url ||
      props.mockup_url ||
      props._design_id ||
      props._appai_job_id ||
      props._artwork_url
    );
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

  function variantFromHref(href) {
    var m = /[?&]variant=(\d+)/.exec(String(href || ''));
    return m ? m[1] : '';
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

  function blockNavEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    return false;
  }

  function pathHasCartUi(path) {
    if (window.location.pathname.indexOf('/cart') !== -1) return true;
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || !el.tagName) continue;
      var tag = String(el.tagName).toLowerCase();
      var id = String(el.id || '').toLowerCase();
      var cls =
        typeof el.className === 'string'
          ? el.className.toLowerCase()
          : String(el.className && el.className.baseVal ? el.className.baseVal : '').toLowerCase();
      if (
        tag === 'cart-drawer' ||
        tag === 'cart-notification' ||
        tag === 'cart-items' ||
        tag === 'cart-drawer-items' ||
        tag === 'cart-icon-bubble'
      ) {
        return true;
      }
      if (id.indexOf('cart') !== -1) return true;
      if (cls.indexOf('cart-drawer') !== -1 || cls.indexOf('cart-item') !== -1) return true;
      if (cls.indexOf('mini-cart') !== -1 || cls.indexOf('ajax-cart') !== -1) return true;
      if (el.getAttribute) {
        var action = el.getAttribute('action') || '';
        if (action.indexOf('/cart') !== -1) return true;
      }
    }
    return false;
  }

  function hrefMatchesAppAi(href) {
    if (!href || appAiState.variants.size === 0) return false;
    var vid = variantFromHref(href);
    if (vid && appAiState.variants.has(vid)) return true;
    var path = productPathFromHref(href);
    if (path && appAiState.urlPaths.has(path)) return true;
    var handle = handleFromPath(path || href);
    if (handle && appAiState.handles.has(handle)) return true;
    return false;
  }

  function pathHasAppAiMockup(path) {
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (el && el.getAttribute && el.getAttribute('data-appai-mockup') === 'true') return true;
    }
    return false;
  }

  function findProductAnchorFromEvent(e) {
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
      var el = path[i];
      if (!el || el.tagName !== 'A') continue;
      var href = el.getAttribute('href') || el.href || '';
      if (String(href).indexOf('/products/') !== -1) {
        return { a: el, href: href, path: path };
      }
    }
    return null;
  }

  function shouldBlockProductNav(e) {
    if (appAiState.variants.size === 0) return false;
    var hit = findProductAnchorFromEvent(e);
    if (!hit) return false;
    if (!pathHasCartUi(hit.path)) return false;
    if (hrefMatchesAppAi(hit.href)) return true;
    if (pathHasAppAiMockup(hit.path)) return true;
    // Single AppAI line in cart: any product link in cart UI is that line.
    if (appAiState.variants.size === 1) return true;
    return false;
  }

  function onNavIntercept(e) {
    if (!shouldBlockProductNav(e)) return;
    blockNavEvent(e);
  }

  // Capture-phase on document — works even when theme containers don't match our selectors,
  // and when clicks originate inside open shadow roots (composedPath).
  document.addEventListener('click', onNavIntercept, true);
  document.addEventListener('auxclick', onNavIntercept, true);
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      onNavIntercept(e);
    },
    true,
  );

  function neutralizeAnchor(a) {
    if (!a || a.getAttribute('data-appai-link-disabled') === '1') return;
    a.setAttribute('data-appai-link-disabled', '1');
    a.setAttribute('href', '#');
    a.setAttribute('role', 'link');
    a.setAttribute('aria-disabled', 'true');
    a.style.cursor = 'default';
    a.addEventListener('click', blockNavEvent, true);
    a.addEventListener('auxclick', blockNavEvent, true);
  }

  function disableProductLinksInTree(root) {
    if (!root) return;
    var links = deepQueryAll(root, 'a[href*="/products/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || links[i].href || '';
      if (hrefMatchesAppAi(href) || links[i].querySelector('img[data-appai-mockup]')) {
        neutralizeAnchor(links[i]);
      }
    }
    // Also neutralize any product link that sits next to a replaced mockup image.
    var mockImgs = deepQueryAll(root, 'img[data-appai-mockup]');
    for (var m = 0; m < mockImgs.length; m++) {
      var img = mockImgs[m];
      var wrap = img.closest ? img.closest('a[href*="/products/"]') : null;
      if (wrap) neutralizeAnchor(wrap);
      var row =
        (img.closest &&
          (img.closest('[data-cart-item]') ||
            img.closest('[id*="CartItem"]') ||
            img.closest('.cart-item') ||
            img.closest('tr') ||
            img.closest('li') ||
            img.closest('[class*="cart-item"]'))) ||
        img.parentElement;
      if (row) {
        var rowLinks = deepQueryAll(row, 'a[href*="/products/"]');
        for (var r = 0; r < rowLinks.length; r++) neutralizeAnchor(rowLinks[r]);
      }
    }
  }

  function applyMockups() {
    getCart()
      .then(function (cart) {
        var items = cart.items || [];
        var keyMap = new Map(),
          varMap = new Map(),
          indexed = [];

        appAiState.variants = new Set();
        appAiState.handles = new Set();
        appAiState.urlPaths = new Set();
        appAiState.keys = new Set();
        appAiState.indexes = new Set();

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (lineIsAppAI(it)) {
            appAiState.variants.add(String(it.variant_id));
            appAiState.indexes.add(i + 1);
            if (it.key) appAiState.keys.add(String(it.key));
            if (it.handle) appAiState.handles.add(String(it.handle));
            var path = productPathFromHref(it.url || '');
            if (path) {
              appAiState.urlPaths.add(path);
              var h = handleFromPath(path);
              if (h) appAiState.handles.add(h);
            }
          }
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
              '.cart-item',
              "[class*='cart-item']",
              "[id*='CartItem']",
              'cart-items > *',
              'cart-drawer-items > *',
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
            var cs = [
              document.querySelector("form[action^='/cart']"),
              document.querySelector('cart-drawer'),
              document.querySelector('cart-items'),
              document.querySelector('cart-drawer-items'),
              document.querySelector('[id*="cart"]'),
            ];
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

        if (replaced > 0) document.documentElement.classList.remove('appai-cart-loading');

        if (window.AppAI && typeof window.AppAI.hideInternalCartProperties === 'function') {
          window.AppAI.hideInternalCartProperties();
        }

        if (appAiState.variants.size > 0) {
          disableProductLinksInTree(document.documentElement);
        } else {
          document.documentElement.classList.remove('appai-cart-loading');
        }
      })
      .catch(function () {
        document.documentElement.classList.remove('appai-cart-loading');
      });
  }

  var t = null;
  function schedule() {
    clearTimeout(t);
    t = setTimeout(applyMockups, 150);
  }
  window.aiArtFastReplace = applyMockups;
  window.__applyCartMockups = applyMockups;

  // Always install interceptor; also run apply on every page so drawers work after ATC.
  applyMockups();
  schedule();
  try {
    var ob = new MutationObserver(function () {
      schedule();
    });
    ob.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  window.addEventListener('appai:cart-updated', schedule);
  document.addEventListener('cart:updated', schedule);
  document.addEventListener('cart:refresh', schedule);
  document.addEventListener('shopify:section:load', schedule);
  window.addEventListener('pageshow', schedule);
  console.log('[AppAI Cart Image] installed ' + CART_IMG_VERSION);
})();
