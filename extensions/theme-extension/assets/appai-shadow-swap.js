/* AppAI shadow swap.
   Primary: Shopify.actions.updateCart changes the line's variant in place.
   The next cart image is decoded before that call when a thumbnail is on
   screen. Decode starts when the shadow variant id is known (mint complete),
   not when the swap runs. If decode rejects or misses a 500ms budget, an
   open drawer does not swap — the drawer-closed pass does.
   Fallback: /cart/add.js then /cart/change.js quantity 0, only when updateCart
   is not a function. That fallback logs every time it fires.
   No-op unless session atcMode is base-first and a pending swap was recorded.
   No timer loop.
*/
;(function () {
  "use strict";
  var VER = "1.1";
  if (window.__APPAI_SHADOW_SWAP_VER__ === VER) return;
  window.__APPAI_SHADOW_SWAP_VER__ = VER;

  var LOG = "[AppAI swap]";
  var MODE_KEY = "appai:atcMode";
  var PENDING_KEY = "appai:pendingSwaps";
  var IMAGES_KEY = "appai:lineImages";
  var NS = (window.AppAI = window.AppAI || {});
  var running = false;
  var queued = false;
  var suppressNote = false;
  var DECODE_BUDGET_MS = 500;
  var warmByVariant = {};

  function readMap(key) {
    try {
      var raw = sessionStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeMap(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function mode() {
    try { return sessionStorage.getItem(MODE_KEY) || "shadow-direct"; } catch (_) { return "shadow-direct"; }
  }

  function shopDomain() {
    var root = document.getElementById("appai-root");
    var fromRoot = root && root.getAttribute("data-shop");
    if (fromRoot) return String(fromRoot).trim();
    return (window.Shopify && window.Shopify.shop) || "";
  }

  function onCartPage() {
    var path = String(location.pathname || "").replace(/\/+$/, "");
    return /\/cart$/.test(path);
  }

  function surfaceShowingLine() {
    if (drawerOpen()) return "drawer";
    if (onCartPage()) return "cart";
    return "";
  }

  function absUrl(src) {
    if (!src) return "";
    if (src.indexOf("//") === 0) return "https:" + src;
    if (src.indexOf("/") === 0) return location.origin + src;
    return src;
  }

  function themeImageWidth() {
    var nodes = document.querySelectorAll(
      "#cart-drawer img, cart-drawer img, .cart-item img, form[action='/cart'] img, form[action^='/cart'] img"
    );
    for (var i = 0; i < nodes.length; i++) {
      var src = nodes[i].currentSrc || nodes[i].getAttribute("src") || "";
      var match = String(src).match(/[?&]width=(\d+)/);
      if (match) return match[1];
    }
    return "250";
  }

  // Drawer and cart markup request the shop CDN file at the theme's width.
  // /variants/{id}.js returns the unsized cdn.shopify.com file. Those are
  // different cache entries, so decode the URL the <img> will actually use.
  function cartDisplayUrl(src) {
    var abs = absUrl(src);
    if (!abs) return "";
    if (/[?&]width=/.test(abs) && abs.indexOf("/cdn/shop/") !== -1 && abs.indexOf("/s/files/") === -1) return abs;
    var fileMatch = abs.match(/\/files\/([^/?#]+\.(?:jpe?g|png|webp|gif))/i);
    if (!fileMatch) return abs;
    var query = abs.split("?")[1] || "";
    var versionMatch = query.match(/(?:^|&)v=([^&]+)/);
    var params = [];
    if (versionMatch) params.push("v=" + versionMatch[1]);
    params.push("width=" + themeImageWidth());
    return location.origin + "/cdn/shop/files/" + fileMatch[1] + "?" + params.join("&");
  }

  function decodeUrl(url) {
    var img = new Image();
    img.src = url;
    if (typeof img.decode === "function") return img.decode();
    return new Promise(function (resolve, reject) {
      img.onload = function () { resolve(); };
      img.onerror = function () { reject(new Error("image failed")); };
    });
  }

  function warmVariant(variantId) {
    var id = String(variantId || "").replace(/\D/g, "");
    if (!id) return Promise.reject(new Error("no variant"));
    if (warmByVariant[id]) return warmByVariant[id];
    var pending = fetch("/variants/" + id + ".js", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("variant image " + res.status);
        return res.json();
      })
      .then(function (data) {
        var featured = data && data.featured_image;
        var src = featured && typeof featured === "object" ? featured.src : featured;
        var sized = cartDisplayUrl(src);
        var raw = absUrl(typeof src === "string" ? src : "");
        if (!sized && !raw) throw new Error("variant has no image");
        // Checkout asks cdn.shopify.com for the unsized file. The drawer and
        // /cart ask the shop CDN for width=250. Decode both. The swap gate
        // waits on the sized one, which is the thumbnail those surfaces paint.
        if (raw && raw !== sized) {
          decodeUrl(raw).catch(function (err) {
            console.error(LOG, "checkout image decode failed", err && err.message);
          });
        }
        return decodeUrl(sized || raw);
      })
      .catch(function (err) {
        delete warmByVariant[id];
        console.error(LOG, "image decode failed for variant", id, err && err.message);
        throw err;
      });
    warmByVariant[id] = pending;
    return pending;
  }

  function decodedInBudget(variantId) {
    var warm = warmVariant(variantId);
    return new Promise(function (resolve) {
      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        resolve(ok);
      }
      warm.then(function () { finish(true); }, function () { finish(false); });
      setTimeout(function () { finish(false); }, DECODE_BUDGET_MS);
    });
  }

  function updateCartFn() {
    var actions = window.Shopify && window.Shopify.actions;
    return actions && typeof actions.updateCart === "function" ? actions.updateCart : null;
  }

  function drawerOpen() {
    var nodes = document.querySelectorAll(
      "cart-drawer, cart-drawer-component, .cart-drawer, [id*='cart-drawer'], [id*='CartDrawer']"
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hasAttribute("open")) return true;
      var aria = el.getAttribute("aria-hidden");
      if (aria === "false") return true;
      var cls = String(el.className || "");
      if (/\b(is-open|active|open)\b/.test(cls)) return true;
    }
    return false;
  }

  function lineForKey(cart, swapKey, lineKey) {
    var items = (cart && cart.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (lineKey && items[i].key === lineKey) return items[i];
    }
    for (var j = 0; j < items.length; j++) {
      var props = items[j].properties || {};
      if (props._appai_swap_key === swapKey || props._shadow_design_id === swapKey) return items[j];
    }
    return null;
  }

  function rekey(beforeKey, afterItem) {
    var images = readMap(IMAGES_KEY);
    var pending = readMap(PENDING_KEY);
    var url = afterItem && afterItem.properties && afterItem.properties._mockup_url;
    if (beforeKey && beforeKey !== afterItem.key) {
      delete images[beforeKey];
      delete pending[beforeKey];
    }
    if (afterItem && afterItem.key && url) images[afterItem.key] = url;
    if (afterItem && afterItem.key) delete pending[afterItem.key];
    writeMap(IMAGES_KEY, images);
    writeMap(PENDING_KEY, pending);
  }

  function noteCartAdded(productId) {
    var shop = shopDomain();
    if (!shop || !productId) return;
    var appUrl = "";
    try { appUrl = String(sessionStorage.getItem("appai:appUrl") || "").replace(/\/$/, ""); } catch (_) {}
    if (!appUrl) return;
    fetch(appUrl + "/api/storefront/shadow-product/cart-added", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: shop, shadowProductId: String(productId) }),
    }).catch(function () {});
  }

  function addAndZero(item, variantId) {
    console.error(LOG, "FALLBACK add-and-zero fired. Shopify.actions.updateCart is not a function. The cart has a two-request gap: two lines if the add lands first, or a missing line if the removal lands first.");
    var props = item.properties || {};
    suppressNote = true;
    return fetch("/cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: item.quantity || 1, properties: props }] }),
    }).then(function (res) {
      if (!res.ok) throw new Error("add-and-zero add failed " + res.status);
      return fetch("/cart/change.js", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: item.key, quantity: 0 }),
      });
    }).then(function (res) {
      if (!res.ok) throw new Error("add-and-zero remove failed " + res.status);
      console.error(LOG, "FALLBACK add-and-zero finished for line", item.key);
    }).then(function () { suppressNote = false; }, function (err) { suppressNote = false; throw err; });
  }

  function swapLine(item, variantId) {
    var update = updateCartFn();
    if (!update) {
      if (drawerOpen()) {
        console.error(LOG, "FALLBACK add-and-zero deferred: cart drawer is open and updateCart is missing.");
        return Promise.resolve(false);
      }
      return addAndZero(item, variantId).then(function () { return true; });
    }
    var surface = surfaceShowingLine();
    var gate = surface ? decodedInBudget(variantId) : Promise.resolve(true);
    return gate.then(function (decoded) {
      if (!decoded && surface === "drawer") {
        console.error(LOG, "decode missed the " + DECODE_BUDGET_MS + "ms budget — swap deferred until the drawer closes");
        return false;
      }
      if (!decoded && surface === "cart") {
        console.error(LOG, "decode missed the " + DECODE_BUDGET_MS + "ms budget — not swapping while the cart page is showing the line");
        warmVariant(variantId).then(function () { NS.requestShadowSwap(); }, function () {});
        return false;
      }
      return fetch("/cart.js", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          return update({
            cartId: "gid://shopify/Cart/" + cart.token,
            lines: [{
              id: item.key,
              quantity: item.quantity || 1,
              merchandiseId: "gid://shopify/ProductVariant/" + String(variantId).replace(/\D/g, ""),
            }],
          });
        });
    })
      .then(function (result) {
        if (result === false) return false;
        var errors = (result && result.userErrors) || [];
        if (errors.length) {
          console.error(LOG, "updateCart rejected", errors.map(function (e) { return e.message; }).join("; "));
          return false;
        }
        return true;
      });
  }

  function rememberLine(swapKey) {
    if (!swapKey || mode() !== "base-first") return;
    fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var item = lineForKey(cart, swapKey, null);
        if (!item || !item.key) return;
        var pending = readMap(PENDING_KEY);
        pending[item.key] = swapKey;
        writeMap(PENDING_KEY, pending);
        var images = readMap(IMAGES_KEY);
        if (item.properties && item.properties._mockup_url) images[item.key] = item.properties._mockup_url;
        writeMap(IMAGES_KEY, images);
        NS.requestShadowSwap();
      })
      .catch(function (e) { console.error(LOG, "could not record pending swap", e && e.message); });
  }

  NS.noteBaseFirstAdd = rememberLine;

  function run() {
    if (mode() !== "base-first") return;
    var pending = readMap(PENDING_KEY);
    var lineKeys = Object.keys(pending);
    if (!lineKeys.length) return;
    if (running) { queued = true; return; }
    running = true;
    var swapKeys = [];
    lineKeys.forEach(function (lineKey) {
      if (swapKeys.indexOf(pending[lineKey]) === -1) swapKeys.push(pending[lineKey]);
    });
    fetch("/apps/appai/shadow-ready?keys=" + encodeURIComponent(swapKeys.join(",")), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body && body.atcMode) {
          try { sessionStorage.setItem(MODE_KEY, body.atcMode); } catch (_) {}
        }
        if (mode() !== "base-first") return;
        var readyByKey = {};
        (body.results || []).forEach(function (row) {
          if (row && row.ready && row.shopifyVariantId) {
            readyByKey[row.key] = row.shopifyVariantId;
            warmVariant(row.shopifyVariantId);
          }
        });
        return fetch("/cart.js", { credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (cart) {
            var chain = Promise.resolve();
            lineKeys.forEach(function (lineKey) {
              var swapKey = pending[lineKey];
              var variantId = readyByKey[swapKey];
              if (!variantId) return;
              chain = chain.then(function () {
                return fetch("/cart.js", { credentials: "same-origin" }).then(function (r) { return r.json(); });
              }).then(function (live) {
                var item = lineForKey(live, swapKey, lineKey);
                if (!item) {
                  var dropped = readMap(PENDING_KEY);
                  delete dropped[lineKey];
                  writeMap(PENDING_KEY, dropped);
                  return;
                }
                if (String(item.variant_id) === String(variantId)) {
                  rekey(lineKey, item);
                  noteCartAdded(item.product_id);
                  return;
                }
                var beforeKey = item.key;
                return swapLine(item, variantId).then(function (ok) {
                  if (!ok) return;
                  return fetch("/cart.js", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (after) {
                    var neu = lineForKey(after, swapKey, null);
                    if (!neu || String(neu.variant_id) !== String(variantId)) {
                      console.error(LOG, "swap did not land on the shadow variant");
                      return;
                    }
                    rekey(beforeKey, neu);
                    noteCartAdded(neu.product_id);
                    console.log(LOG, "swapped", beforeKey === neu.key ? "key-stable" : "rekeyed");
                  });
                });
              });
            });
            return chain;
          });
      })
      .catch(function (e) { console.error(LOG, "swap pass failed", e && e.message); })
      .then(function () {
        running = false;
        if (queued) { queued = false; run(); }
      });
  }

  NS.requestShadowSwap = run;

  if (typeof window.fetch === "function" && !window.__APPAI_SHADOW_SWAP_FETCH__) {
    window.__APPAI_SHADOW_SWAP_FETCH__ = true;
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var swapKey = null;
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("/cart/add.js") !== -1 && init && typeof init.body === "string") {
          var parsed = JSON.parse(init.body);
          var first = parsed && parsed.items && parsed.items[0];
          var props = (first && first.properties) || (parsed && parsed.properties) || null;
          if (props && props._appai_swap_key) swapKey = String(props._appai_swap_key);
        }
      } catch (_) {}
      var pending = origFetch(input, init);
      if (swapKey && !suppressNote) {
        pending.then(function (res) {
          if (res && res.ok) rememberLine(swapKey);
        }).catch(function () {});
      }
      return pending;
    };
  }

  window.addEventListener("message", function (e) {
    var data = e && e.data;
    if (!data || data.type !== "ai-art-studio:shadow-ready") return;
    if (data.variantId) warmVariant(data.variantId);
    run();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") run();
  });
  window.addEventListener("pageshow", function () { run(); });

  var lastDrawerOpen = drawerOpen();
  try {
    var obs = new MutationObserver(function () {
      var open = drawerOpen();
      if (lastDrawerOpen && !open) run();
      lastDrawerOpen = open;
    });
    obs.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["open", "class", "aria-hidden"] });
  } catch (_) {}
})();
