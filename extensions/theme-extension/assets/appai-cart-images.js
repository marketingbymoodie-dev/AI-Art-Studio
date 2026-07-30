;(function () {
  'use strict';
  // Bump VER on every ship so a stale cached copy cannot block the new installer.
  var CART_IMG_VERSION = '2.6';
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
    armed: false,
  };

  /** handle -> is appai-shadow product (from /products/{handle}.js). */
  var shadowHandleCache = new Map();

  function ensureStyles() {
    if (document.getElementById('appai-cart-noflash-style')) return;
    var s = document.createElement('style');
    s.id = 'appai-cart-noflash-style';
    s.textContent =
      '.appai-cart-loading .cart-item img:not([data-appai-mockup]),' +
      '.appai-cart-loading [id*="CartItem"] img:not([data-appai-mockup]),' +
      '.appai-cart-loading cart-items img:not([data-appai-mockup]),' +
      '.appai-cart-loading form[action^="/cart"] img:not([data-appai-mockup]) { opacity:0 !important; }' +
      '.cart-item img,[id*="CartItem"] img,cart-items img,form[action^="/cart"] img{transition:opacity 120ms ease;}' +
      /* Kill pointer + clicks on disabled PDP links (UA styles a[href] as pointer). */ +
      'a[data-appai-link-disabled="1"],' +
      'a[data-appai-link-disabled="1"] *,' +
      '.appai-cart-line-locked a[href*="/products/"],' +
      '.appai-cart-line-locked a[href*="/products/"] *,' +
      'html.appai-block-cart-pdp cart-drawer-component a[href*="/products/"],' +
      'html.appai-block-cart-pdp cart-items-component a[href*="/products/"],' +
      'html.appai-block-cart-pdp cart-drawer a[href*="/products/"],' +
      'html.appai-block-cart-pdp .cart-drawer a[href*="/products/"],' +
      'html.appai-block-cart-pdp .cart-items a[href*="/products/"],' +
      'html.appai-block-cart-pdp [class*="cart-items"] a[href*="/products/"],' +
      'html.appai-block-cart-pdp form[action*="/cart"] a[href*="/products/"]{' +
      'cursor:default!important;pointer-events:none!important;text-decoration:none!important;' +
      '}';
    document.head.appendChild(s);
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

  function seedFromRecentMockup() {
    try {
      var recent = window.__aiArtRecentMockup;
      if (recent && recent.variantId) {
        appAiState.variants.add(String(recent.variantId));
        appAiState.armed = true;
      }
      if (window.AppAI && window.AppAI.latest && window.AppAI.latest._mockup_url) {
        appAiState.armed = true;
      }
    } catch (_) {}
  }
  seedFromRecentMockup();

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

  function lineIsAppAI(it) {
    if (!it) return false;
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
        n === 'artwork' ||
        n.toLowerCase().indexOf('appai') !== -1 ||
        n.toLowerCase().indexOf('design') !== -1 ||
        n.toLowerCase().indexOf('mockup') !== -1
      ) {
        return true;
      }
    }
    if (it.variant_id && appAiState.variants.has(String(it.variant_id))) return true;
    if (it.handle && shadowHandleCache.get(String(it.handle)) === true) return true;
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

  function elLooksLikeCartUi(el) {
    if (!el || !el.tagName) return false;
    var tag = String(el.tagName).toLowerCase();
    var id = String(el.id || '').toLowerCase();
    var cls =
      typeof el.className === 'string'
        ? el.className.toLowerCase()
        : String(el.className && el.className.baseVal ? el.className.baseVal : '').toLowerCase();
    // Horizon: cart-drawer-component, cart-items-component, dialog.cart-drawer
    if (tag.indexOf('cart') !== -1) return true;
    if (id.indexOf('cart') !== -1) return true;
    if (cls.indexOf('cart-drawer') !== -1 || cls.indexOf('cart-item') !== -1) return true;
    if (cls.indexOf('cart-page') !== -1 || cls.indexOf('mini-cart') !== -1) return true;
    if (cls.indexOf('ajax-cart') !== -1) return true;
    if (cls.indexOf('cart-items') !== -1) return true;
    if (el.getAttribute) {
      var action = el.getAttribute('action') || '';
      if (action.indexOf('/cart') !== -1) return true;
      if (el.hasAttribute('data-drawer') && (tag.indexOf('cart') !== -1 || cls.indexOf('cart') !== -1)) {
        return true;
      }
    }
    return false;
  }

  function pathHasCartUi(path) {
    if (window.location.pathname.indexOf('/cart') !== -1) return true;
    for (var i = 0; i < path.length; i++) {
      if (elLooksLikeCartUi(path[i])) return true;
    }
    return false;
  }

  function markAppAiItem(it) {
    if (!it) return;
    appAiState.armed = true;
    if (it.variant_id != null) appAiState.variants.add(String(it.variant_id));
    if (it.key) appAiState.keys.add(String(it.key));
    if (it.handle) appAiState.handles.add(String(it.handle));
    var path = productPathFromHref(it.url || '');
    if (path) {
      appAiState.urlPaths.add(path);
      var h = handleFromPath(path);
      if (h) appAiState.handles.add(h);
    }
  }

  function hrefMatchesAppAi(href) {
    if (!href || !appAiState.armed) return false;
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
      if (el && el.classList && el.classList.contains('appai-cart-line-locked')) return true;
    }
    return false;
  }

  function eventPath(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path || !path.length) {
      var t = e.target;
      path = [];
      while (t) {
        path.push(t);
        t = t.parentNode;
      }
    }
    return path;
  }

  function findProductAnchorFromEvent(e) {
    var path = eventPath(e);
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || el.tagName !== 'A') continue;
      var href = el.getAttribute('href') || el.href || el.getAttribute('data-appai-original-href') || '';
      if (String(href).indexOf('/products/') !== -1) {
        return { a: el, href: href, path: path };
      }
    }
    return null;
  }

  function pathLooksLikeProductChrome(path) {
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el) continue;
      if (el.tagName === 'IMG' && el.getAttribute && el.getAttribute('data-appai-mockup') === 'true') {
        return true;
      }
      var cls =
        typeof el.className === 'string'
          ? el.className.toLowerCase()
          : String(el.className && el.className.baseVal ? el.className.baseVal : '').toLowerCase();
      if (
        cls.indexOf('cart-items__media') !== -1 ||
        cls.indexOf('cart-items__title') !== -1 ||
        cls.indexOf('cart-items__details') !== -1 ||
        cls.indexOf('cart-item__image') !== -1 ||
        cls.indexOf('cart-item__name') !== -1 ||
        cls.indexOf('cart-item__media') !== -1
      ) {
        return true;
      }
    }
    return false;
  }

  function shouldBlockProductNav(e) {
    if (!appAiState.armed && appAiState.variants.size === 0) return false;
    var path = eventPath(e);
    if (!pathHasCartUi(path)) return false;

    var hit = findProductAnchorFromEvent(e);
    if (hit) {
      // AppAI armed inside cart UI → no PDP from image/title links.
      if (hrefMatchesAppAi(hit.href) || pathHasAppAiMockup(path) || appAiState.armed) return true;
      return false;
    }

    // Non-<a> navigation (rare): only block media/title chrome on locked lines —
    // never quantity / remove / checkout controls.
    if (pathHasAppAiMockup(path) && pathLooksLikeProductChrome(path)) return true;
    return false;
  }

  function onNavIntercept(e) {
    if (!shouldBlockProductNav(e)) return;
    blockNavEvent(e);
  }

  // Capture on window + document so theme capture handlers cannot win by registration order.
  ['click', 'auxclick', 'pointerdown', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, onNavIntercept, true);
    document.addEventListener(type, onNavIntercept, true);
  });
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      onNavIntercept(e);
    },
    true,
  );

  function neutralizeAnchor(a) {
    if (!a) return;
    var href = a.getAttribute('href') || a.href || '';
    if (href && href.indexOf('/products/') !== -1 && !a.getAttribute('data-appai-original-href')) {
      a.setAttribute('data-appai-original-href', href);
    }
    a.setAttribute('data-appai-link-disabled', '1');
    a.removeAttribute('href');
    a.setAttribute('role', 'presentation');
    a.setAttribute('aria-disabled', 'true');
    a.style.cursor = 'default';
    a.style.pointerEvents = 'none';
    a.addEventListener('click', blockNavEvent, true);
    a.addEventListener('auxclick', blockNavEvent, true);
    a.addEventListener('pointerdown', blockNavEvent, true);
  }

  function lockCartLineEl(el) {
    if (!el || !el.classList) return;
    el.classList.add('appai-cart-line-locked');
  }

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
      '.cart-items',
      '[class*="cart-items"]',
      'form[action*="/cart"]',
      '[id*="CartDrawer"]',
      '[id*="cart-drawer"]',
      '[id*="CartItem"]',
    ];
    for (var i = 0; i < sels.length; i++) {
      var nodes = deepQueryAll(document.documentElement, sels[i]);
      for (var n = 0; n < nodes.length; n++) {
        if (roots.indexOf(nodes[n]) === -1) roots.push(nodes[n]);
      }
    }
    return roots;
  }

  function disableProductLinksInTree(root) {
    if (!root) return 0;
    var count = 0;
    var links = deepQueryAll(root, 'a[href*="/products/"], a[data-appai-original-href*="/products/"]');
    for (var i = 0; i < links.length; i++) {
      // Inside cart UI, with AppAI armed: neutralize every product link.
      neutralizeAnchor(links[i]);
      count++;
      var row =
        (links[i].closest &&
          (links[i].closest('.cart-items__table-row') ||
            links[i].closest('[class*="cart-item"]') ||
            links[i].closest('[data-cart-item]') ||
            links[i].closest('tr') ||
            links[i].closest('li'))) ||
        null;
      if (row) lockCartLineEl(row);
    }
    var mockImgs = deepQueryAll(root, 'img[data-appai-mockup]');
    for (var m = 0; m < mockImgs.length; m++) {
      var img = mockImgs[m];
      var wrap = img.closest ? img.closest('a') : null;
      if (wrap) {
        neutralizeAnchor(wrap);
        count++;
      }
      var row2 =
        (img.closest &&
          (img.closest('.cart-items__table-row') ||
            img.closest('[data-cart-item]') ||
            img.closest('[id*="CartItem"]') ||
            img.closest('.cart-item') ||
            img.closest('tr') ||
            img.closest('li') ||
            img.closest('[class*="cart-item"]'))) ||
        img.parentElement;
      if (row2) {
        lockCartLineEl(row2);
        var rowLinks = deepQueryAll(row2, 'a');
        for (var r = 0; r < rowLinks.length; r++) {
          var rh = rowLinks[r].getAttribute('href') || rowLinks[r].getAttribute('data-appai-original-href') || '';
          if (String(rh).indexOf('/products/') !== -1 || rowLinks[r].getAttribute('data-appai-link-disabled') === '1') {
            neutralizeAnchor(rowLinks[r]);
            count++;
          }
        }
      }
    }
    return count;
  }

  function setBlockClass(on) {
    ensureStyles();
    if (on) document.documentElement.classList.add('appai-block-cart-pdp');
    else document.documentElement.classList.remove('appai-block-cart-pdp');
  }

  function tagsIncludeAppAiShadow(tags) {
    if (!tags) return false;
    if (Array.isArray(tags)) {
      for (var i = 0; i < tags.length; i++) {
        if (String(tags[i]).trim().toLowerCase() === 'appai-shadow') return true;
      }
      return false;
    }
    return String(tags)
      .toLowerCase()
      .split(/\s*,\s*/)
      .indexOf('appai-shadow') !== -1;
  }

  function enrichShadowHandles(items) {
    var jobs = [];
    for (var i = 0; i < items.length; i++) {
      (function (it) {
        if (!it || !it.handle) return;
        if (lineIsAppAI(it)) {
          markAppAiItem(it);
          return;
        }
        var handle = String(it.handle);
        if (shadowHandleCache.has(handle)) {
          if (shadowHandleCache.get(handle)) markAppAiItem(it);
          return;
        }
        jobs.push(
          fetch('/products/' + encodeURIComponent(handle) + '.js', { credentials: 'same-origin' })
            .then(function (r) {
              return r.ok ? r.json() : null;
            })
            .then(function (p) {
              var isShadow = !!(p && tagsIncludeAppAiShadow(p.tags));
              shadowHandleCache.set(handle, isShadow);
              if (isShadow) markAppAiItem(it);
            })
            .catch(function () {
              shadowHandleCache.set(handle, false);
            }),
        );
      })(items[i]);
    }
    return Promise.all(jobs);
  }

  function applyLinkBlock() {
    if (!appAiState.armed && appAiState.variants.size === 0) {
      setBlockClass(false);
      return;
    }
    setBlockClass(true);
    var roots = cartUiRoots();
    var total = 0;
    // Never fall back to documentElement — that would disable PDP links on the storefront.
    for (var i = 0; i < roots.length; i++) total += disableProductLinksInTree(roots[i]);
    console.log(
      '[AppAI Cart Image] link-block',
      CART_IMG_VERSION,
      'variants=',
      appAiState.variants.size,
      'handles=',
      appAiState.handles.size,
      'neutralized=',
      total,
    );
  }

  function applyMockups() {
    seedFromRecentMockup();
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
        appAiState.armed = false;
        seedFromRecentMockup();

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (lineIsAppAI(it)) {
            markAppAiItem(it);
            appAiState.indexes.add(i + 1);
          }
          var url = mockupUrlFromLineProperties(it && it.properties);
          if (!url) continue;
          markAppAiItem(it);
          keyMap.set(it.key, url);
          varMap.set(String(it.variant_id), url);
          indexed.push({
            index: i + 1,
            variantId: String(it.variant_id),
            mockupUrl: url,
            key: it.key,
          });
        }

        return enrichShadowHandles(items).then(function () {
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
                lockCartLineEl(
                  imgs[0].closest('.cart-items__table-row') ||
                    imgs[0].closest('[class*="cart-item"]') ||
                    imgs[0].parentElement,
                );
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
                    lockCartLineEl(node);
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
                  lockCartLineEl(
                    fi.closest('.cart-items__table-row') ||
                      fi.closest('[class*="cart-item"]') ||
                      fi.parentElement,
                  );
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

          if (appAiState.armed || appAiState.variants.size > 0) {
            applyLinkBlock();
          } else {
            setBlockClass(false);
            document.documentElement.classList.remove('appai-cart-loading');
          }
        });
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

  applyMockups();
  schedule();
  try {
    var ob = new MutationObserver(function () {
      if (appAiState.armed || appAiState.variants.size > 0) {
        // Theme re-renders cart HTML with fresh hrefs — re-strip immediately.
        applyLinkBlock();
      }
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
  console.log('[AppAI Cart Image] installed ' + CART_IMG_VERSION);
})();
