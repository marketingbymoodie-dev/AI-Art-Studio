/* AppAI print-files checkout gate.
   Disables checkout while any AppAI AOP line is still finalising print files
   (`_print_files_pending` without `_aop_pl`). Stamps `_aop_pl` via /cart/change.js
   when the iframe finishes background persist, or by polling the snapshot API.
   Do not fold this into appai-cart-images.js (3.3 is locked).
*/
;(function () {
  "use strict";
  var VER = "1.3";
  if (window.__APPAI_PRINT_FILES_GATE_VER__ === VER) return;
  window.__APPAI_PRINT_FILES_GATE_VER__ = VER;

  var LOG = "[AppAI print-files-gate]";
  var JOBS_KEY = "appai:aopFinalizeJobs";
  var PENDING_PROP = "_print_files_pending";
  var SNAP_PROP = "_aop_pl";
  var CAP_PROP = "_aop_cap";
  var JOB_PROP = "_appai_job_id";
  var PENDING_HTML_CLASS = "appai-print-pending";
  // Same selector set findCheckoutControls() scans for — shared so the CSS
  // default-disable rule and the click-time guard can never drift from it.
  var CHECKOUT_SELECTOR =
    'button[name="checkout"], [name="checkout"], #checkout, a[href="/checkout"], a[href^="/checkout"], button[formaction*="/checkout"]';
  var bannerEl = null;
  var pollTimer = null;
  // Set synchronously inside setCheckoutBlocked — read at click time so a
  // freshly-rendered control that the scan hasn't reached yet (e.g. a cart
  // drawer opened between poll ticks) is still blocked. This does not
  // depend on any per-element scan/tag having run.
  var isBlocked = false;

  /** Same two-tier match findCheckoutControls() uses: known selectors, plus
   *  a /cart-form submit button whose text/value contains "check". */
  function isCheckoutLikeControl(el) {
    if (!el || !el.closest) return false;
    if (el.closest(CHECKOUT_SELECTOR)) return true;
    var submit = el.closest(
      'form[action="/cart"] button[type="submit"], form[action^="/cart"] button[type="submit"], ' +
        'form[action="/cart"] input[type="submit"], form[action^="/cart"] input[type="submit"]',
    );
    if (!submit) return false;
    var text = (submit.textContent || submit.value || "").toLowerCase();
    return text.indexOf("check") !== -1;
  }

  // Pure-CSS default-disable: the browser applies this the instant a
  // matching element enters the DOM, regardless of when — no JS scan, no
  // MutationObserver, no dependency on a drawer-open event this app doesn't
  // control across merchant themes. This is the visual cue; isBlocked +
  // the click-time guard below is what actually stops a click landing on
  // unstamped print files if the CSS never applies for any reason.
  (function injectPendingStyle() {
    var style = document.createElement("style");
    style.setAttribute("data-appai-print-gate-style", "1");
    style.textContent =
      "html." + PENDING_HTML_CLASS + " " + CHECKOUT_SELECTOR.split(", ").join(
        ", html." + PENDING_HTML_CLASS + " ",
      ) + " { pointer-events: none !important; opacity: .5 !important; cursor: not-allowed !important; }";
    (document.head || document.documentElement).appendChild(style);
  })();

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

  function rememberJob(jobId, shop, captureHash) {
    if (!jobId) return;
    var map = readPendingJobs();
    var prev = map[jobId] || {};
    var nextHash = String(captureHash || prev.captureHash || "").trim();
    map[jobId] = {
      shop: shop || prev.shop || shopDomain(),
      at: Date.now(),
      captureHash: nextHash || undefined,
    };
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
    var list = document.querySelectorAll(CHECKOUT_SELECTOR);
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
    isBlocked = !!blocked;
    document.documentElement.classList.toggle(PENDING_HTML_CLASS, isBlocked);
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

  function pollSnapshot(jobId, shop, expectedCaptureHash) {
    var body = JSON.stringify({
      shop: shop || shopDomain(),
      jobId: jobId,
      expectedCaptureHash: expectedCaptureHash || "",
    });
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
        var cartPending = false;
        var tracked = readPendingJobs();
        var items = (cart && cart.items) || [];
        // A tracked job can be stamped `_aop_pl` by something other than this
        // page's own stamp/poll flow (e.g. server-side at add-to-cart, or a
        // sibling page's postMessage handler that ran before this page's JS
        // realm existed — sessionStorage survives the navigation, the "job
        // resolved" notification does not). Reconcile against the live cart
        // on every refresh (not just once at init) so a job resolved
        // elsewhere is forgotten here too, instead of relying solely on this
        // page's own poll to notice — which can 409 forever against a live
        // capture signature that has since moved on, and never calls
        // forgetJob on failure.
        if (Object.keys(tracked).length > 0) {
          for (var i = 0; i < items.length; i++) {
            var jid = String((items[i].properties || {})[JOB_PROP] || "");
            if (jid && tracked[jid] && !lineIsPending(items[i])) {
              forgetJob(jid);
              delete tracked[jid];
            }
          }
        }
        for (var j = 0; j < items.length; j++) {
          if (lineIsPending(items[j])) {
            cartPending = true;
            var pendingJid = String((items[j].properties || {})[JOB_PROP] || "");
            if (pendingJid) {
              rememberJob(
                pendingJid,
                shopDomain(),
                String((items[j].properties || {})[CAP_PROP] || ""),
              );
              tracked[pendingJid] = readPendingJobs()[pendingJid];
            }
          }
        }
        var sessionPending = Object.keys(tracked).length > 0;
        setCheckoutBlocked(cartPending || sessionPending);
        return { cart: cart, cartPending: cartPending, pendingJobs: tracked };
      })
      .catch(function () {
        var sessionPending = Object.keys(readPendingJobs()).length > 0;
        setCheckoutBlocked(sessionPending);
        return null;
      });
  }

  // Polling used to be gated to the dedicated /cart page (`onCart`), so a
  // line that finished (or was reconciled as already-finished) while the
  // customer was anywhere else — e.g. the homepage with the cart open as a
  // drawer overlay — never got re-checked: no iframe there to postMessage,
  // no /cart-path poll, just the one refreshGateFromCart() call at script
  // load. Self-schedule instead: keep polling on ANY page for exactly as
  // long as something is actually pending, theme/drawer-implementation
  // agnostic (no assumption about a specific cart-drawer open/render event).
  function maybeManagePolling(state) {
    var stillPending = !!(
      state &&
      (state.cartPending || Object.keys(state.pendingJobs || {}).length > 0)
    );
    if (stillPending) {
      if (!pollTimer) pollTimer = setInterval(tickRecover, 2500);
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function tickRecover() {
    refreshGateFromCart().then(function (state) {
      maybeManagePolling(state);
      if (!state) return;
      var jobs = state.pendingJobs || {};
      var ids = Object.keys(jobs);
      if (ids.length === 0) return;
      ids.forEach(function (jobId) {
        var shop = (jobs[jobId] && jobs[jobId].shop) || shopDomain();
        var cap = "";
        if (state.cart && state.cart.items) {
          for (var i = 0; i < state.cart.items.length; i++) {
            var props = state.cart.items[i].properties || {};
            if (String(props[JOB_PROP] || "") === String(jobId)) {
              cap = String(props[CAP_PROP] || "").trim();
              break;
            }
          }
        }
        if (!cap && jobs[jobId] && jobs[jobId].captureHash) {
          cap = String(jobs[jobId].captureHash || "").trim();
        }
        pollSnapshot(jobId, shop, cap).then(function (snap) {
          if (!snap) return;
          stampLine(jobId, snap).then(function (ok) {
            if (ok) {
              forgetJob(jobId);
              refreshGateFromCart().then(maybeManagePolling);
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
      rememberJob(d.jobId, d.shop, d.captureHash);
      setCheckoutBlocked(true);
      if (!pollTimer) pollTimer = setInterval(tickRecover, 2500);
      return;
    }
    if (d.type === "AI_ART_STUDIO_PRINT_FILES_READY" && d.jobId) {
      forgetJob(d.jobId);
      tickRecover();
      return;
    }
    if (d.type === "AI_ART_STUDIO_PRINT_FILES_FAILED" && d.jobId) {
      tickRecover();
      return;
    }
    if (d.type === "AI_ART_STUDIO_STAMP_AOP_PL" && d.jobId && d.snapshot) {
      stampLine(d.jobId, d.snapshot).then(function (ok) {
        if (ok) forgetJob(d.jobId);
        tickRecover();
      });
    }
  });

  // Capture phase, ahead of the theme's own checkout handler. Checks the
  // live isBlocked flag against the click target on every click — not a
  // per-element tag from the last scan — so a checkout control that
  // rendered after the last scan (e.g. a cart drawer opened between poll
  // ticks) is still stopped. Works for mouse and keyboard activation alike
  // (Enter/Space on a focused control still dispatches a "click").
  document.addEventListener(
    "click",
    function (e) {
      if (!isBlocked) return;
      var t = e.target;
      if (!isCheckoutLikeControl(t)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // Not gated to /cart — the drawer-on-any-page case needs the same recheck.
  // tickRecover both attempts an immediate poll/stamp for anything already
  // tracked and starts the interval only if it finds something still
  // pending; it self-stops once resolved.
  tickRecover();

  console.log(LOG, "v" + VER + " installed");
})();
