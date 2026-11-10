;(function () {
  'use strict';
  // Bump VER on every ship so a stale cached copy cannot block the new installer.
  var CART_IMG_VERSION = '3.11';
  if (window.__APPAI_CART_IMG_REPLACER_VER__ === CART_IMG_VERSION) return;
  window.__APPAI_CART_IMG_REPLACER_VER__ = CART_IMG_VERSION;
  window.__APPAI_CART_IMG_REPLACER_V2__ = true;
  window.__APPAI_CART_IMG_REPLACER__ = true;

  var LOG = '[AppAI cart-images]';
  var hushMutations = false;
  /** Whole applyMockups pass — observer/schedule no-op so our childList writes cannot re-GET. */
  var isApplying = false;
  var pendingRerun = false;
  var cartDirty = true;
  var cartPromise = null;
  var lastCartJson = null;
  var lastCartFingerprint = null;
  var lastCartMediaGestureAt = 0;

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
    '[data-appai-demoted],[data-appai-demoted] *,' +
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

  function cartFingerprint(cart, headerUpdatedAt) {
    if (headerUpdatedAt) return 'hdr:' + headerUpdatedAt;
    if (!cart) return '';
    var items = cart.items || [];
    var parts = [String(cart.token || ''), String(cart.item_count || items.length)];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      parts.push(
        String(it.key || '') +
          ':' +
          String(it.quantity || 0) +
          ':' +
          String(it.variant_id || '') +
          ':' +
          (mockupUrlFromLineProperties(it.properties) || ''),
      );
    }
    return parts.join('|');
  }

  function readCartResponse(r) {
    if (!r.ok) throw new Error('cart.js ' + r.status);
    var headerUpdatedAt =
      r.headers.get('x-cartjs-updatedat') || r.headers.get('X-Cartjs-Updatedat') || '';
    return r.json().then(function (cart) {
      cartDirty = false;
      lastCartFingerprint = cartFingerprint(cart, headerUpdatedAt);
      lastCartJson = cart;
      return cart;
    });
  }

  function getCart(needFetch, fresh) {
    if (fresh) {
      return fetch('/cart.js', { credentials: 'same-origin', cache: 'no-store' }).then(readCartResponse);
    }
    if (cartPromise) return cartPromise;
    if (!needFetch && lastCartJson) return Promise.resolve(lastCartJson);
    cartPromise = fetch('/cart.js', { credentials: 'same-origin' })
      .then(readCartResponse)
      .finally(function () {
        cartPromise = null;
      });
    return cartPromise;
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

  function sameImageFile(img, url) {
    if (!img || !url) return false;
    return fileKey(img.getAttribute('src') || img.currentSrc || '') === fileKey(url) && !!fileKey(url);
  }

  function setImg(img, url) {
    if (!img || !url) return false;
    var wrote = false;
    if (!sameImageFile(img, url)) {
      img.src = url;
      wrote = true;
    }
    if (img.hasAttribute('srcset')) { img.removeAttribute('srcset'); wrote = true; }
    if (img.hasAttribute('data-src')) { img.removeAttribute('data-src'); wrote = true; }
    if (img.hasAttribute('data-srcset')) { img.removeAttribute('data-srcset'); wrote = true; }
    if (img.hasAttribute('data-lazy-src')) { img.removeAttribute('data-lazy-src'); wrote = true; }
    if (img.getAttribute('data-appai-mockup') !== 'true') {
      img.setAttribute('data-appai-mockup', 'true');
      wrote = true;
    }
    return wrote;
  }

  function shopifyCdnSrc(src) {
    var s = String(src || '');
    return s.indexOf('cdn.shopify.com') !== -1 || s.indexOf('/cdn/shop/') !== -1;
  }

  function cartSizedUrl(src) {
    var abs = String(src || '');
    if (abs.indexOf('//') === 0) abs = 'https:' + abs;
    if (abs.indexOf('/') === 0) abs = location.origin + abs;
    if (abs.indexOf('/cdn/shop/') !== -1) return abs;
    var file = abs.match(/\/files\/([^/?#]+\.(?:jpe?g|png|webp|gif))/i);
    if (!file) return abs;
    return location.origin + '/cdn/shop/files/' + file[1] + '?width=250';
  }

  function awaitingBag() {
    window.AppAI = window.AppAI || {};
    if (!window.AppAI.variantsAwaitingImage) window.AppAI.variantsAwaitingImage = {};
    return window.AppAI.variantsAwaitingImage;
  }

  function noteAwaiting(variantId, waiting) {
    var id = String(variantId || '').replace(/\D/g, '');
    if (!id) return;
    var bag = awaitingBag();
    if (waiting) {
      bag[id] = Date.now();
      armImageWatch(20000);
    } else delete bag[id];
  }

  function lineImgs(container) {
    return [].slice.call(deepQueryAll(container, 'img')).filter(function (img) {
      if (!elInCartUi(img)) return false;
      var w = Number(img.getAttribute('width') || img.naturalWidth || 0);
      var h = Number(img.getAttribute('height') || img.naturalHeight || 0);
      if ((w && w <= 40) || (h && h <= 40)) return false;
      return true;
    });
  }

  function mediaHost(container) {
    var hosts = deepQueryAll(
      container,
      '.cart-items__media, .cart-item__media, td.cart-items__media, .cart-items__media-container',
    );
    return hosts[0] || container;
  }

  function fileKey(url) {
    return String(url || '').split('?')[0].split('#')[0].split('/').pop().toLowerCase();
  }

  function catalogFiles() {
    var set = {};
    function add(url) {
      var key = fileKey(url);
      if (key) set[key] = true;
    }
    var stamped = [];
    try {
      stamped = document.querySelectorAll('[data-appai-my-pet-slide-original-src], [data-appai-my-pet-original-src]');
    } catch (e) {}
    for (var i = 0; i < stamped.length; i++) {
      add(stamped[i].getAttribute('data-appai-my-pet-slide-original-src'));
      add(stamped[i].getAttribute('data-appai-my-pet-original-src'));
    }
    var root = document.getElementById('appai-root');
    if (root) {
      try {
        var variants = JSON.parse(root.getAttribute('data-variants') || '[]');
        for (var v = 0; v < variants.length; v++) {
          var media = variants[v] && variants[v].featured_media;
          if (!media) continue;
          if (media.preview_image && media.preview_image.src) add(media.preview_image.src);
          if (media.src) add(media.src);
        }
      } catch (e2) {}
    }
    return set;
  }

  function rememberThumbLine(line) {
    try {
      window.__APPAI_CART_THUMB_LOGS__ = window.__APPAI_CART_THUMB_LOGS__ || [];
      window.__APPAI_CART_THUMB_LOGS__.push(line);
      if (window.__APPAI_CART_THUMB_LOGS__.length > 40) window.__APPAI_CART_THUMB_LOGS__.shift();
    } catch (e) {}
    try { console.log(line); } catch (e2) {}
  }

  function logPass(trigger, n) {
    rememberThumbLine('[My Pet] cart thumb pass trigger=' + (trigger || 'unknown') + ' lines=' + n);
  }

  function logAddPass(trigger, lines, replaced) {
    rememberThumbLine(
      '[My Pet] cart thumb pass trigger=' + trigger +
      ' lines=' + lines +
      ' replaced=' + replaced,
    );
  }

  function logMissingMockup(lineKey) {
    rememberThumbLine('[My Pet] cart thumb missing-mockup line=' + (lineKey || ''));
  }

  function isAddPass(trigger) {
    return trigger === 'add+500' || trigger === 'add+1500';
  }

  function logThumb(source, lineKey, reason) {
    rememberThumbLine(
      '[My Pet] cart thumb applied source=' + source +
      ' line=' + (lineKey || '') +
      ' reason=' + (reason || ''),
    );
  }

  function imgSrc(img) {
    return img ? (img.currentSrc || img.getAttribute('src') || '') : '';
  }

  function srcIsPlaceholder(src) {
    return !src || /no-image|placeholder|blank\.svg|\.svg(\?|$)/i.test(src);
  }

  // Horizon's cart row with no variant image is an empty td.cart-items__media.
  // Some builds put a placeholder <svg> there instead of an <img>.
  function mediaIsPlaceholder(cell, img) {
    if (img && srcIsPlaceholder(imgSrc(img))) return true;
    if (img) return false;
    if (!cell) return false;
    return deepQueryAll(cell, 'svg').length > 0;
  }

  function classifyThumb(img, cell, mockupUrl, catalog) {
    var placeholder = mediaIsPlaceholder(cell, img);
    if (!mockupUrl) {
      if (!img || placeholder) return { source: 'none', reason: placeholder ? 'placeholder' : 'img-missing' };
      return { source: 'none', reason: 'ok' };
    }
    if (!img || placeholder) {
      return { source: 'mockup_url', reason: placeholder ? 'placeholder' : 'img-missing' };
    }
    if (img.getAttribute('data-appai-mockup') === 'true') return { source: 'mockup_url', reason: 'ok' };
    var src = imgSrc(img);
    var key = fileKey(src);
    if (key && catalog && catalog[key]) return { source: 'mockup_url', reason: 'catalog' };
    if (shopifyCdnSrc(src) && img.getAttribute('data-appai-awaiting') !== '1') return { source: 'variant', reason: 'ok' };
    return { source: 'mockup_url', reason: 'img-missing' };
  }

  function clearPlaceholderGraphics(cell) {
    var svgs = deepQueryAll(cell, 'svg');
    for (var i = 0; i < svgs.length; i++) {
      if (svgs[i].parentNode) svgs[i].parentNode.removeChild(svgs[i]);
    }
  }

  // Horizon sizes the thumb from .cart-items__media-container { aspect-ratio: var(--ratio) }
  // and .cart-items__media-image { width:100%; object-fit:cover }.
  function ensureLineImage(cell, url) {
    var imgs = lineImgs(cell);
    var img = imgs[0] || null;
    if (img && srcIsPlaceholder(imgSrc(img))) img = null;
    if (!img) {
      clearPlaceholderGraphics(cell);
      var frame = null;
      try {
        frame = cell.querySelector('.cart-items__media-container, a.cart-items__media-container');
      } catch (e) {}
      if (!frame) {
        frame = document.createElement('span');
        frame.className = 'cart-items__media-container';
        frame.style.setProperty('--ratio', '1');
        frame.setAttribute('data-appai-media', '1');
        cell.appendChild(frame);
      }
      img = document.createElement('img');
      img.className = 'cart-items__media-image border-style';
      img.alt = '';
      img.setAttribute('width', '250');
      img.setAttribute('height', '250');
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.objectFit = 'cover';
      img.style.aspectRatio = 'inherit';
      frame.appendChild(img);
    }
    var wrote = setImg(img, url);
    if (img.getAttribute('data-appai-awaiting') !== '1') {
      img.setAttribute('data-appai-awaiting', '1');
      wrote = true;
    }
    img.__appaiWrote = wrote;
    return img;
  }

  // Missing image, placeholder, or the catalog photo becomes the line's _mockup_url.
  // A real shadow variant image is left alone (source=variant, reason=ok).
  function paintLine(container, url, variantId, catalog) {
    if (!container || container === document || container === document.documentElement || container === document.body) {
      return { source: 'none', reason: 'img-missing' };
    }
    var cell = mediaHost(container);
    var imgs = lineImgs(cell);
    var img = imgs[0] || null;
    var verdict = classifyThumb(img, cell, url, catalog);
    if (verdict.reason === 'ok') {
      if (verdict.source === 'variant') noteAwaiting(variantId, false);
      return verdict;
    }
    if (verdict.source !== 'mockup_url' || !url) return verdict;
    var hostClass = typeof cell.className === 'string' ? cell.className : '';
    if (cell === container && hostClass.indexOf('media') === -1 && !container.querySelector) {
      return { source: 'none', reason: verdict.reason };
    }
    var paintedImg = ensureLineImage(cell, url);
    if (paintedImg && variantId) {
      paintedImg.setAttribute('data-appai-variant', String(variantId).replace(/\D/g, ''));
    }
    noteAwaiting(variantId, true);
    verdict.wrote = !!(paintedImg && paintedImg.__appaiWrote);
    return verdict;
  }

  var imagePoll = null;
  var imagePollUntil = 0;
  function ensureImagePoll() {
    if (imagePoll) return;
    imagePoll = setInterval(pollVariantImages, 800);
  }
  // Stays up past the add+1500 pass. A variant image can publish after that.
  function armImageWatch(ms) {
    imagePollUntil = Math.max(imagePollUntil, Date.now() + (ms || 20000));
    ensureImagePoll();
  }

  function pollVariantImages() {
    var bag = awaitingBag();
    var ids = Object.keys(bag);
    if (!ids.length) {
      if (Date.now() < imagePollUntil) return;
      clearInterval(imagePoll);
      imagePoll = null;
      return;
    }
    for (var i = 0; i < ids.length; i++) {
      (function (id) {
        fetch('/variants/' + id + '.js', { credentials: 'same-origin' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (data) {
            if (!data || !awaitingBag()[id]) return;
            var featured = data.featured_image;
            var src = featured && typeof featured === 'object' ? featured.src : featured;
            if (!src) return;
            var sized = cartSizedUrl(src);
            var nodes = deepQueryAll(document.documentElement, 'img[data-appai-awaiting="1"]');
            for (var n = 0; n < nodes.length; n++) {
              if (nodes[n].getAttribute('data-appai-variant') !== id) continue;
              setImg(nodes[n], sized);
              nodes[n].removeAttribute('data-appai-awaiting');
            }
            noteAwaiting(id, false);
            try { console.info(LOG + ' variant image ready ' + id); } catch (_) {}
          })
          .catch(function () {});
      })(ids[i]);
    }
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

  function parentOrHost(node) {
    if (!node) return null;
    if (node.parentNode) return node.parentNode;
    // Cross open shadow roots (ShadowRoot.parentNode is null).
    if (node.host) return node.host;
    return null;
  }

  function closestAnchor(el) {
    var p = el;
    while (p) {
      if (p.tagName === 'A') return p;
      p = parentOrHost(p);
    }
    return null;
  }

  function elInCartUi(el) {
    var path = el;
    while (path) {
      if (!path.tagName) {
        path = parentOrHost(path);
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
      path = parentOrHost(path);
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
    el.style.setProperty('pointer-events', 'auto', 'important');
  }

  /** Turn <a> into <span> so the browser has nothing link-like left. */
  function demoteAnchor(a) {
    if (!a || !a.tagName || a.tagName !== 'A') return a;
    if (a.getAttribute('data-appai-demoted') === '1') return a;
    var href = a.getAttribute('href') || '';
    var span = document.createElement('span');
    span.className = a.className || '';
    span.setAttribute('data-appai-demoted', '1');
    if (href) span.setAttribute('data-appai-original-href', href);
    span.setAttribute('role', 'presentation');
    if (a.id) span.id = a.id;
    var style = a.getAttribute('style');
    if (style) span.setAttribute('style', style);
    forceInert(span);
    while (a.firstChild) span.appendChild(a.firstChild);
    var kids = span.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) forceInert(kids[i]);
    if (a.parentNode) a.parentNode.replaceChild(span, a);
    return span;
  }

  function isCartMediaZone(el) {
    if (!el || el.nodeType !== 1) return false;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (
      cls.indexOf('cart-items__media') !== -1 ||
      cls.indexOf('cart-item__media') !== -1 ||
      cls.indexOf('cart-items__media-image') !== -1 ||
      cls.indexOf('cart-item__image') !== -1
    ) {
      return elInCartUi(el);
    }
    if (el.getAttribute && el.getAttribute('data-appai-demoted') === '1') {
      return cls.indexOf('media') !== -1 && elInCartUi(el);
    }
    return false;
  }

  /** Primary kill path: demote wrapping <a> around cart thumbs. */
  function stripCartMediaHrefs() {
    if (hushMutations && !isApplying) return;
    hushMutations = true;
    var demoted = 0;
    try {
      ensureStyles();
      var imgs = deepQueryAll(
        document.documentElement,
        'img.cart-items__media-image, img.cart-item__image, .cart-items__media img, .cart-item__media img, td.cart-items__media img, a.cart-items__media-container img, [data-appai-demoted] img',
      );
      var seen = new Set();
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!elInCartUi(img)) continue;
        forceInert(img);
        var a = closestAnchor(img);
        if (a && !seen.has(a)) {
          seen.add(a);
          demoteAnchor(a);
          demoted++;
        }
      }
      var links = deepQueryAll(
        document.documentElement,
        'a.cart-items__media-container, .cart-items__media a, .cart-item__media a, td.cart-items__media a',
      );
      for (var L = 0; L < links.length; L++) {
        if (seen.has(links[L])) continue;
        demoteAnchor(links[L]);
        demoted++;
      }
      if (demoted) {
        try {
          console.info(LOG + ' demoted media anchors=' + demoted);
        } catch (_) {}
      }
    } finally {
      if (!isApplying) hushMutations = false;
    }
  }

  function lockCustomizerRows() {
    if (!customizerState.keys.size && !customizerState.handles.size) return;
    if (hushMutations && !isApplying) return;
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
            'a[href*="/products/"], a.cart-items__title, a.cart-items__media-container',
          );
          for (var r = 0; r < rowLinks.length; r++) demoteAnchor(rowLinks[r]);
        }
      });

      var cartLinks = deepQueryAll(
        document.documentElement,
        'a.cart-items__title[href*="/products/"], a.cart-items__media-container[href*="/products/"], .cart-items a[href*="/products/"], form[action*="/cart"] a[href*="/products/"]',
      );
      for (var c = 0; c < cartLinks.length; c++) {
        var a = cartLinks[c];
        var href = a.getAttribute('href') || '';
        if (!(hrefIsCustomizerProduct(href) || isCartMediaAnchor(a))) continue;
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
        demoteAnchor(a);
      }
    } finally {
      if (!isApplying) hushMutations = false;
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

  function pathHasCartMediaZone(path) {
    for (var i = 0; i < path.length; i++) {
      if (isCartMediaZone(path[i])) return true;
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

    // Any interaction inside the cart thumbnail cell — never navigate.
    if (pathHasCartMediaZone(path)) {
      lastCartMediaGestureAt = Date.now();
      for (var m = 0; m < path.length; m++) {
        if (path[m] && path[m].tagName === 'A') demoteAnchor(path[m]);
      }
      blockNavEvent(e);
      return;
    }

    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || el.tagName !== 'A') continue;
      if (isCartMediaAnchor(el)) {
        demoteAnchor(el);
        blockNavEvent(e);
        return;
      }
      var href = el.getAttribute('href') || el.getAttribute('data-appai-original-href') || '';
      if (pathHasLockedRow(path) && String(href).indexOf('/products/') !== -1) {
        demoteAnchor(el);
        blockNavEvent(e);
        return;
      }
      if (hrefIsCustomizerProduct(href)) {
        demoteAnchor(el);
        blockNavEvent(e);
        return;
      }
    }
  }

  ['click', 'auxclick', 'pointerdown', 'mousedown', 'mouseup'].forEach(function (type) {
    window.addEventListener(type, onCartProductNavIntercept, true);
    document.addEventListener(type, onCartProductNavIntercept, true);
  });

  // Client-side navigations (View Transitions / Navigation API).
  try {
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', function (e) {
        try {
          var dest = e.destination && e.destination.url ? String(e.destination.url) : '';
          if (!dest || dest.indexOf('/products/') === -1) return;
          var path = '';
          try {
            path = new URL(dest, location.origin).pathname || '';
          } catch (_) {
            path = dest;
          }
          var recentMedia = Date.now() - lastCartMediaGestureAt < 800;
          if (
            recentMedia ||
            hrefIsCustomizerProduct(path) ||
            hrefIsCustomizerProduct(dest)
          ) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

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

  function finishApply(ok, wrote) {
    try {
      if (ok && wrote) {
        if (window.AppAI && typeof window.AppAI.hideInternalCartProperties === 'function') {
          window.AppAI.hideInternalCartProperties();
        }
        stripCartMediaHrefs();
        lockCustomizerRows();
      }
    } finally {
      isApplying = false;
      hushMutations = false;
      resumeObservers();
      document.documentElement.classList.remove('appai-cart-loading');
      if (pendingRerun) {
        pendingRerun = false;
        var rerunFresh = pendingFresh;
        var rerunTrigger = pendingTrigger;
        pendingFresh = false;
        if (rerunFresh) {
          setTimeout(function () { applyMockups(rerunTrigger); }, 0);
        } else {
          schedule({ cartChanged: cartDirty, trigger: rerunTrigger });
        }
      }
    }
  }

  function thumbFingerprint() {
    var nodes = deepQueryAll(document.documentElement, '[data-key], [id^="CartItem-"]');
    var parts = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || !elInCartUi(el)) continue;
      var key = (el.getAttribute && el.getAttribute('data-key')) || el.id || '';
      if (!key || seen[key]) continue;
      seen[key] = true;
      var img = lineImgs(el)[0];
      parts.push(key + '=' + fileKey(imgSrc(img)));
    }
    parts.sort();
    return parts.join('|');
  }

  function rowForKey(key) {
    if (!key) return null;
    var want = String(key);
    var nodes = deepQueryAll(document.documentElement, '[data-key], [id^="CartItem-"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || !el.getAttribute) continue;
      if (el.getAttribute('data-key') === want) return el;
      if ((el.id || '') === 'CartItem-' + want) return el;
    }
    var inps = deepQueryAll(document.documentElement, "input[name^='updates[']");
    for (var u = 0; u < inps.length; u++) {
      var m = /^updates\[(.+)\]$/.exec(inps[u].getAttribute('name') || '');
      if (!m || m[1] !== want) continue;
      return (
        inps[u].closest('[data-key]') ||
        inps[u].closest("[id*='CartItem']") ||
        inps[u].closest('tr') ||
        inps[u].closest('li') ||
        inps[u].closest('.cart-item') ||
        null
      );
    }
    return null;
  }

  var lastThumbFp = '';
  var lastPassSig = '';
  var pendingFresh = false;
  function passSignature(cart) {
    var items = (cart && cart.items) || [];
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var row = rowForKey(it.key);
      var img = row ? lineImgs(mediaHost(row))[0] : null;
      parts.push(
        String(it.key || '') +
        '=' + fileKey(imgSrc(img)) +
        '|' + (mockupUrlFromLineProperties(it.properties) || ''),
      );
    }
    parts.sort();
    return parts.join('||');
  }
  function applyMockups(trigger) {
    var addPass = isAddPass(trigger);
    if (isApplying) {
      pendingRerun = true;
      pendingFresh = pendingFresh || addPass;
      if (trigger) pendingTrigger = trigger;
      return;
    }
    // Idle mutations compare the DOM only. An add pass never takes this skip:
    // the new line is often absent from the pre-add DOM and from cached /cart.js.
    if (!addPass) {
      var fp = thumbFingerprint();
      if (fp && fp === lastThumbFp && trigger !== 'load') return;
      if (trigger === 'mutation') cartDirty = true;
    }
    isApplying = true;
    hushMutations = true;
    pauseObservers();
    var needFetch = addPass || cartDirty || !lastCartJson;
    try { ensureStyles(); } catch (_) {}
    getCart(needFetch, addPass)
      .then(function (cart) {
        var sig = passSignature(cart);
        if (!addPass && sig && sig === lastPassSig && trigger !== 'load') {
          lastThumbFp = thumbFingerprint();
          finishApply(true, false);
          return;
        }
        var items = cart.items || [];
        var catalog = catalogFiles();
        var replaced = 0;

        customizerState.keys = new Set();
        customizerState.handles = new Set();
        customizerState.urlPaths = new Set();
        customizerState.variants = new Set();

        try {
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!lineIsCustomizer(it)) continue;
            rememberCustomizerItem(it);
            var url = mockupUrlFromLineProperties(it && it.properties);
            var row = rowForKey(it.key);
            var img = row ? lineImgs(mediaHost(row))[0] : null;
            var variantImage = !!(img && !srcIsPlaceholder(imgSrc(img)) && shopifyCdnSrc(imgSrc(img)));
            if (!url && !variantImage) {
              logMissingMockup(it.key);
              continue;
            }
            if (!row) {
              if (addPass) logThumb('none', it.key, 'img-missing');
              continue;
            }
            var painted = paintLine(row, url, String(it.variant_id || ''), catalog);
            if (painted && painted.wrote) {
              replaced++;
              logThumb(painted.source, it.key, painted.reason);
            }
          }
        } catch (_) {}
        if (addPass) logAddPass(trigger, items.length, replaced);
        else if (replaced) logPass(trigger || 'load', replaced);
        lastPassSig = passSignature(cart);
        lastThumbFp = thumbFingerprint();
        finishApply(true, replaced > 0);
      })
      .catch(function () {
        if (addPass) logAddPass(trigger, 0, 0);
        finishApply(false, false);
      });
  }

  function lineImageCache() {
    try {
      var raw = sessionStorage.getItem('appai:lineImages');
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  // First paint, before the 250ms cart.js pass. Only a URL stored for this line key.
  function paintCached(root) {
    if (!root || root.nodeType !== 1) return;
    var images = lineImageCache();
    var inputs;
    try {
      inputs = deepQueryAll(root, "input[name^='updates[']");
    } catch (_) {
      return;
    }
    for (var i = 0; i < inputs.length; i++) {
      var m = /^updates\[(.+)\]$/.exec(inputs[i].getAttribute('name') || '');
      if (!m || !images[m[1]] || String(images[m[1]]).indexOf('https://') !== 0) continue;
      var c =
        inputs[i].closest('[data-cart-item]') ||
        inputs[i].closest("[id*='CartItem']") ||
        inputs[i].closest('tr') ||
        inputs[i].closest('li') ||
        inputs[i].closest('.cart-item') ||
        inputs[i].closest("[class*='cart']") ||
        inputs[i].closest('form') ||
        document;
      var cachedSource = paintLine(c, images[m[1]], '', catalogFiles());
      if (cachedSource && cachedSource.reason && cachedSource.reason !== 'ok') {
        logThumb(cachedSource.source, m[1], cachedSource.reason);
      }
    }
  }

  window.AppAI = window.AppAI || {};
  window.AppAI.paintCartFromCache = function () {
    paintCached(document.documentElement);
  };

  var t = null;
  var pendingTrigger = 'load';
  function schedule(opts) {
    if (opts && opts.trigger) pendingTrigger = opts.trigger;
    var delay = pendingTrigger === 'mutation' ? 150 : 250;
    if (isApplying || hushMutations) {
      if (opts && opts.cartChanged) cartDirty = true;
      pendingRerun = true;
      return;
    }
    if (opts && opts.cartChanged) cartDirty = true;
    if (opts && opts.immediate) delay = 0;
    clearTimeout(t);
    t = setTimeout(function () {
      applyMockups(pendingTrigger || 'mutation');
    }, delay);
  }

  function requestCartRefresh(trigger) {
    paintCached(document.documentElement);
    schedule({ cartChanged: true, trigger: typeof trigger === 'string' ? trigger : 'cart' });
  }

  // Horizon re-renders the drawer inside an open shadow root. A document-level
  // observer never sees that. Watch the drawer and its shadow root directly.
  var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
  var observerRecords = [];
  function pauseObservers() {
    for (var i = 0; i < observerRecords.length; i++) {
      try { observerRecords[i].ob.disconnect(); } catch (e) {}
    }
  }
  function resumeObservers() {
    for (var i = 0; i < observerRecords.length; i++) {
      var rec = observerRecords[i];
      try { rec.ob.observe(rec.node, { childList: true, subtree: true }); } catch (e) {}
    }
  }
  function watchRoot(root, trigger) {
    if (!root || typeof root.nodeType !== 'number') return;
    if (watched) {
      if (watched.has(root)) return;
      watched.add(root);
    }
    try {
      var ob = new MutationObserver(function () {
        if (isApplying || hushMutations) return;
        schedule({ trigger: trigger });
      });
      observerRecords.push({ ob: ob, node: root });
      ob.observe(root, { childList: true, subtree: true });
    } catch (_) {}
    if (root.shadowRoot) watchRoot(root.shadowRoot, trigger);
  }

  function watchDrawers() {
    var nodes = cartUiRoots();
    for (var i = 0; i < nodes.length; i++) {
      watchRoot(nodes[i], 'mutation');
      if (cartEvents) {
        bindCartEvents(nodes[i]);
        if (nodes[i].shadowRoot) bindCartEvents(nodes[i].shadowRoot);
      }
    }
  }

  function onCartEvent(name) {
    return function () {
      watchDrawers();
      requestCartRefresh(name);
    };
  }

  window.aiArtFastReplace = function () { requestCartRefresh('fast'); };
  window.__applyCartMockups = function () { requestCartRefresh('apply'); };

  applyMockups('load');
  watchDrawers();
  function mutationTouchesCart(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var target = mutations[i].target;
      var el = target && target.nodeType === 1 ? target : target && target.parentElement;
      if (el && elInCartUi(el)) return true;
      var added = mutations[i].addedNodes;
      for (var n = 0; n < added.length; n++) {
        if (added[n].nodeType === 1 && elInCartUi(added[n])) return true;
      }
    }
    return false;
  }

  try {
    var ob = new MutationObserver(function (mutations) {
      watchDrawers();
      if (isApplying || hushMutations) return;
      if (!mutationTouchesCart(mutations)) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var n = 0; n < added.length; n++) {
          if (added[n].nodeType === 1) paintCached(added[n]);
        }
      }
      schedule({ trigger: 'mutation' });
    });
    observerRecords.push({ ob: ob, node: document.documentElement });
    ob.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  // Horizon cart-drawer-component listens for StandardEvents.cartLinesUpdate,
  // theme-drawer:open, and cart-section:restored. Names vary by theme build,
  // so the drawer observer above is the fallback when none of these fire.
  var cartEvents = [
    'cart:update',
    'cart:updated',
    'cart:refresh',
    'cart:lines-update',
    'cart:lines:update',
    'cart-section:restored',
    'theme-drawer:open',
    'drawer:open',
  ];
  var boundEvents = typeof WeakSet === 'function' ? new WeakSet() : null;
  function bindCartEvents(target) {
    if (!target || !target.addEventListener) return;
    if (boundEvents) {
      if (boundEvents.has(target)) return;
      boundEvents.add(target);
    }
    for (var b = 0; b < cartEvents.length; b++) {
      target.addEventListener(cartEvents[b], onCartEvent(cartEvents[b]));
    }
  }
  for (var ev = 0; ev < cartEvents.length; ev++) {
    document.addEventListener(cartEvents[ev], onCartEvent(cartEvents[ev]));
    window.addEventListener(cartEvents[ev], onCartEvent(cartEvents[ev]));
  }
  var drawerNodes = cartUiRoots();
  for (var d = 0; d < drawerNodes.length; d++) {
    bindCartEvents(drawerNodes[d]);
    if (drawerNodes[d].shadowRoot) bindCartEvents(drawerNodes[d].shadowRoot);
  }
  document.addEventListener('shopify:section:load', function (e) {
    var id = '';
    try { id = String((e && e.detail && (e.detail.sectionId || e.detail.section_id)) || ''); } catch (_) {}
    watchDrawers();
    requestCartRefresh(id.indexOf('cart') !== -1 ? 'section:' + id : 'shopify:section:load');
  });
  window.addEventListener('pageshow', function () { requestCartRefresh('pageshow'); });
  window.addEventListener('appai:cart-updated', function () { requestCartRefresh('appai:cart-updated'); });
  var addPassArmed = 0;
  function passAfterCustomAdd() {
    var now = Date.now();
    if (now - addPassArmed < 2000) return;
    addPassArmed = now;
    armImageWatch(20000);
    setTimeout(function () { applyMockups('add+500'); }, 500);
    setTimeout(function () { applyMockups('add+1500'); }, 1500);
  }
  window.__appaiCartThumbAfterAdd = passAfterCustomAdd;
  window.addEventListener('appai:my-pet-added', passAfterCustomAdd);
  console.log('[My Pet] cart thumb install');
  console.log(LOG + ' installed ' + CART_IMG_VERSION + ' (cache paint before the cart fetch)');
})();
