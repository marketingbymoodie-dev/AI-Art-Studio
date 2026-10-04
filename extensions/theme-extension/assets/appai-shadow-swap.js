/* AppAI shadow swap.
   Primary: Shopify.actions.updateCart changes the line's variant in place.
   The next cart image is decoded before that call when a thumbnail is on
   screen. Decode starts when the shadow variant id is known (mint complete),
   not when the swap runs. If decode rejects or misses the budget, an open
   drawer does not swap — the drawer-closed pass does.
   Checkout click while a swap is still pending waits up to 5s, then continues.
   Fallback: /cart/add.js then /cart/change.js quantity 0, only when updateCart
   is not a function. That fallback logs every time it fires.
   No-op unless session atcMode is base-first and a pending swap was recorded.
   No timer loop.
*/
;(function () {
  "use strict";
  var VER = "1.4";
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
  // Fresh-mint first decode measured ~791ms. The drawer is already painted
  // from _mockup_url. Past this, leave the swap until the drawer closes.
  // Checkout is a separate 5s hold: the shadow image is what checkout uses.
  var DECODE_BUDGET_MS = 2000;
  var SWAP_HOLD_MAX_MS = 5000;
  var SWAP_HOLD_POLL_MS = 500;
  var CHECKOUT_SELECTOR =
    'button[name="checkout"], [name="checkout"], #checkout, a[href="/checkout"], a[href^="/checkout"], button[formaction*="/checkout"]';
  NS.CHECKOUT_SELECTOR = NS.CHECKOUT_SELECTOR || CHECKOUT_SELECTOR;
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
    if (key === PENDING_KEY) syncPendingChrome();
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

  var holding = false;
  var releasing = false;
  var holdBanner = null;

  var expressHiddenAt = 0;

  function beaconExpress(result, waited) {
    console.log("[AppAI express-hide] " + result + " waited=" + waited + "ms");
    try {
      if (!navigator.sendBeacon) return;
      var body = JSON.stringify({ event: "express-hide", waitedMs: waited, result: result });
      navigator.sendBeacon("/apps/appai/atc-telemetry", new Blob([body], { type: "application/json" }));
    } catch (_) {}
  }

  function syncPendingChrome() {
    var pending = mode() === "base-first" && Object.keys(readMap(PENDING_KEY)).length > 0;
    var was = document.documentElement.classList.contains("appai-swap-pending");
    document.documentElement.classList.toggle("appai-swap-pending", pending);
    if (pending && !was) {
      expressHiddenAt = Date.now();
      beaconExpress("start", 0);
    } else if (!pending && was) {
      beaconExpress("end", expressHiddenAt ? Date.now() - expressHiddenAt : 0);
      expressHiddenAt = 0;
    }
  }

  window.addEventListener("pagehide", function () {
    if (!expressHiddenAt) return;
    beaconExpress("unload", Date.now() - expressHiddenAt);
    expressHiddenAt = 0;
  });

  (function injectHoldStyle() {
    var style = document.createElement("style");
    style.setAttribute("data-appai-swap-hold", "1");
    style.textContent =
      "html.appai-swap-pending .shopify-payment-button," +
      "html.appai-swap-pending .additional-checkout-buttons," +
      "html.appai-swap-pending [data-shopify-buttoncontainer]," +
      "html.appai-swap-pending shopify-accelerated-checkout," +
      "html.appai-swap-pending shopify-accelerated-checkout-cart" +
      "{display:none!important;}";
    (document.head || document.documentElement).appendChild(style);
  })();
  syncPendingChrome();

  function isCheckoutLike(el) {
    if (!el || !el.closest) return false;
    if (el.closest(CHECKOUT_SELECTOR)) return true;
    var submit = el.closest(
      'form[action="/cart"] button[type="submit"], form[action^="/cart"] button[type="submit"], ' +
        'form[action="/cart"] input[type="submit"], form[action^="/cart"] input[type="submit"]'
    );
    if (!submit) return false;
    var text = (submit.textContent || submit.value || "").toLowerCase();
    return text.indexOf("check") !== -1;
  }

  function showHoldBanner(on) {
    if (!on) {
      if (holdBanner && holdBanner.parentNode) holdBanner.parentNode.removeChild(holdBanner);
      holdBanner = null;
      return;
    }
    if (holdBanner) return;
    holdBanner = document.createElement("div");
    holdBanner.id = "appai-swap-hold-banner";
    holdBanner.setAttribute("role", "status");
    holdBanner.style.cssText =
      "position:sticky;top:0;z-index:9998;background:#111;color:#fff;padding:10px 16px;" +
      "text-align:center;font-size:14px;font-family:inherit;";
    holdBanner.textContent = "Finalising your design…";
    document.body.insertBefore(holdBanner, document.body.firstChild);
  }

  function beaconHold(waited, result) {
    var body = JSON.stringify({ waitedMs: waited, result: result });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/apps/appai/atc-telemetry", new Blob([body], { type: "application/json" }));
      }
    } catch (_) {}
  }

  function continueCheckout(control) {
    releasing = true;
    if (control && control.tagName === "A") {
      var href = control.getAttribute("href") || "/checkout";
      if (!href || href === "#") href = "/checkout";
      location.assign(href);
      return;
    }
    if (control && typeof control.click === "function") control.click();
    else location.assign("/checkout");
    setTimeout(function () { releasing = false; }, 0);
  }

  function holdThenContinue(control) {
    if (holding || releasing) return;
    if (document.documentElement.classList.contains("appai-print-pending")) return;
    if (mode() !== "base-first") return;
    if (!Object.keys(readMap(PENDING_KEY)).length) return;
    holding = true;
    var started = Date.now();
    showHoldBanner(true);
    function finish(result) {
      if (!holding) return;
      holding = false;
      var waited = Date.now() - started;
      console.log("[AppAI swap-hold] fired waited=" + waited + "ms result=" + result);
      beaconHold(waited, result);
      showHoldBanner(false);
      syncPendingChrome();
      continueCheckout(control);
    }
    function tick() {
      if (!holding) return;
      if (!Object.keys(readMap(PENDING_KEY)).length) return finish("swapped");
      if (Date.now() - started >= SWAP_HOLD_MAX_MS) return finish("fallthrough");
      run();
      setTimeout(tick, SWAP_HOLD_POLL_MS);
    }
    tick();
  }

  document.addEventListener("click", function (e) {
    if (holding || releasing) return;
    var control = e.target && e.target.closest ? e.target.closest(CHECKOUT_SELECTOR) : null;
    if (!control && e.target) {
      var submit = e.target.closest && e.target.closest("button, input");
      if (submit && isCheckoutLike(submit)) control = submit;
    }
    if (!control || !isCheckoutLike(control)) return;
    if (document.documentElement.classList.contains("appai-print-pending")) return;
    if (mode() !== "base-first" || !Object.keys(readMap(PENDING_KEY)).length) return;
    e.preventDefault();
    e.stopPropagation();
    holdThenContinue(control);
  }, true);

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
      var mockupUrl = "";
      try {
        var url2 = typeof input === "string" ? input : (input && input.url) || "";
        if (url2.indexOf("/cart/add.js") !== -1 && init && typeof init.body === "string") {
          var parsedBody = JSON.parse(init.body);
          var firstItem = parsedBody && parsedBody.items && parsedBody.items[0];
          var addProps = (firstItem && firstItem.properties) || (parsedBody && parsedBody.properties) || null;
          if (addProps && addProps._mockup_url && String(addProps._mockup_url).indexOf("https://") === 0) {
            mockupUrl = String(addProps._mockup_url);
          }
        }
      } catch (_) {}
      var pending = origFetch(input, init);
      if (mockupUrl) {
        pending.then(function (res) {
          if (!res || !res.ok || !res.clone) return;
          res.clone().json().then(function (body) {
            var items = body && body.items ? body.items : (body && body.key ? [body] : []);
            var images = readMap(IMAGES_KEY);
            for (var i = 0; i < items.length; i++) {
              if (items[i] && items[i].key) images[items[i].key] = mockupUrl;
            }
            writeMap(IMAGES_KEY, images);
            if (NS.paintCartFromCache) NS.paintCartFromCache();
          }).catch(function () {});
        }).catch(function () {});
      }
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
