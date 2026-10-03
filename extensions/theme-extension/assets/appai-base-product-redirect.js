/*
  AppAI base product page → customizer page.

  UX only. The checkout control is the appai-base-variant-guard validation
  Function; a hand-built /cart/add.js never loads this page.

  Stands down (no redirect) when:
  - the theme editor is open (merchant editing the product template);
  - ?appai_stay=1 is in the URL (operator escape hatch);
  - any AppAI studio is mounted or placed on the page (legacy studio hosted on
    the base product page — redirecting would break that store).
  With no customizer page for this product, hides the native add-to-cart
  instead of redirecting.
*/
(function () {
  var script = document.currentScript;
  var productId = script && script.getAttribute('data-appai-base-product-id');
  if (!productId) return;
  try {
    if (window.Shopify && window.Shopify.designMode) return;
    if (/[?&]appai_stay=1(&|$)/.test(window.location.search)) return;
  } catch (e) {}

  var STUDIO_SELECTORS = [
    '.ai-art-studio-block',
    '[data-block-handle="ai-art-studio"]',
    '#ai-art-studio-container',
    '#ai-art-studio-auto-embed',
    '.ai-art-studio-embed',
    'iframe[title="AI Design Studio"]',
    '[data-embed-handled="true"]'
  ];

  function studioEnabledForProduct() {
    var meta = document.querySelector('meta[name="ai_art_studio:enable"]');
    if (meta && meta.content === 'true') return true;
    var data = document.querySelector('[data-ai-art-studio]');
    if (!data) return false;
    try {
      var parsed = JSON.parse(data.textContent);
      return parsed.enabled === true || parsed.enabled === 'true';
    } catch (e) {
      return false;
    }
  }

  function studioOnPage() {
    if (studioEnabledForProduct()) return true;
    for (var i = 0; i < STUDIO_SELECTORS.length; i++) {
      if (document.querySelector(STUDIO_SELECTORS[i])) return true;
    }
    return false;
  }

  function hideNativeAddToCart() {
    var selectors = [
      'form[action*="/cart/add"]',
      '.shopify-payment-button',
      'button[name="add"]',
      '[data-add-to-cart]'
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.style.display = 'none';
      });
    });
  }

  function run() {
    if (studioOnPage()) return;
    fetch('/apps/appai/customizer-pages', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (studioOnPage()) return;
        var pages = (data && data.pages) || [];
        var match = null;
        for (var i = 0; i < pages.length; i++) {
          var p = pages[i];
          if (String(p.baseProductId || '').replace(/\D/g, '') === String(productId) && p.publiclyMountable && p.handle) {
            match = p;
            break;
          }
        }
        if (match) {
          window.location.replace('/pages/' + encodeURIComponent(match.handle));
        } else {
          hideNativeAddToCart();
        }
      })
      .catch(function () {
        hideNativeAddToCart();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
