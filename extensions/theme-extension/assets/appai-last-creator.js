/**
 * Last-creator return button on the platform Shopify storefront.
 * Cookie is set by /apps/appai/remember-creator when the shopper leaves
 * a creator storefront for checkout. Continue shopping lands here.
 */
;(function () {
  'use strict';
  if (window.__APPAI_LAST_CREATOR__) return;
  window.__APPAI_LAST_CREATOR__ = true;

  var COOKIE = 'appai_last_creator';
  var BAR_ID = 'appai-last-creator-bar';

  function readCookie(name) {
    var parts = (document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+/, '');
      if (p.indexOf(name + '=') === 0) {
        return decodeURIComponent(p.slice(name.length + 1));
      }
    }
    return '';
  }

  function parseVisit(raw) {
    try {
      var v = JSON.parse(raw);
      if (!v || !v.returnUrl || String(v.returnUrl).indexOf('https://') !== 0) return null;
      var name = String(v.shopName || v.username || '').trim();
      if (!name) return null;
      return { shopName: name, returnUrl: String(v.returnUrl) };
    } catch (e) {
      return null;
    }
  }

  function mount(visit) {
    if (document.getElementById(BAR_ID)) return;
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Return to creator shop');
    bar.style.cssText =
      'position:sticky;top:0;z-index:9998;display:flex;justify-content:center;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;background:#111827;color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    var text = document.createElement('span');
    text.textContent = 'Continue shopping at ' + visit.shopName;
    var btn = document.createElement('a');
    btn.href = visit.returnUrl;
    btn.textContent = 'Back to ' + visit.shopName;
    btn.style.cssText =
      'display:inline-flex;align-items:center;background:#fff;color:#111827;text-decoration:none;font-weight:600;padding:8px 14px;border-radius:8px;';
    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function init() {
    var visit = parseVisit(readCookie(COOKIE));
    if (!visit) return;
    if (document.body) mount(visit);
    else document.addEventListener('DOMContentLoaded', function () { mount(visit); });
  }

  init();
})();
