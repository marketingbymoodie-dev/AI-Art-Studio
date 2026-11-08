/**
 * Collection-card colour chips. The theme defines <card-colour-swatches>
 * with an inline script inside each product card. Related products are
 * fetched after load and morphed in, and scripts inserted that way never
 * run, so the element stays inert. Defining it here (and delegating on
 * document) covers cards that already exist and cards inserted later.
 * The theme's own listener, when it did run, stops the click, so this
 * does not handle the same click twice.
 */
(function () {
  if (window.__appaiCardSwatches) return;
  window.__appaiCardSwatches = true;

  function inRecommendations(node) {
    return !!(node && node.closest && node.closest('product-recommendations, .product-recommendations'));
  }

  function logRelated(kind, event, label) {
    var host = event.target && event.target.closest ? event.target.closest('card-colour-swatches') : null;
    if (!inRecommendations(host)) return;
    console.log('[Card swatches]', kind,
      'handler=card-swatches',
      'defaultPrevented=' + !!(event && event.defaultPrevented),
      label || '');
  }

  function onSwatchClick(event) {
    var t = event.target;
    if (!t || !t.closest) return;
    var host = t.closest('card-colour-swatches');
    if (!host) return;
    if (event.defaultPrevented) return;

    var more = t.closest('button[data-swatch-more]');
    if (more && host.contains(more)) {
      event.preventDefault();
      event.stopPropagation();
      var extras = host.querySelectorAll('.card-colour-swatches__swatch--extra');
      for (var i = 0; i < extras.length; i++) extras[i].hidden = false;
      more.remove();
      host.classList.add('card-colour-swatches--expanded');
      logRelated('more', event, more.getAttribute('aria-label') || '');
      return;
    }

    var button = t.closest('button[data-variant-id]');
    if (!button || !host.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.getAttribute('aria-pressed') === 'true') {
      logRelated('chip', event, button.getAttribute('aria-label') || '');
      return;
    }

    var swatches = host.querySelectorAll('button[data-variant-id]');
    for (var s = 0; s < swatches.length; s++) {
      swatches[s].setAttribute('aria-pressed', swatches[s] === button ? 'true' : 'false');
    }

    var card = host.closest('product-card');
    if (card) {
      var mediaId = button.getAttribute('data-media-id');
      var slideshow = card.querySelector('slideshow-component');
      if (slideshow && mediaId && typeof slideshow.select === 'function') {
        var target = slideshow.querySelector('slideshow-slide[slide-id="' + mediaId + '"]');
        if (target) slideshow.select({ id: mediaId }, undefined, { animate: false });
      }
      var applyImage = function () {
        var visible = card.querySelector('.card-gallery slideshow-slide[aria-hidden="false"]');
        var img = (visible && visible.querySelector('img')) || card.querySelector('.card-gallery img');
        var src = button.getAttribute('data-image');
        if (!img || !src) return;
        img.setAttribute('src', src);
        var srcset = button.getAttribute('data-srcset');
        if (srcset) img.setAttribute('srcset', srcset);
        else img.removeAttribute('srcset');
        var label = button.getAttribute('aria-label');
        if (label) img.setAttribute('alt', label);
      };
      applyImage();
      if (window.requestAnimationFrame) requestAnimationFrame(applyImage);

      var variantId = button.getAttribute('data-variant-id');
      var links = card.querySelectorAll('a[href*="/products/"]');
      for (var n = 0; n < links.length; n++) {
        var href = links[n].getAttribute('href');
        if (!href) continue;
        try {
          var url = new URL(href, window.location.origin);
          url.searchParams.set('variant', variantId);
          links[n].setAttribute('href', url.pathname + url.search + url.hash);
        } catch (e) {}
      }
    }
    logRelated('chip', event, button.getAttribute('aria-label') || '');
  }

  function defineSwatches() {
    if (window.customElements && customElements.get('card-colour-swatches')) return;
    if (!window.customElements) return;
    customElements.define('card-colour-swatches', class extends HTMLElement {
      connectedCallback() {
        if (this.__appaiSwatchesBound) return;
        this.__appaiSwatchesBound = true;
        this.addEventListener('click', onSwatchClick);
      }
    });
  }

  defineSwatches();
  document.addEventListener('click', onSwatchClick);

  // The recommendations host is on the page immediately; its cards arrive
  // later. Defining the element upgrades those cards when they are inserted.
  if (window.MutationObserver) {
    var hosts = document.querySelectorAll('product-recommendations');
    for (var h = 0; h < hosts.length; h++) {
      new MutationObserver(function () { defineSwatches(); }).observe(hosts[h], { childList: true, subtree: true });
    }
  }
})();
