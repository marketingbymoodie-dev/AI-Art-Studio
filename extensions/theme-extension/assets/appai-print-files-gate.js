/* AppAI print-files checkout gate.
   Disables checkout while any AppAI AOP line is still finalising print files
   (`_print_files_pending` without `_aop_pl`). Stamps `_aop_pl` via /cart/change.js
   when the iframe finishes background persist, or by polling the snapshot API.
   Do not fold this into appai-cart-images.js (3.3 is locked).
*/
;(function () {
  "use strict";
  var VER = "1.0";
  if (window.__APPAI_PRINT_FILES_GATE_VER__ === VER) return;
  window.__APPAI_PRINT_FILES_GATE_VER__ = VER;

  var LOG = "[AppAI print-files-gate]";
  var JOBS_KEY = "appai:aopFinalizeJobs";
  var PENDING_PROP = "_print_files_pending";
  var SNAP_PROP = "_aop_pl";
  var JOB_PROP = "_appai_job_id";
  var bannerEl = null;
  var pollTimer = null;

  function shopDomain() {
    var root = document.getElementById("appai-root");
    var fromRoot = root && root.getAttribute("data-shop");
    if (fromRoot) return fromRoot;
    try {
      var raw = sessionStorage.getItem(JOBS_KEY);
      var map = raw ? JSON.parse(raw) : {};
      for (var k in map) {
        if (map[k] && map[k].shop) return map[k].shop;
      }
    } catch (_) {}
    return "";
  }

  function readPendingJobs() {
    try {
      var raw = sessionStorage.getItem(JOBS_KEY);
      var map = raw ? JSON.parse(raw) : {};
      return map && typeof map === "object" ? map : {};
    } catch (_) {
      return {};
    }
  }

  function writePendingJobs(map) {
    try {
      sessionStorage.setItem(JOBS_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function forgetJob(jobId) {
    var map = readPendingJobs();
    delete map[jobId];
    writePendingJobs(map);
  }

  function rememberJob(jobId, shop) {
    if (!jobId) return;
    var map = readPendingJobs();
    map[jobId] = { shop: shop || shopDomain(), at: Date.now() };
    writePendingJobs(map);
  }

  function lineIsPending(item) {
    var props = (item && item.properties) || {};
    var pending = String(props[PENDING_PROP] || "").trim();
    var snap = String(props[SNAP_PROP] || "").trim();
    return !!pending && !snap;
  }

  function findCheckoutControls() {
    var nodes = [];
    var seen = new Set();
    function add(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      nodes.push(el);
    }
    var list = document.querySelectorAll(
      'button[name="checkout"], [name="checkout"], #checkout, a[href="/checkout"], a[href^="/checkout"], button[formaction*="/checkout"]',
    );
    for (var i = 0; i < list.length; i++) add(list[i]);
    var forms = document.querySelectorAll('form[action="/cart"], form[action^="/cart"]');
    for (var f = 0; f < forms.length; f++) {
      var submits = forms[f].querySelectorAll('button[type="submit"], input[type="submit"]');
      for (var s = 0; s < submits.length; s++) {
        var t = (submits[s].textContent || submits[s].value || "").toLowerCase();
        if (t.indexOf("check") !== -1) add(submits[s]);
      }
    }
    return nodes;
  }

  function setCheckoutBlocked(blocked) {
    var controls = findCheckoutControls();
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      if (blocked) {
        if (el.tagName === "A") {
          if (!el.getAttribute("data-appai-href")) {
            el.setAttribute("data-appai-href", el.getAttribute("href") || "/checkout");
          }
          el.setAttribute("href", "#");
          el.setAttribute("aria-disabled", "true");
        } else {
          el.disabled = true;
        }
        el.setAttribute("data-appai-print-gate", "1");
        el.style.opacity = "0.5";
        el.style.pointerEvents = "none";
      } else if (el.getAttribute("data-appai-print-gate") === "1") {
        el.removeAttribute("data-appai-print-gate");
        if (el.tagName === "A") {
          var href = el.getAttribute("data-appai-href") || "/checkout";
          el.setAttribute("href", href);
          el.removeAttribute("aria-disabled");
          el.removeAttribute("data-appai-href");
        } else {
          el.disabled = false;
        }
        el.style.opacity = "";
        el.style.pointerEvents = "";
      }
    }
    ensureBanner(blocked);
  }

  function ensureBanner(show) {
    if (!show) {
      if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
      return;
    }
    if (bannerEl) return;
    bannerEl = document.createElement("div");
    bannerEl.id = "appai-print-files-banner";
    bannerEl.setAttribute("role", "status");
    bannerEl.style.cssText =
      "position:sticky;top:0;z-index:9999;background:#111;color:#fff;padding:10px 16px;" +
      "text-align:center;font-size:14px;font-family:inherit;";
    bannerEl.textContent = "Finalising print files… Checkout unlocks when they are ready.";
    document.body.insertBefore(bannerEl, document.body.firstChild);
  }

  function stampLine(jobId, snapshot) {
    if (!jobId || !snapshot) return Promise.resolve(false);
    return fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cart) {
        if (!cart || !cart.items) return false;
        var item = null;
        for (var i = 0; i < cart.items.length; i++) {
          var props = cart.items[i].properties || {};
          if (String(props[JOB_PROP] || "") === String(jobId)) {
            item = cart.items[i];
            break;
          }
        }
        if (!item) return false;
        var next = {};
        var old = item.properties || {};
        for (var k in old) {
          if (!Object.prototype.hasOwnProperty.call(old, k)) continue;
          if (k === PENDING_PROP) continue;
          next[k] = old[k];
        }
        next[SNAP_PROP] = snapshot;
        return fetch("/cart/change.js", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id: item.key, quantity: item.quantity, properties: next }),
        }).then(function (res) {
          return res.ok;
        });
      })
      .catch(function (e) {
        console.warn(LOG, "stamp failed", e && e.message);
        return false;
      });
  }

  function pollSnapshot(jobId, shop) {
    var body = JSON.stringify({ shop: shop || shopDomain(), jobId: jobId });
    return fetch("/apps/appai/api/storefront/aop-line-snapshot", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body,
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var snap = data && typeof data.snapshot === "string" ? data.snapshot.trim() : "";
        return snap || null;
      })
      .catch(function () {
        return null;
      });
  }

  function refreshGateFromCart() {
    return fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cart) {
        var pendingJobs = readPendingJobs();
        var cartPending = false;
        if (cart && cart.items) {
          for (var i = 0; i < cart.items.length; i++) {
            if (lineIsPending(cart.items[i])) {
              cartPending = true;
              var jid = String((cart.items[i].properties || {})[JOB_PROP] || "");
              if (jid) rememberJob(jid, shopDomain());
            }
          }
        }
        var sessionPending = Object.keys(pendingJobs).length > 0;
        setCheckoutBlocked(cartPending || sessionPending);
        return { cart: cart, cartPending: cartPending, pendingJobs: pendingJobs };
      })
      .catch(function () {
        var sessionPending = Object.keys(readPendingJobs()).length > 0;
        setCheckoutBlocked(sessionPending);
        return null;
      });
  }

  function tickRecover() {
    refreshGateFromCart().then(function (state) {
      if (!state) return;
      var jobs = state.pendingJobs || {};
      var ids = Object.keys(jobs);
      if (ids.length === 0) return;
      ids.forEach(function (jobId) {
        var shop = (jobs[jobId] && jobs[jobId].shop) || shopDomain();
        pollSnapshot(jobId, shop).then(function (snap) {
          if (!snap) return;
          stampLine(jobId, snap).then(function (ok) {
            if (ok) {
              forgetJob(jobId);
              refreshGateFromCart();
            }
          });
        });
      });
    });
  }

  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "AI_ART_STUDIO_PRINT_FILES_PENDING" && d.jobId) {
      rememberJob(d.jobId, d.shop);
      setCheckoutBlocked(true);
      return;
    }
    if (d.type === "AI_ART_STUDIO_PRINT_FILES_READY" && d.jobId) {
      forgetJob(d.jobId);
      refreshGateFromCart();
      return;
    }
    if (d.type === "AI_ART_STUDIO_PRINT_FILES_FAILED" && d.jobId) {
      refreshGateFromCart();
      return;
    }
    if (d.type === "AI_ART_STUDIO_STAMP_AOP_PL" && d.jobId && d.snapshot) {
      stampLine(d.jobId, d.snapshot).then(function (ok) {
        if (ok) forgetJob(d.jobId);
        refreshGateFromCart();
      });
    }
  });

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest('[data-appai-print-gate="1"]');
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  var path = window.location.pathname || "";
  var onCart = path === "/cart" || path.indexOf("/cart/") === 0;
  refreshGateFromCart();
  if (onCart) {
    tickRecover();
    pollTimer = setInterval(tickRecover, 2500);
  }

  console.log(LOG, "v" + VER + " installed");
})();
